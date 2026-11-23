/*
 * Context building.
 *
 * The pane can send an AI assistant three kinds of material:
 *   1. Metadata of one paper, or of many papers.
 *   2. The PDF file of one or more papers, attached through the page itself.
 *   3. A text selection from an open PDF.
 *
 * Everything here returns plain data. Nothing touches the DOM, so the code is
 * easy to test from the console with `Zotero.SideBrowser.context`.
 */

const MAX_TEXT_CHARS = 3000;

/**
 * Short human-readable metadata block for one item. A regular item contributes
 * its own fields; an attachment contributes its parent fields plus a note that
 * the file is attached separately.
 *
 * @param {Zotero.Item} item
 * @returns {string}
 */
export function describeItem(item) {
  if (!item) {
    return "";
  }
  let target = item;
  if (item.isAttachment() && item.parentItem) {
    target = item.parentItem;
  }
  else if (item.isAnnotation() && item.parentItem?.parentItem) {
    target = item.parentItem.parentItem;
  }

  let lines = [];
  let title = target.getField("title");
  if (title) {
    lines.push(`Title: ${title}`);
  }
  let creators = target.getCreators() || [];
  if (creators.length) {
    lines.push("Authors: " + creators.map(formatCreator).join("; "));
  }
  let date = target.getField("date");
  if (date) {
    lines.push(`Date: ${date}`);
  }
  let publication = target.getField("publicationTitle")
    || target.getField("bookTitle")
    || target.getField("proceedingsTitle")
    || target.getField("publisher");
  if (publication) {
    lines.push(`Published in: ${publication}`);
  }
  let volume = target.getField("volume");
  let issue = target.getField("issue");
  let pages = target.getField("pages");
  let bibliographic = [volume && `vol. ${volume}`, issue && `no. ${issue}`, pages && `pp. ${pages}`]
    .filter(Boolean)
    .join(", ");
  if (bibliographic) {
    lines.push(`Bibliographic details: ${bibliographic}`);
  }
  let doi = target.getField("DOI");
  if (doi) {
    lines.push(`DOI: ${doi}`);
  }
  let url = target.getField("url");
  if (url) {
    lines.push(`URL: ${url}`);
  }
  let abstract = target.getField("abstractNote");
  if (abstract) {
    if (abstract.length > MAX_TEXT_CHARS) {
      abstract = abstract.slice(0, MAX_TEXT_CHARS) + " [...]";
    }
    lines.push(`Abstract: ${abstract}`);
  }
  return lines.join("\n");
}

function formatCreator(creator) {
  if (creator.name) {
    return creator.name;
  }
  let first = creator.firstName || "";
  let last = creator.lastName || "";
  return [first, last].filter(Boolean).join(" ");
}

/**
 * Build the metadata block for a list of items, with a header that tells the
 * assistant how many papers follow.
 *
 * @param {Zotero.Item[]} items
 * @param {object} [options]
 * @param {string} [options.heading] - Overrides the default heading.
 * @returns {string}
 */
export function describeItems(items, { heading } = {}) {
  let unique = dedupe(items);
  if (!unique.length) {
    return "";
  }
  let header = heading
    || (unique.length === 1
      ? "The following paper is the context for my message."
      : `The following ${unique.length} papers are the context for my message.`);
  let blocks = unique.map((item, index) => {
    let label = unique.length > 1 ? `### Paper ${index + 1}\n` : "";
    return `${label}${describeItem(item)}`;
  });
  return [header, ...blocks].join("\n\n");
}

/**
 * A compact one-line bibliography entry for each item.
 *
 * @param {Zotero.Item[]} items
 * @returns {string}
 */
export function listTitles(items) {
  return dedupe(items)
    .map((item) => {
      let target = item.isAttachment() && item.parentItem ? item.parentItem : item;
      let title = target.getField("title") || "(untitled)";
      let year = (target.getField("date") || "").match(/\d{4}/)?.[0];
      let firstCreator = (target.getCreators() || [])[0];
      let name = firstCreator ? formatCreator(firstCreator) : "";
      return `- ${[name, year && `(${year})`, title].filter(Boolean).join(" ")}`;
    })
    .join("\n");
}

/**
 * Collect the file paths of the best PDF attachment for each item.
 *
 * A regular item contributes the best available PDF attachment. An attachment
 * item contributes itself when it is a PDF. Items without a local file are
 * returned in `skipped` so the pane can explain why a PDF was not attached.
 *
 * @param {Zotero.Item[]} items
 * @returns {Promise<{files: {path: string, name: string, itemID: number}[], skipped: object[]}>}
 */
export async function collectPDFs(items) {
  let files = [];
  let skipped = [];
  let seen = new Set();

  for (let item of dedupe(items)) {
    let attachment = null;
    if (item.isAttachment()) {
      attachment = item.isPDFAttachment() ? item : null;
    } else {
      try {
        attachment = await item.getBestAttachment();
      } catch (e) {
        attachment = null;
      }
      // getBestAttachment can return a non-PDF, such as an EPUB or a snapshot.
      if (attachment && !attachment.isPDFAttachment()) {
        attachment = null;
      }
    }

    if (!attachment) {
      skipped.push({
        itemID: item.id,
        title: item.getField("title"),
        reason: "no-pdf",
      });
      continue;
    }
    if (seen.has(attachment.id)) {
      continue;
    }
    seen.add(attachment.id);

    let path = false;
    try {
      path = await attachment.getFilePathAsync();
    } catch (e) {
      path = false;
    }
    if (!path) {
      skipped.push({
        itemID: item.id,
        title: item.getField("title"),
        reason: "no-local-file",
      });
      continue;
    }
    files.push({
      path,
      name: attachment.attachmentFilename || attachment.getField("title") || "paper.pdf",
      itemID: attachment.id,
    });
  }

  return { files, skipped };
}

/**
 * Read the bytes of a list of files, ready for the actor. A binary string keeps
 * the message small and avoids cloning a large typed array per file.
 *
 * @param {{path: string, name: string}[]} files
 * @returns {Promise<{name: string, type: string, data: string}[]>}
 */
export async function readFiles(files) {
  let out = [];
  for (let file of files) {
    let data = await Zotero.File.getBinaryContentsAsync(file.path);
    out.push({
      name: file.name,
      type: "application/pdf",
      data,
    });
  }
  return out;
}

/**
 * Text payload for a selection made in a PDF. The selection arrives as an
 * annotation-like object from the reader event.
 *
 * @param {object} annotation
 * @param {Zotero.Item} [attachmentItem]
 * @returns {string}
 */
export function describeSelection(annotation, attachmentItem) {
  let lines = [];
  let parent = attachmentItem?.parentItem || attachmentItem;
  if (parent) {
    lines.push(describeItem(parent));
    lines.push("");
  }
  if (annotation?.pageLabel || annotation?.pageIndex !== undefined) {
    let page = annotation.pageLabel || String(annotation.pageIndex + 1);
    lines.push(`Selected text from page ${page}:`);
  } else {
    lines.push("Selected text:");
  }
  lines.push("---");
  lines.push(String(annotation?.text || "").trim());
  lines.push("---");
  return lines.join("\n");
}

/**
 * Remove duplicates and non-items, keeping the original order.
 *
 * @param {Zotero.Item[]} items
 * @returns {Zotero.Item[]}
 */
export function dedupe(items) {
  let seen = new Set();
  let out = [];
  for (let item of items || []) {
    if (!item || !item.id || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/*
 * The files that travel with a message.
 *
 * Everything the pane sends is a file, because a chat page takes a file through
 * its own attach control and keeps the message box for the user. Five kinds
 * exist, and each one is a check box in the pane:
 *
 *   metadata     a text file with title, authors, venue, and abstract
 *   selection    a text file with the text selected in the reader
 *   annotations  a text file with the highlights and comments of the PDF, plus
 *                the cached picture of each image annotation
 *   pdf          the real PDF file
 *   others       the other attachments of the paper that exist as local files
 *
 * A text file has no source on disk, so the page creates it from the text, which
 * has the same effect as a temporary file. A file from disk travels as a binary
 * string, because that form clones faster across the actor boundary.
 *
 * File shapes:  { name, type, text }  and  { name, type, data }. A text file carries
 * `fromText: true`, so the page script can send it as a PDF or as a picture when
 * the page takes neither text. A PDF carries the flag `isPdf`, and its text can be
 * sent instead, for a page that takes no PDFs.
 * Nothing here touches the page DOM.
 */

import { describeItems, describeSelection, dedupe } from "./context.mjs";

/** Largest attachment that the pane will read into memory, in bytes. */
const MAX_FILE_BYTES = 30 * 1024 * 1024;

/** The five options, in the order the pane shows them. */
export const KINDS = ["metadata", "selection", "annotations", "pdf", "others"];

/**
 * The paper behind an item. An attachment or annotation stands for its parent.
 *
 * @param {Zotero.Item} item
 * @returns {Zotero.Item}
 */
export function topItem(item) {
  if (item.isAnnotation() && item.parentItem) {
    return topItem(item.parentItem);
  }
  if (item.isAttachment() && item.parentItem) {
    return item.parentItem;
  }
  return item;
}

/** @returns {Zotero.Item[]} The PDF attachments that belong to the items. */
export function pdfAttachments(items) {
  let out = [];
  let seen = new Set();
  let add = (attachment) => {
    if (attachment && !seen.has(attachment.id)) {
      seen.add(attachment.id);
      out.push(attachment);
    }
  };
  for (let item of dedupe(items)) {
    if (item.isAttachment()) {
      if (item.isPDFAttachment()) {
        add(item);
      }
      continue;
    }
    for (let id of item.getAttachments()) {
      let attachment = Zotero.Items.get(id);
      if (attachment?.isPDFAttachment()) {
        add(attachment);
      }
    }
  }
  return out;
}

/** @returns {Zotero.Item[]} Attachments that are neither PDFs nor web links. */
export function otherAttachments(items) {
  let out = [];
  let seen = new Set();
  for (let item of dedupe(items)) {
    let paper = topItem(item);
    for (let id of paper.getAttachments()) {
      let attachment = Zotero.Items.get(id);
      if (!attachment || seen.has(attachment.id) || attachment.isPDFAttachment()) {
        continue;
      }
      if (attachment.attachmentLinkMode === Zotero.Attachments.LINK_MODE_LINKED_URL) {
        continue;
      }
      seen.add(attachment.id);
      out.push(attachment);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function metadataText(items) {
  let papers = dedupe(items.map(topItem));
  let heading = papers.length === 1
    ? "Metadata of the paper that this conversation is about."
    : `Metadata of the ${papers.length} papers that this conversation is about.`;
  return describeItems(papers, { heading });
}

function selectionText(selection, attachmentItem) {
  return describeSelection(selection, attachmentItem);
}

/**
 * The annotations of every PDF as readable text, and the list of image
 * annotations whose picture is cached on disk.
 *
 * @param {Zotero.Item[]} items
 * @returns {Promise<{text: string, images: {name: string, path: string}[]}>}
 */
async function annotationsContent(items) {
  let blocks = [];
  let images = [];
  for (let attachment of pdfAttachments(items)) {
    let annotations = attachment.getAnnotations();
    if (!annotations.length) {
      continue;
    }
    annotations.sort((a, b) => String(a.annotationSortIndex).localeCompare(String(b.annotationSortIndex)));
    let paper = topItem(attachment);
    let lines = [`## Annotations of: ${paper.getField("title") || attachment.getField("title") || "untitled"}`];
    for (let annotation of annotations) {
      let page = annotation.annotationPageLabel ? `p. ${annotation.annotationPageLabel}` : "page unknown";
      let kind = annotation.annotationType;
      let text = (annotation.annotationText || "").trim();
      let comment = (annotation.annotationComment || "").trim();
      let line = `- ${page}, ${kind}`;
      if (text) {
        line += `: "${text}"`;
      }
      if (comment) {
        line += text ? ` (comment: ${comment})` : `: ${comment}`;
      }
      if (kind === "image") {
        try {
          let path = Zotero.Annotations.getCacheImagePath(annotation);
          if (await IOUtils.exists(path)) {
            let name = `annotation-${annotation.annotationPageLabel || "x"}-${annotation.key}.png`;
            images.push({ name, path });
            line += ` (picture attached as ${name})`;
          }
        } catch (e) {
          Zotero.debug(`[Side Browser] No picture for an annotation: ${e}`);
        }
      }
      lines.push(line);
    }
    blocks.push(lines.join("\n"));
  }
  return { text: blocks.join("\n\n"), images };
}

/**
 * The text of the checked text options joined into one block. The pane uses
 * this for "Insert context" and "Copy context", where text is what the user
 * wants.
 *
 * @param {object} params
 * @param {Zotero.Item[]} params.items
 * @param {object|null} params.selection
 * @param {Zotero.Item|null} params.attachmentItem
 * @param {object} params.options - Check box state, keyed by kind.
 * @returns {Promise<string>}
 */
export async function contextText({ items, selection, attachmentItem, options }) {
  let parts = [];
  if (options.metadata && items.length) {
    parts.push(metadataText(items));
  }
  if (options.selection && selection?.text) {
    parts.push(selectionText(selection, attachmentItem));
  }
  if (options.annotations && items.length) {
    let { text } = await annotationsContent(items);
    if (text) {
      parts.push(text);
    }
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

async function readFileFromDisk(path, name, type) {
  let info = await IOUtils.stat(path);
  if (info.size > MAX_FILE_BYTES) {
    return { tooBig: true };
  }
  let data = await Zotero.File.getBinaryContentsAsync(path);
  return { name, type, data };
}

function uniqueName(name, used) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  let dot = name.lastIndexOf(".");
  let stem = dot > 0 ? name.slice(0, dot) : name;
  let ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ; n++) {
    let candidate = `${stem}-${n}${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

/**
 * Build every file that the checked options call for.
 *
 * @param {object} params
 * @param {Zotero.Item[]} params.items - The papers, or the open PDF.
 * @param {object|null} params.selection - A captured reader selection.
 * @param {Zotero.Item|null} params.attachmentItem - Item that owns the selection.
 * @param {object} params.options - Check box state, keyed by kind.
 * @param {boolean} [params.skipText] - Leave out text files, for the case where
 *   the user already put the same text in the message box.
 * @returns {Promise<{files: object[], skipped: {title: string, reason: string}[]}>}
 */
export async function buildPackage({ items, selection, attachmentItem, options, skipText = false }) {
  let files = [];
  let skipped = [];
  let used = new Set();
  let papers = dedupe(items);

  if (!skipText && options.metadata && papers.length) {
    let text = metadataText(papers);
    files.push({ name: uniqueName("paper-metadata.md", used), type: "text/markdown", text, fromText: true });
  }

  if (!skipText && options.selection && selection?.text) {
    let text = selectionText(selection, attachmentItem);
    files.push({ name: uniqueName("selected-text.md", used), type: "text/markdown", text, fromText: true });
  }

  if (options.annotations && papers.length) {
    let { text, images } = await annotationsContent(papers);
    if (text && !skipText) {
      files.push({ name: uniqueName("annotations.md", used), type: "text/markdown", text, fromText: true });
    } else if (!text) {
      skipped.push({ title: "the annotations", reason: "none" });
    }
    for (let image of images) {
      try {
        let read = await readFileFromDisk(image.path, uniqueName(image.name, used), "image/png");
        if (!read.tooBig) {
          files.push(read);
        }
      } catch (e) {
        Zotero.debug(`[Side Browser] Could not read an annotation picture: ${e}`);
      }
    }
  }

  if (options.pdf && papers.length) {
    let attachments = pdfAttachments(papers);
    if (!attachments.length) {
      for (let paper of papers) {
        skipped.push({ title: topItem(paper).getField("title"), reason: "no PDF attachment" });
      }
    }
    for (let attachment of attachments) {
      await addAttachment(attachment, "application/pdf", files, skipped, used, { isPdf: true });
    }
  }

  if (options.others && papers.length) {
    for (let attachment of otherAttachments(papers)) {
      await addAttachment(
        attachment,
        attachment.attachmentContentType || "application/octet-stream",
        files,
        skipped,
        used,
      );
    }
  }

  return { files, skipped };
}

async function addAttachment(attachment, type, files, skipped, used, extra = {}) {
  let title = attachment.attachmentFilename || attachment.getField("title") || "attachment";
  let path = false;
  try {
    path = await attachment.getFilePathAsync();
  } catch (e) {
    path = false;
  }
  if (!path) {
    skipped.push({ title, reason: "no file on disk" });
    return;
  }
  try {
    let read = await readFileFromDisk(path, uniqueName(title, used), type);
    if (read.tooBig) {
      skipped.push({ title, reason: "larger than 30 MB" });
      return;
    }
    files.push({ ...read, ...extra });
  } catch (e) {
    skipped.push({ title, reason: "could not be read" });
  }
}

/**
 * A short label for the kinds that are on, for notifications.
 *
 * @param {object} options
 * @returns {string}
 */
export function describeOptions(options) {
  let labels = {
    metadata: "paper metadata",
    selection: "selected text",
    annotations: "annotations",
    pdf: "PDF file",
    others: "other attachments",
  };
  return KINDS.filter((kind) => options[kind]).map((kind) => labels[kind]).join(", ");
}

/*
 * Test seeding. Creates one journal article with a real PDF attachment in the
 * user library, so the context code has something to work with when the plugin
 * runs headless. Only used when the `sidebrowser.runSelfTest` preference is on,
 * and only when the library holds no items yet.
 *
 * This module runs inside Zotero, so it uses the public data API rather than
 * writing SQL. That keeps the database consistent.
 */

const PDF_TEXT = [
  "Hello PDF text",
  "Second line of the paper abstract.",
  "Third line with numbers 12345.",
].join("\n");

/** Build a minimal but valid one-page PDF with extractable text. */
function buildPDF() {
  let stream = `BT /F1 12 Tf 20 700 Td 16 TL
(${PDF_TEXT.split("\n")[0]}) Tj T*
(${PDF_TEXT.split("\n")[1]}) Tj T*
(${PDF_TEXT.split("\n")[2]}) Tj T*
ET`;
  let objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  let offsets = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  let xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => {
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

/**
 * Write a temporary PDF file and return its path.
 * @returns {Promise<string>}
 */
async function writeTempPDF() {
  let text = buildPDF();
  let bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  let path = PathUtils.join(PathUtils.tempDir, "sidebrowser-selftest.pdf");
  await IOUtils.write(path, bytes);
  return path;
}

/**
 * Create the sample paper if the user library is empty.
 *
 * @returns {Promise<Zotero.Item|null>}
 */
export async function seedSamplePaper() {
  let libraryID = Zotero.Libraries.userLibraryID;
  let existing = await Zotero.Items.getAll(libraryID, true);
  let regular = existing.filter((item) => item.isRegularItem() && !item.deleted);
  if (regular.length) {
    return regular[0];
  }

  let item = new Zotero.Item("journalArticle");
  item.libraryID = libraryID;
  item.setField("title", "A Study of Sidebar Browsers");
  item.setField(
    "abstractNote",
    "This paper studies web sidebars inside reference managers. It finds that "
    + "docking a browser next to a PDF reduces context switching between reading "
    + "and asking questions about the text.",
  );
  item.setField("date", "2025-05-01");
  item.setField("publicationTitle", "Journal of Tooling");
  item.setField("volume", "12");
  item.setField("pages", "100-110");
  item.setField("DOI", "10.1234/example.sidebar");
  item.setCreators([{ firstName: "Ada", lastName: "Lovelace", creatorType: "author" }]);
  await item.saveTx();

  let pdfPath = await writeTempPDF();
  let attachment = await Zotero.Attachments.importFromFile({
    file: pdfPath,
    parentItemID: item.id,
    contentType: "application/pdf",
  });
  if (attachment) {
    attachment.setField("title", "Full Text PDF");
    await attachment.saveTx();
  }

  Zotero.debug(`[Side Browser] seeded sample paper ${item.id}`);
  return item;
}

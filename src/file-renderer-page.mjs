/* Runs only in the plugin's local conversion document, never in an AI page. */
import { textToPdf, textToPng, dataUrlToBytes, bytesToBinary } from "./file-shapes.mjs";

const PDF_ROOT = "resource://zotero/reader/pdf/";
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;

async function pdfImages(spec) {
  // Use the matching PDF.js and worker shipped with Zotero. The local worker
  // handler avoids blob-worker restrictions in resource documents.
  globalThis.pdfjsWorker = await import(`${PDF_ROOT}build/pdf.worker.mjs`);
  const pdfjs = await import(`${PDF_ROOT}build/pdf.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDF_ROOT}build/pdf.worker.mjs`;
  const task = pdfjs.getDocument({
    data: Uint8Array.from(spec.data, (ch) => ch.charCodeAt(0)),
    cMapUrl: `${PDF_ROOT}web/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDF_ROOT}web/standard_fonts/`,
    wasmUrl: `${PDF_ROOT}web/wasm/`,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  try {
    const pdf = await task.promise;
    const files = [];
    let total = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      // Approximately 144 DPI, bounded for oversized pages. No page is omitted.
      const scale = Math.min(2, 2400 / Math.max(natural.width, natural.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      try {
        await page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
          background: "rgb(255, 255, 255)",
        }).promise;
        const bytes = dataUrlToBytes(canvas.toDataURL("image/png"), window);
        total += bytes.length;
        if (total > MAX_TOTAL_BYTES) {
          throw new Error("The PDF images exceed 128 MB. Select a smaller PDF.");
        }
        files.push({
          name: spec.name.replace(/\.[^.]+$/, "") + `-page-${String(number).padStart(3, "0")}.png`,
          type: "image/png",
          data: bytesToBinary(bytes),
        });
      } finally {
        canvas.width = canvas.height = 0;
        page.cleanup();
      }
    }
    return files;
  } finally {
    await task.destroy();
  }
}

window.convertSideBrowserFiles = async (files, mode) => {
  const converted = [];
  const skipped = [];
  const used = new Set();
  for (let spec of files) {
    try {
      if (typeof spec.text !== "string" && (/^text\//.test(spec.type)
          || /\.(txt|md|csv|json|log)$/i.test(spec.name))) {
        spec = { ...spec, text: new TextDecoder().decode(
          Uint8Array.from(spec.data || "", (ch) => ch.charCodeAt(0)),
        ) };
      }
      let results = [spec];
      if (mode === "images" && (spec.isPdf || spec.type === "application/pdf")) {
        results = await pdfImages(spec);
      } else if (typeof spec.text === "string" && mode === "images") {
        results = [{ name: spec.name.replace(/\.[^.]+$/, "") + ".png", type: "image/png",
          data: bytesToBinary(textToPng(spec.text, document)) }];
      } else if (typeof spec.text === "string" && mode === "pdf") {
        results = [{ name: spec.name.replace(/\.[^.]+$/, "") + ".pdf", type: "application/pdf",
          data: textToPdf(spec.text) }];
      } else if (mode === "images" && !spec.type?.startsWith("image/")) {
        throw new Error("This service accepts images. This file cannot become an image.");
      }
      for (const file of results) {
        let name = file.name;
        let n = 2;
        while (used.has(name)) {
          name = file.name.replace(/(\.[^.]*)?$/, `-${n++}$1`);
        }
        used.add(name);
        converted.push({ ...file, name });
      }
    } catch (error) {
      skipped.push({ title: spec.name, reason: `File conversion failed: ${error.message || error}` });
    }
  }
  return { files: converted, skipped };
};

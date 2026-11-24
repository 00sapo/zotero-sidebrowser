/* Text conversions shared by the local renderer and the page actor. */

export function textToPdf(text) {
  const WIDTH = 92;
  const PER_PAGE = 58;

  let lines = [];
  for (let raw of String(text).split("\n")) {
    let line = raw.replace(/\t/g, "    ");
    while (line.length > WIDTH) {
      let cut = line.lastIndexOf(" ", WIDTH);
      if (cut < WIDTH / 2) {
        cut = WIDTH;
      }
      lines.push(line.slice(0, cut));
      line = line.slice(cut).replace(/^ +/, "");
    }
    lines.push(line);
  }
  let pages = [];
  for (let i = 0; i < lines.length; i += PER_PAGE) {
    pages.push(lines.slice(i, i + PER_PAGE));
  }
  if (!pages.length) {
    pages.push([""]);
  }

  let escape = (line) => Array.from(line).map((ch) => {
    let code = ch.charCodeAt(0);
    if (ch === "\\" || ch === "(" || ch === ")") {
      return `\\${ch}`;
    }
    if (code < 32) {
      return " ";
    }
    if (code < 127) {
      return ch;
    }
    return code < 256 ? `\\${code.toString(8).padStart(3, "0")}` : "?";
  }).join("");

  let objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  pages.forEach((pageLines, i) => {
    let stream = `BT /F1 10 Tf 12 TL 40 760 Td\n${pageLines.map((l) => `(${escape(l)}) Tj T*`).join("\n")}\nET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + 2 * i} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });

  let out = "%PDF-1.4\n";
  let offsets = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  let xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let offset of offsets) {
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}


export function textToPng(text, doc) {
  const WIDTH = 900;
  const MARGIN = 28;
  const LINE = 18;
  const HEAD_LINE = 26;
  const BODY_FONT = "13px sans-serif";
  const HEAD_FONT = "bold 15px sans-serif";

  let canvas = doc.createElement("canvas");
  let ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("The page offers no canvas");
  }

  // Wrap every line to the page width, keeping the blank lines.
  let lines = [];
  for (let raw of String(text).split("\n")) {
    let line = raw.replace(/\t/g, "    ");
    if (!line.trim()) {
      lines.push({ text: "", head: false });
      continue;
    }
    let head = /^#{1,3} /.test(line);
    let body = line.replace(/^#{1,3} /, "");
    ctx.font = head ? HEAD_FONT : BODY_FONT;
    let current = "";
    for (let word of body.split(/\s+/)) {
      let candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width > WIDTH - MARGIN * 2 && current) {
        lines.push({ text: current, head });
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) {
      lines.push({ text: current, head });
    }
  }
  if (!lines.length) {
    lines.push({ text: "", head: false });
  }

  // Very long text is cut, with a note, so the picture stays a picture.
  const MAX_LINES = 240;
  if (lines.length > MAX_LINES) {
    lines = lines.slice(0, MAX_LINES);
    lines.push({ text: "[The rest of the text was cut from this picture.]", head: false });
  }

  let height = 0;
  for (let line of lines) {
    height += line.head ? HEAD_LINE : LINE;
  }
  height = Math.max(120, Math.ceil(MARGIN * 2 + height));

  canvas.width = WIDTH;
  canvas.height = height;
  ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.fillStyle = "#111111";
  ctx.textBaseline = "top";
  let y = MARGIN;
  for (let line of lines) {
    ctx.font = line.head ? HEAD_FONT : BODY_FONT;
    ctx.fillText(line.text, MARGIN, y);
    y += line.head ? HEAD_LINE : LINE;
  }
  return dataUrlToBytes(canvas.toDataURL("image/png"), doc.defaultView);
}


export function dataUrlToBytes(dataUrl, win) {
  return Uint8Array.from(win.atob(dataUrl.split(",")[1]), (ch) => ch.charCodeAt(0));
}

export function bytesToBinary(bytes) {
  let chunks = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return chunks.join("");
}

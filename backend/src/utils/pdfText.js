/**
 * Reads the typed text out of a PDF, line by line, with cell gaps kept as tab
 * characters so a table row such as
 *     1   Jane Wanjiru   12345678   0712 345 678   F
 * comes back as one line with its columns separated by tabs. Works on PDFs
 * that contain real (selectable) text. A scanned page or photo has no text
 * layer: it yields no lines, and the caller says so rather than guessing.
 */
const { httpError } = require("./geography");

const MAX_PAGES = 80;

let pdfjs = null;
function loadPdfjs() {
  if (!pdfjs) {
    // Loaded on first use; the library prints a harmless canvas warning at load
    // time that would otherwise appear in every server start-up.
    const warn = console.warn;
    console.warn = () => {};
    try {
      pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
    } finally {
      console.warn = warn;
    }
  }
  return pdfjs;
}

// Group the text pieces of one page into lines (by vertical position), order
// each line left to right and decide, from the horizontal gap, whether two
// neighbouring pieces are the same word, the next word, or the next column.
function pageToLines(items) {
  const pieces = items
    .filter((it) => it.str && it.str.trim() !== "")
    .map((it) => ({
      s: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width || 0,
      size: Math.abs(it.transform[3]) || it.height || 10,
    }));
  pieces.sort((a, b) => b.y - a.y || a.x - b.x);

  const rows = [];
  for (const p of pieces) {
    const row = rows.find((r) => Math.abs(r.y - p.y) <= Math.max(2.5, p.size * 0.35));
    if (row) row.items.push(p);
    else rows.push({ y: p.y, items: [p] });
  }
  rows.sort((a, b) => b.y - a.y);

  return rows.map((row) => {
    row.items.sort((a, b) => a.x - b.x);
    let out = "";
    let prevEnd = null;
    for (const p of row.items) {
      if (prevEnd !== null) {
        const gap = p.x - prevEnd;
        if (gap > p.size * 1.1) out += "\t";
        else if (gap > p.size * 0.12) out += " ";
      }
      out += p.s;
      prevEnd = p.x + p.w;
    }
    return out.replace(/[ ]+\t/g, "\t").replace(/\t[ ]+/g, "\t").trim();
  }).filter(Boolean);
}

async function extractPdfLines(buffer) {
  const lib = loadPdfjs();
  let doc;
  try {
    doc = await lib.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    }).promise;
  } catch (err) {
    if (err && err.name === "PasswordException") {
      throw httpError(400, "This PDF is password-protected. Remove the password and upload it again.");
    }
    throw httpError(400, "This file could not be read as a PDF. It may be damaged; try saving or exporting it again.");
  }
  const pages = Math.min(doc.numPages, MAX_PAGES);
  const lines = [];
  for (let n = 1; n <= pages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    for (const text of pageToLines(content.items)) lines.push({ page: n, text });
  }
  const truncated = doc.numPages > MAX_PAGES;
  await doc.destroy();
  return { lines, pageCount: doc.numPages, truncated };
}

module.exports = { extractPdfLines, pageToLines };

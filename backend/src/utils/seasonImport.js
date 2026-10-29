// Reading a county's own price list (CSV or Excel) for the Crop Season Rates directory.
const ExcelJS = require("exceljs");
const { cellText } = require("./staffSheet");

const strip = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const NO_DATA = new Set(["", "notyet", "-", "na", "pending", "tbc", "tba"]);
const NOISE = new Set(["fcs", "society", "societies", "farmers", "farmer", "cooperative", "cooperatives", "coop", "co", "operative", "ltd", "limited"]);

/** Reads CSV text into rows of cells. Handles quotes, BOM, commas, semicolons and tabs. */
function parseCsv(text) {
  text = String(text).replace(/^﻿/, "");
  const first = text.split(/\r?\n/).find((l) => l.trim()) || "";
  const count = (ch) => (first.match(new RegExp(ch === "\t" ? "\\t" : "\\" + ch, "g")) || []).length;
  const delimiter = [",", ";", "\t"].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delimiter) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); rows.push(row);
  return { rows: rows.filter((r) => r.some((c) => String(c).trim() !== "")), delimiter };
}

/** First worksheet of an .xlsx as rows of text. */
async function parseXlsx(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], delimiter: "," };
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (r) => { const out = []; for (let c = 1; c <= ws.columnCount; c++) out.push(cellText(r.getCell(c).value)); rows.push(out); });
  return { rows: rows.filter((r) => r.some((c) => String(c).trim() !== "")), delimiter: "," };
}

/** Finds the columns by their headings. Returns { society, subCounty, ward, factory, rounds:{no: colIndex} } or throws a plain-words error. */
function mapHeaders(header) {
  const m = { society: -1, subCounty: -1, ward: -1, factory: -1, rounds: {} };
  header.forEach((h, i) => {
    const n = strip(h);
    if (!n) return;
    const num = /^\(?(\d{1,2})\)?$/.exec(n) || (/(pay|^av)/.test(n) && /(\d{1,2})/.exec(n));
    if (num) {
      const no = Number(num[1]);
      if (m.rounds[no] !== undefined) throw new Error(`Two columns are for payment (${no})`);
      if (no < 1 || no > 12) throw new Error(`Payment (${no}) is out of range; use 1 to 12`);
      m.rounds[no] = i;
    } else if (n.includes("subcounty")) { if (m.subCounty < 0) m.subCounty = i; }
    else if (n.includes("ward")) { if (m.ward < 0) m.ward = i; }
    else if (/(factory|mill|buyer|processor)/.test(n)) { if (m.factory < 0) m.factory = i; }
    else if (/(society|name|cooperative|fcs)/.test(n)) { if (m.society < 0) m.society = i; }
  });
  if (m.society < 0) throw new Error("There is no column for the society's name (heading it \"Society's Name\")");
  if (Object.keys(m.rounds).length === 0) throw new Error("There is no payment column (heading it like \"Av. payment (1)\" or just \"(1)\")");
  return m;
}

/** "142.30", "KES 1,142.30", "142,30" (only when the file uses ; as separator). null = nothing to record; NaN = not a price. */
function parsePrice(text, decimalComma = false) {
  let t = String(text || "").trim();
  if (NO_DATA.has(strip(t))) return null;
  t = t.replace(/\/=|\/-/g, "").replace(/kes|ksh|ks|sh/gi, "").replace(/\s/g, "");
  if (decimalComma) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  if (!/^\d+(\.\d{1,4})?$/.test(t)) return NaN;
  const n = Math.round(Number(t) * 100) / 100;
  return n > 0 && n <= 100000 ? n : NaN;
}

/** Name without numbering and filler words, so "1. Kibugu F.C.S." meets "KIBUGU FCS". */
function cleanName(s) { return String(s || "").replace(/^\s*\d+\s*[.)\-:]\s*/, "").trim(); }
function tokens(s) {
  return cleanName(s).toLowerCase().replace(/f\.?\s*c\.?\s*s\.?(?![a-z])/g, " fcs ").replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t && t.length > 1 && !NOISE.has(t));
}
const keyOf = (s) => { const t = tokens(s); return t.length ? t.join("") : strip(s); };
const sortedKeyOf = (s) => { const t = tokens(s); return t.length ? [...t].sort().join("") : strip(s); };

/** CSV cell safe to open in Excel (no formulas). */
function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

module.exports = { parseCsv, parseXlsx, mapHeaders, parsePrice, cleanName, keyOf, sortedKeyOf, csvCell, strip };

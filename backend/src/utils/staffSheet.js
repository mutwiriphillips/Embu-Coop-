const ExcelJS = require("exceljs");

// Columns of the staff spreadsheet. `edit: false` columns are information only and ignored on upload.
const COLUMNS = [
  { key: "serialNo", header: "S/No", width: 7, edit: false },
  { key: "pNo", header: "P/No", width: 16, edit: true },
  { key: "fullName", header: "Full Name", width: 28, edit: true },
  { key: "designation", header: "Designation", width: 30, edit: true },
  { key: "jobGroup", header: "Job Group", width: 10, edit: true },
  { key: "age", header: "Age", width: 6, edit: true },
  { key: "dutyStation", header: "Duty Station", width: 38, edit: true },
  { key: "subCounty", header: "Sub-County", width: 16, edit: true },
  { key: "phoneNumber", header: "Phone Number", width: 14, edit: true },
  { key: "email", header: "Email", width: 28, edit: true },
  { key: "remarks", header: "Remarks", width: 26, edit: true },
  { key: "yearEmployed", header: "Year Employed", width: 14, edit: true },
  { key: "qualifications", header: "Qualifications", width: 44, edit: true },
  { key: "reportsTo", header: "Reports To (P/No)", width: 18, edit: true },
  { key: "active", header: "Active (Yes/No)", width: 14, edit: true },
  { key: "statusLabel", header: "Current Status (read-only)", width: 24, edit: false },
  { key: "reportsToName", header: "Reports To Name (read-only)", width: 28, edit: false },
];
const TEXT_KEYS = new Set(["pNo", "phoneNumber", "reportsTo"]);

const READ_ME = [
  "HOW TO USE THIS SHEET",
  "",
  "1. Edit the white columns, save the file, then upload it from Staff Directory -> Upload staff sheet.",
  "2. P/No identifies the person. A P/No already in the system updates that person; a new P/No adds a new person.",
  "3. A blank cell means 'leave as it is'. It never erases anything.",
  "4. People are never deleted. To retire someone, set Active (Yes/No) to No.",
  "5. Duty Station: a county office (County Headquarters, Director's Office / CO's Office / NAVCDP), the Ministry (State Department for Co-operatives (Ministry headquarters)), or a sub-county station (then fill Sub-County).",
  "6. Reports To (P/No): the P/No of this person's supervisor. Leave blank to keep as is; type Director to make them report to the Director (the default for everyone).",
  "7. Grey columns (S/No, Current Status, Reports To Name) are for reading only and are ignored on upload. Change status on the person's profile.",
  "8. If any row has a problem, NOTHING is saved and you get a list of the rows to fix.",
  "",
  "CONFIDENTIAL: this sheet holds staff personal data (and a restricted Remarks column). Share it with nobody outside the Director and National Admin; delete downloaded copies when done.",
];

async function buildWorkbook(rows, cfg = {}) {
  const columns = cfg.columns || COLUMNS, textKeys = cfg.textKeys || TEXT_KEYS, sheetName = cfg.sheetName || "Staff", readMe = cfg.readMe || READ_ME, freeze = cfg.freeze === undefined ? 3 : cfg.freeze;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Embu Cooperative Management System";
  const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1, xSplit: freeze }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (textKeys.has(c.key)) col.numFmt = "@";
  });
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  columns.forEach((c, i) => {
    head.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.edit ? "FF006600" : "FF6B7280" } };
    head.getCell(i + 1).alignment = { vertical: "middle", wrapText: true };
  });
  head.height = 30;
  for (const r of rows) {
    const row = ws.addRow(r);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (textKeys.has(c.key) && cell.value != null) cell.value = String(cell.value);
      if (!c.edit) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    });
  }
  const guide = wb.addWorksheet("Read me");
  guide.getColumn(1).width = 140;
  readMe.forEach((t, i) => { const c = guide.getCell(i + 1, 1); c.value = t; c.alignment = { wrapText: true }; if (i === 0) c.font = { bold: true, size: 14 }; });
  return wb;
}

/** Plain text of any ExcelJS cell value. */
function cellText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("").trim();
    if (v.result !== undefined) return cellText(v.result);
    if (v.text !== undefined) return cellText(v.text);
    if (v.hyperlink) return String(v.hyperlink).replace(/^mailto:/i, "");
    return "";
  }
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim();
}

/** Reads the sheet back into plain row objects keyed by COLUMNS keys (only editable columns). */
async function readWorkbook(buffer, cfg = {}) {
  const columns = cfg.columns || COLUMNS, sheetName = cfg.sheetName || "Staff";
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet(sheetName) || wb.worksheets[0];
  if (!ws) throw new Error("No sheet found");
  const nk = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, "");
  const idx = {};
  ws.getRow(1).eachCell((cell, n) => { idx[nk(cellText(cell.value))] = n; });
  const colIdx = (c) => [c.header, ...(c.aliases || [])].map(nk).map((k) => idx[k]).find(Boolean);
  const missing = columns.filter((c) => c.edit && !c.optional && !colIdx(c)).map((c) => c.header);
  if (missing.length) { const e = new Error(`These columns are missing from row 1: ${missing.join(", ")}`); e.userFacing = true; throw e; }
  const out = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const rec = { _row: rowNumber };
    let any = false;
    for (const c of columns) {
      if (!c.edit) continue;
      const at = colIdx(c);
      rec[c.key] = at ? cellText(row.getCell(at).value) : "";
      if (rec[c.key]) any = true;
    }
    if (any) out.push(rec);
  });
  return out;
}

module.exports = { COLUMNS, buildWorkbook, readWorkbook, cellText };

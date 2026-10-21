const multer = require("multer");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { httpError, norm, ensureCountyGeography, matchTextLocation } = require("../utils/geography");
const { buildWorkbook, readWorkbook } = require("../utils/staffSheet");
const { valueChainFor } = require("../utils/societyType");
const { complianceFor } = require("../utils/cooperativeCompliance");
const ROSTER = require("../data/cooperativeRoster");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } }).single("file");

const COLUMNS = [
  { key: "serialNo", header: "S/No", width: 7, edit: false },
  { key: "id", header: "System ID (do not change)", aliases: ["System ID", "ID"], width: 16, edit: true, optional: true },
  { key: "county", header: "County", width: 12, edit: true, optional: true },
  { key: "subCounty", header: "Sub-County", aliases: ["Subcounty"], width: 16, edit: true, optional: true },
  { key: "ward", header: "Ward", width: 20, edit: true, optional: true },
  { key: "name", header: "Name of Society", aliases: ["Society Name", "Name"], width: 42, edit: true },
  { key: "societyType", header: "Type of Society", aliases: ["Type"], width: 18, edit: true, optional: true },
  { key: "registrationNumber", header: "Registration Number", width: 20, edit: true, optional: true },
  { key: "registrationDate", header: "Registration Date", width: 16, edit: true, optional: true },
  { key: "compliance", header: "Compliance (read-only)", width: 22, edit: false },
  { key: "missing", header: "Still missing (read-only)", width: 70, edit: false },
];
const TEXT_KEYS = new Set(["id", "registrationNumber"]);
const LEVEL_LABEL = { COMPLIANT: "Compliant", PARTIAL: "Partial", INCOMPLETE: "Incomplete" };
const READ_ME = [
  "HOW TO USE THIS SHEET",
  "",
  "1. Edit the white columns, save the file, then upload it from Cooperatives -> Upload cooperatives sheet.",
  "2. A society is matched by its System ID if present, otherwise by its Name within the county. A name that is not in the system is added as a new society.",
  "3. A blank cell means 'leave as it is'. It never erases anything. Societies are never deleted by the sheet.",
  "4. New societies need Name of Society, Type of Society, Sub-County and Ward. Registration Number and Registration Date can be added later, here or on the society's own page.",
  "5. Registration Number must be unique and is never invented: leave it blank until you have the number from the Registrar. Registration Date: 31/12/2015, 2015-12-31 or an Excel date.",
  "6. The original county list (S/NO, County, Subcounty, WARD, NAME OF SOCIETY, TYPE OF SOCIETY) can be uploaded as it is.",
  "7. Grey columns are for reading only and are ignored on upload. Compliance shows how complete each society's record is; the rest (documents, members, committee, board, AGM) is added on the society's own page.",
  "8. If any row has a problem, NOTHING is saved and you get a list of the rows to fix.",
  "",
  "CONFIDENTIAL: for the Director and National Admin. Delete downloaded copies when you are done.",
];

const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();

function parseDate(raw) {
  const t = clean(raw);
  if (!t) return null;
  let d = null, m;
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  else if ((m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/))) d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])); // day first (Kenyan style)
  else { const x = new Date(t + " UTC"); if (!Number.isNaN(x.getTime())) d = x; }
  if (!d || Number.isNaN(d.getTime())) return undefined;
  if (d.getUTCFullYear() < 1900 || d.getTime() > Date.now() + 24 * 3600 * 1000) return undefined;
  return d;
}

// GET /api/cooperatives/sheet
async function download(req, res) {
  const where = req.user.role === "DIRECTOR" ? { countyId: req.user.countyId } : {};
  const coops = await prisma.cooperative.findMany({ where, include: { county: { select: { name: true } } }, orderBy: [{ subCounty: "asc" }, { ward: "asc" }, { name: "asc" }] });
  const comp = await complianceFor(prisma, coops);
  const rows = coops.map((c, i) => {
    const k = comp.get(c.id);
    return {
      serialNo: i + 1, id: c.id, county: c.county?.name || "", subCounty: c.subCounty, ward: c.ward, name: c.name, societyType: c.societyType || "",
      registrationNumber: c.registrationNumber || "", registrationDate: c.registrationDate || null,
      compliance: `${LEVEL_LABEL[k.level]} (${k.percent}%)`, missing: k.missing.map((m) => m.label).join("; "),
    };
  });
  const wb = await buildWorkbook(rows, { columns: COLUMNS, textKeys: TEXT_KEYS, sheetName: "Cooperatives", readMe: READ_ME, freeze: 6 });
  wb.getWorksheet("Cooperatives").getColumn(9).numFmt = "dd/mm/yyyy";
  const buf = await wb.xlsx.writeBuffer();
  await recordAudit({ userId: req.user.id, action: "COOPERATIVE_SHEET_DOWNLOADED", entityType: "Cooperative", entityId: req.user.id, metadata: { rows: rows.length } });
  res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="cooperatives-sheet.xlsx"', "Cache-Control": "no-store" });
  res.send(Buffer.from(buf));
}

/**
 * Validates every row, then applies. `fillOnly` (used by the bundled-roster load) only fills blanks and never changes existing values.
 * Returns { status, body }.
 */
async function applyRows(user, rows, { fillOnly = false, action }) {
  const counties = await prisma.county.findMany({});
  const ownCounty = user.role === "DIRECTOR" ? counties.find((c) => c.id === user.countyId) : counties.find((c) => norm(c.name) === "embu");
  if (!ownCounty) throw httpError(409, "Your county could not be found");
  const existingAll = await prisma.cooperative.findMany({ where: user.role === "DIRECTOR" ? { countyId: user.countyId } : {} });
  const everyNumber = await prisma.cooperative.findMany({ where: {}, select: { id: true, registrationNumber: true, name: true } });
  const numberOwner = new Map(everyNumber.filter((c) => c.registrationNumber).map((c) => [c.registrationNumber.toLowerCase(), c]));
  const byId = new Map(existingAll.map((c) => [c.id, c]));
  const byName = new Map(existingAll.map((c) => [`${c.countyId}|${norm(c.name)}`, c]));

  // geography reference for each county touched (loaded once, matched in memory)
  const geo = new Map();
  async function geoFor(county) {
    if (geo.has(county.id)) return geo.get(county.id);
    await ensureCountyGeography(county.id);
    const subs = await prisma.subCounty.findMany({ where: { countyId: county.id } });
    const wards = subs.length ? await prisma.ward.findMany({ where: { subCountyId: { in: subs.map((s) => s.id) } } }) : [];
    const g = { subs, wards };
    geo.set(county.id, g);
    return g;
  }
  async function locate(county, subText, wardText) {
    const { subs, wards } = await geoFor(county);
    const out = { subCounty: subText, ward: wardText };
    const m = matchTextLocation(Number(county.code), subText, wardText);
    const sc = m.subCountyCode ? subs.find((s) => Number(s.code) === m.subCountyCode) : null;
    if (sc) {
      out.subCountyId = sc.id;
      out.subCounty = sc.name; // the official spelling
      const w = m.wardCode ? wards.find((x) => Number(x.code) === m.wardCode && x.subCountyId === sc.id) : null;
      if (w) { out.wardId = w.id; out.ward = w.name; }
    }
    return out;
  }

  const errors = [], plan = [], seen = new Set(), seenNumbers = new Map();
  const bad = (r, msg) => errors.push({ row: r._row, name: r.name || null, error: msg });
  for (const r of rows) {
    r.name = clean(r.name);
    if (!r.name) { bad(r, "Name of Society is missing"); continue; }
    if (r.name.length > 160) { bad(r, "Name of Society is too long"); continue; }
    let county = ownCounty;
    if (clean(r.county)) {
      county = counties.find((c) => norm(c.name) === norm(r.county));
      if (!county) { bad(r, `County "${clean(r.county)}" was not found`); continue; }
      if (user.role === "DIRECTOR" && county.id !== user.countyId) { bad(r, "That society belongs to another county, which you can't change here"); continue; }
    }
    let existing = null;
    const sid = clean(r.id);
    if (sid) {
      existing = byId.get(sid);
      if (!existing) { bad(r, "System ID was not found (or belongs to another county). Leave it blank to match by name"); continue; }
    } else existing = byName.get(`${county.id}|${norm(r.name)}`) || null;
    const dupKey = existing ? `id|${existing.id}` : `new|${county.id}|${norm(r.name)}`;
    if (seen.has(dupKey)) { bad(r, "This society appears twice in the sheet"); continue; }
    seen.add(dupKey);

    const d = {};
    const type = clean(r.societyType);
    if (type) {
      if (type.length > 60) { bad(r, "Type of Society is too long"); continue; }
      if (!existing || !fillOnly || !existing.societyType) { d.societyType = type; d.valueChain = valueChainFor(type); }
    } else if (!existing) { bad(r, "Type of Society is required for a new society"); continue; }
    const sub = clean(r.subCounty), ward = clean(r.ward);
    if (!existing && (!sub || !ward)) { bad(r, "Sub-County and Ward are required for a new society"); continue; }
    if (sub || ward) {
      const loc = await locate(existing ? { id: existing.countyId, code: (counties.find((c) => c.id === existing.countyId) || county).code } : county, sub || (existing && existing.subCounty), ward || (existing && existing.ward));
      if (!existing || !fillOnly || !existing.wardId) Object.assign(d, { subCounty: loc.subCounty, ward: loc.ward, subCountyId: loc.subCountyId || null, wardId: loc.wardId || null });
    }
    const no = clean(r.registrationNumber);
    if (no) {
      if (no.length > 40) { bad(r, "Registration Number is too long"); continue; }
      const owner = numberOwner.get(no.toLowerCase());
      if (owner && (!existing || owner.id !== existing.id)) { bad(r, `Registration Number ${no} is already used by "${owner.name}"`); continue; }
      const other = seenNumbers.get(no.toLowerCase());
      if (other && other !== dupKey) { bad(r, `Registration Number ${no} appears on two rows`); continue; }
      seenNumbers.set(no.toLowerCase(), dupKey);
      if (!existing || !fillOnly || !existing.registrationNumber) d.registrationNumber = no;
    }
    if (clean(r.registrationDate)) {
      const dt = parseDate(r.registrationDate);
      if (dt === undefined) { bad(r, "Registration Date is not a valid past date (use 31/12/2015 or 2015-12-31)"); continue; }
      if (!existing || !fillOnly || !existing.registrationDate) d.registrationDate = dt;
    }
    plan.push({ r, existing, county, d, name: r.name });
  }
  if (errors.length) return { status: 422, body: { error: `Nothing was saved. ${errors.length} problem${errors.length === 1 ? "" : "s"} to fix in the sheet.`, errors: errors.slice(0, 50), moreErrors: Math.max(0, errors.length - 50) } };

  const result = { created: 0, updated: 0, unchanged: 0, total: plan.length, locationNotMatched: [] };
  const toCreate = [];
  for (const p of plan) {
    if (!p.existing) {
      toCreate.push({ name: p.name, countyId: p.county.id, valueChain: "OTHER", ...p.d });
      if (!p.d.wardId) result.locationNotMatched.push(p.name);
      continue;
    }
    const patch = {};
    for (const [k, v] of Object.entries(p.d)) {
      const cur = p.existing[k];
      const same = cur instanceof Date && v instanceof Date ? cur.getTime() === v.getTime() : cur === v || ((cur === null || cur === undefined) && (v === null || v === undefined));
      if (!same) patch[k] = v;
    }
    if (Object.keys(patch).length) { await prisma.cooperative.update({ where: { id: p.existing.id }, data: patch }); result.updated++; } else result.unchanged++;
    if (!(patch.wardId || p.existing.wardId) && (p.d.ward || p.existing.ward)) result.locationNotMatched.push(p.name);
  }
  for (let i = 0; i < toCreate.length; i += 100) await prisma.cooperative.createMany({ data: toCreate.slice(i, i + 100) });
  result.created = toCreate.length;
  result.locationNotMatched = [...new Set(result.locationNotMatched)].slice(0, 50);
  await recordAudit({ userId: user.id, action, entityType: "Cooperative", entityId: ownCounty.id, metadata: { created: result.created, updated: result.updated, unchanged: result.unchanged } });
  return { status: 200, body: result };
}

// POST /api/cooperatives/sheet  (multipart, field "file")
async function uploadSheet(req, res) {
  await new Promise((resolve, reject) => upload(req, res, (e) => (e ? reject(e) : resolve())));
  if (!req.file) throw httpError(400, "Choose the .xlsx file to upload");
  const buf = req.file.buffer;
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw httpError(400, "That is not an Excel (.xlsx) file");
  let rows;
  try { rows = await readWorkbook(buf, { columns: COLUMNS, sheetName: "Cooperatives" }); } catch (e) { throw httpError(400, e.userFacing ? e.message : "That file couldn't be read as an Excel workbook"); }
  if (!rows.length) throw httpError(400, "The sheet has no rows");
  if (rows.length > 1000) throw httpError(400, "At most 1000 rows per upload");
  const out = await applyRows(req.user, rows, { action: "COOPERATIVE_SHEET_UPLOADED" });
  res.status(out.status).json(out.body);
}

// POST /api/cooperatives/import-roster  — the bundled Embu list; fills blanks only, never overwrites.
async function importRoster(req, res) {
  const county = req.user.role === "DIRECTOR" ? await prisma.county.findUnique({ where: { id: req.user.countyId } }) : await prisma.county.findFirst({ where: { name: "Embu" } });
  if (!county || norm(county.name) !== "embu") throw httpError(409, "The bundled list is for Embu County, and this account is not in Embu");
  const rows = ROSTER.map((r, i) => ({ _row: i + 2, county: county.name, subCounty: r.subCounty, ward: r.ward, name: r.name, societyType: r.societyType }));
  const out = await applyRows(req.user, rows, { fillOnly: true, action: "COOPERATIVE_ROSTER_IMPORTED" });
  res.status(out.status).json({ ...out.body, totalInList: ROSTER.length });
}

module.exports = { download, uploadSheet, importRoster, parseDate };

const multer = require("multer");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { httpError } = require("../utils/geography");
const { buildWorkbook, readWorkbook } = require("../utils/staffSheet");
const { scopeWhere, effectiveStatus, COUNTY_OFFICES, MINISTRY_STATION, STATUS_LABEL } = require("./staffDirectoryController");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } }).single("file");

const blank = (v) => v === null || v === undefined || v === "";

// GET /api/staff-directory/sheet  -> .xlsx of everyone this user may see
async function download(req, res) {
  const staff = await prisma.staffMember.findMany({ where: scopeWhere(req.user), orderBy: { serialNo: "asc" } });
  const subs = await prisma.subCounty.findMany({});
  const subName = new Map(subs.map((s) => [s.id, s.name]));
  const byId = new Map(staff.map((s) => [s.id, s]));
  const rows = staff.map((s) => ({
    serialNo: s.serialNo, pNo: s.pNo, fullName: s.fullName, designation: s.designation, jobGroup: s.jobGroup, age: s.age,
    dutyStation: s.dutyStation, subCounty: s.subCountyId ? subName.get(s.subCountyId) || "" : "", phoneNumber: s.phoneNumber, email: s.email,
    remarks: s.remarks, yearEmployed: s.yearEmployed, qualifications: s.qualifications,
    reportsTo: s.reportsToId ? (byId.get(s.reportsToId) || {}).pNo || "" : "Director",
    active: s.active ? "Yes" : "No",
    statusLabel: STATUS_LABEL[effectiveStatus(s).status],
    reportsToName: s.reportsToId ? (byId.get(s.reportsToId) || {}).fullName || "" : "Director",
  }));
  const wb = await buildWorkbook(rows);
  const buf = await wb.xlsx.writeBuffer();
  await recordAudit({ userId: req.user.id, action: "STAFF_SHEET_DOWNLOADED", entityType: "StaffMember", entityId: req.user.id, metadata: { rows: rows.length } });
  res.set({
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": 'attachment; filename="staff-sheet.xlsx"',
    "Cache-Control": "no-store",
  });
  res.send(Buffer.from(buf));
}

function normPhone(raw) {
  let d = String(raw).replace(/[\s\-().+]/g, "");
  if (/^254\d{9}$/.test(d)) d = "0" + d.slice(3);
  else if (/^\d{9}$/.test(d)) d = "0" + d; // Excel drops the leading zero
  return /^0\d{9}$/.test(d) ? d : null;
}
const toInt = (raw, lo, hi) => { const n = Number(String(raw).replace(/\.0+$/, "")); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };

// POST /api/staff-directory/sheet  (multipart, field "file")
// Validates every row first; if anything is wrong nothing is saved. Blank cells leave values as they are. Nobody is deleted.
async function uploadSheet(req, res) {
  await new Promise((resolve, reject) => upload(req, res, (e) => (e ? reject(e) : resolve())));
  if (!req.file) throw httpError(400, "Choose the .xlsx file to upload");
  const buf = req.file.buffer;
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw httpError(400, "That is not an Excel (.xlsx) file");
  let rows;
  try { rows = await readWorkbook(buf); } catch (e) { throw httpError(400, e.userFacing ? e.message : "That file couldn't be read as an Excel workbook"); }
  if (!rows.length) throw httpError(400, "The sheet has no staff rows");
  if (rows.length > 500) throw httpError(400, "At most 500 rows per upload");

  const county = req.user.role === "DIRECTOR"
    ? await prisma.county.findUnique({ where: { id: req.user.countyId } })
    : await prisma.county.findFirst({ where: { name: "Embu" } });
  if (!county) throw httpError(409, "Your county could not be found");
  const subs = await prisma.subCounty.findMany({ where: { countyId: county.id } });
  const scope = scopeWhere(req.user);
  const everyone = await prisma.staffMember.findMany({ where: {} });
  const byPNo = new Map(everyone.map((s) => [s.pNo, s]));
  const inScope = (s) => (req.user.role === "NATIONAL_ADMIN" ? true : s.countyId === scope.countyId);

  const errors = [];
  const bad = (r, msg) => errors.push({ row: r._row, pNo: r.pNo || null, error: msg });
  const seen = new Set();
  const plan = [];
  for (const r of rows) {
    const pNo = r.pNo.replace(/\.0+$/, "");
    if (!/^[0-9A-Za-z\-\/]{3,20}$/.test(pNo)) { bad(r, "P/No is missing or not valid"); continue; }
    r.pNo = pNo;
    if (seen.has(pNo)) { bad(r, "This P/No appears twice in the sheet"); continue; }
    seen.add(pNo);
    const existing = byPNo.get(pNo) || null;
    if (existing && !inScope(existing)) { bad(r, "This P/No belongs to another list (a Ministry posting or another county), so it can't be changed here"); continue; }

    const d = {}; // field changes
    const set = (k, v) => { d[k] = v; };
    if (r.fullName) { if (r.fullName.length < 2 || r.fullName.length > 120) bad(r, "Full Name must be 2 to 120 characters"); else set("fullName", r.fullName); } else if (!existing) bad(r, "Full Name is required for a new person");
    if (r.designation) { if (r.designation.length < 2 || r.designation.length > 120) bad(r, "Designation must be 2 to 120 characters"); else set("designation", r.designation); } else if (!existing) bad(r, "Designation is required for a new person");
    if (r.jobGroup) { if (r.jobGroup.length > 5) bad(r, "Job Group is too long (max 5 characters)"); else set("jobGroup", r.jobGroup.toUpperCase()); }
    if (r.age) { const n = toInt(r.age, 16, 80); if (n === null) bad(r, "Age must be a whole number from 16 to 80"); else set("age", n); }
    if (r.yearEmployed) { const n = toInt(r.yearEmployed, 1960, 2100); if (n === null) bad(r, "Year Employed must be a year like 2015"); else set("yearEmployed", n); }
    if (r.phoneNumber) { const ph = normPhone(r.phoneNumber); if (!ph) bad(r, "Phone Number must be 10 digits starting with 0"); else set("phoneNumber", ph); }
    if (r.email) { const em = r.email.toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) || em.length > 120) bad(r, "Email is not valid"); else set("email", em); }
    if (r.qualifications) { if (r.qualifications.length > 500) bad(r, "Qualifications is too long (max 500 characters)"); else set("qualifications", r.qualifications); }
    if (r.remarks) { if (r.remarks.length > 200) bad(r, "Remarks is too long (max 200 characters)"); else set("remarks", r.remarks); }
    if (r.active) {
      const a = r.active.toLowerCase();
      if (["yes", "y", "true", "1"].includes(a)) set("active", true); else if (["no", "n", "false", "0"].includes(a)) set("active", false); else bad(r, 'Active must be Yes or No');
    }
    // posting
    const subByName = (n) => subs.find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (r.dutyStation || r.subCounty) {
      const station = r.dutyStation || (existing && existing.dutyStation);
      if (!station) bad(r, "Duty Station is required for a new person");
      else if (station === MINISTRY_STATION) { if (req.user.role !== "NATIONAL_ADMIN") bad(r, "Only the National Admin can post someone to the Ministry from the sheet; use Transfers"); else { set("dutyStation", station); set("dutyLevel", "MINISTRY"); set("subCountyId", null); } }
      else if (COUNTY_OFFICES.includes(station)) { set("dutyStation", station); set("dutyLevel", "COUNTY_OFFICE"); set("subCountyId", null); }
      else {
        const sc = r.subCounty ? subByName(r.subCounty) : subs.find((x) => station.toLowerCase().includes(x.name.toLowerCase()));
        if (!sc) bad(r, r.subCounty ? `Sub-County "${r.subCounty}" was not found in this county` : "Duty Station is not a county office; fill the Sub-County column");
        else { set("dutyStation", station); set("dutyLevel", "SUB_COUNTY_OFFICE"); set("subCountyId", sc.id); }
      }
    } else if (!existing) bad(r, "Duty Station is required for a new person");
    plan.push({ r, existing, d });
  }

  // reporting lines: resolve against the sheet + existing people, then check for loops
  const blankOrDirector = (v) => v === "" || /^(director|-|none)$/i.test(v);
  const finalBoss = new Map(everyone.map((s) => [s.pNo, s.reportsToId ? (everyone.find((x) => x.id === s.reportsToId) || {}).pNo || null : null]));
  const countyOfPNo = new Map(everyone.map((s) => [s.pNo, s.countyId]));
  for (const p of plan) if (!p.existing) { finalBoss.set(p.r.pNo, null); countyOfPNo.set(p.r.pNo, county.id); }
  for (const p of plan) {
    const v = p.r.reportsTo;
    if (v === "") continue;
    if (blankOrDirector(v)) { p.boss = null; finalBoss.set(p.r.pNo, null); p.setBoss = true; continue; }
    const bp = v.replace(/\.0+$/, "");
    if (bp === p.r.pNo) { bad(p.r, "A person can't report to themselves"); continue; }
    if (!countyOfPNo.has(bp)) { bad(p.r, `Reports To "${bp}" is not a P/No in this county`); continue; }
    if (countyOfPNo.get(bp) !== (p.existing ? p.existing.countyId : county.id) || !countyOfPNo.get(bp)) { bad(p.r, "Reports To must be someone in the same county"); continue; }
    p.boss = bp; p.setBoss = true; finalBoss.set(p.r.pNo, bp);
  }
  for (const p of plan) {
    let cur = finalBoss.get(p.r.pNo), hops = 0;
    while (cur && hops++ < 100) { if (cur === p.r.pNo) { bad(p.r, "Reports To would make a loop"); break; } cur = finalBoss.get(cur); }
  }
  if (errors.length) return res.status(422).json({ error: `Nothing was saved. ${errors.length} problem${errors.length === 1 ? "" : "s"} to fix in the sheet.`, errors: errors.slice(0, 50), moreErrors: Math.max(0, errors.length - 50) });

  // apply
  const result = { created: 0, updated: 0, unchanged: 0, total: plan.length };
  const idOf = new Map(everyone.map((s) => [s.pNo, s.id]));
  let postings = 0;
  for (const p of plan) {
    if (!p.existing) {
      const maxSerial = everyone.reduce((m, s) => Math.max(m, s.serialNo || 0), 0) + result.created + 1;
      const made = await prisma.staffMember.create({ data: { pNo: p.r.pNo, serialNo: maxSerial, countyId: p.d.dutyLevel === "MINISTRY" ? null : county.id, ...p.d } });
      idOf.set(p.r.pNo, made.id); result.created++;
      continue;
    }
    const patch = {};
    for (const [k, v] of Object.entries(p.d)) if (p.existing[k] !== v && !(blank(p.existing[k]) && blank(v))) patch[k] = v;
    if (patch.dutyLevel === "MINISTRY") patch.countyId = null;
    if ("dutyStation" in patch || "dutyLevel" in patch || "subCountyId" in patch) postings++;
    if (Object.keys(patch).length) { await prisma.staffMember.update({ where: { id: p.existing.id }, data: patch }); p.changed = true; } else p.changed = false;
  }
  // reporting lines after everyone exists
  for (const p of plan) {
    if (!p.setBoss) continue;
    const want = p.boss ? idOf.get(p.boss) : null;
    const id = idOf.get(p.r.pNo);
    const cur = p.existing ? p.existing.reportsToId || null : null;
    if ((cur || null) !== (want || null)) { await prisma.staffMember.update({ where: { id }, data: { reportsToId: want || null } }); p.changed = true; }
  }
  for (const p of plan) if (p.existing) { if (p.changed) result.updated++; else result.unchanged++; }
  await recordAudit({ userId: req.user.id, action: "STAFF_SHEET_UPLOADED", entityType: "StaffMember", entityId: county.id, metadata: { created: result.created, updated: result.updated, unchanged: result.unchanged, postingsChanged: postings } });
  res.json(result);
}

module.exports = { download, uploadSheet };

const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { httpError } = require("../utils/geography");
const { computeMerit, NEXT_LEVEL } = require("../utils/transferMerit");
const ROSTER = require("../data/staffRoster");

const STATUS_LABEL = { ACTIVE_OFFICE: "Active at the office", FIELDWORK: "On fieldwork", ON_LEAVE: "On leave" };
const COUNTY_OFFICES = ["County Headquarters, Director's Office", "County Headquarters, CO's Office", "County Headquarters, NAVCDP"];
const MINISTRY_STATION = "State Department for Co-operatives (Ministry headquarters)";

const isSenior = (u) => ["NATIONAL_ADMIN", "DIRECTOR"].includes(u.role);

/** Staff information is for the Director (own county) and the National Admin only. */
function scopeWhere(user) {
  if (user.role === "NATIONAL_ADMIN") return {};
  if (user.role === "DIRECTOR") return { countyId: user.countyId };
  return { id: "none" };
}

/** The Director runs their county's staff; the National Admin can override anywhere. */
function canManage(user, s) {
  if (user.role === "NATIONAL_ADMIN") return true;
  if (user.role === "DIRECTOR") return s.countyId === user.countyId;
  return false;
}
/** Editing the profile itself is for Director / National Admin only. */
const canEdit = (user, s) => isSenior(user) && (user.role === "NATIONAL_ADMIN" || s.countyId === user.countyId);

/** Shows someone back at the office once their leave/fieldwork end date has passed. */
function effectiveStatus(s, now = new Date()) {
  if (s.status !== "ACTIVE_OFFICE" && s.statusUntil && new Date(s.statusUntil) < now) {
    return { status: "ACTIVE_OFFICE", expired: true, was: s.status };
  }
  return { status: s.status, expired: false };
}

function toPublic(s, user, extra = {}) {
  const eff = effectiveStatus(s);
  const out = {
    id: s.id, serialNo: s.serialNo, pNo: s.pNo, fullName: s.fullName, designation: s.designation, jobGroup: s.jobGroup, age: s.age,
    dutyStation: s.dutyStation, dutyLevel: s.dutyLevel, countyId: s.countyId, subCountyId: s.subCountyId,
    phoneNumber: s.phoneNumber, email: s.email, yearEmployed: s.yearEmployed, qualifications: s.qualifications,
    status: eff.status, statusLabel: STATUS_LABEL[eff.status], statusNote: eff.expired ? null : s.statusNote,
    statusSince: s.statusSince, statusUntil: s.statusUntil, statusEnded: eff.expired, active: s.active, hasAccount: Boolean(s.userId),
    missing: ["jobGroup", "age", "phoneNumber", "email", "yearEmployed", "qualifications"].filter((k) => s[k] === null || s[k] === undefined || s[k] === ""),
    canManage: canManage(user, s), canEdit: canEdit(user, s),
    ...extra,
  };
  if (isSenior(user)) out.remarks = s.remarks; // sensitive: not shown to Sub-County Officers
  return out;
}

async function load(req) {
  const s = await prisma.staffMember.findUnique({ where: { id: req.params.id } });
  if (!s) throw httpError(404, "Staff member not found");
  const visible = await prisma.staffMember.findFirst({ where: { id: s.id, ...scopeWhere(req.user) } });
  if (!visible) throw httpError(403, "This staff member is outside your area");
  return s;
}

// GET /api/staff-directory
async function list(req, res) {
  const where = { ...scopeWhere(req.user), active: true };
  if (req.query.dutyLevel) where.dutyLevel = String(req.query.dutyLevel);
  if (req.query.subCountyId) where.subCountyId = String(req.query.subCountyId);
  const rows = await prisma.staffMember.findMany({ where, orderBy: { serialNo: "asc" } });
  const out = rows.map((s) => toPublic(s, req.user));
  const counts = { ACTIVE_OFFICE: 0, FIELDWORK: 0, ON_LEAVE: 0 };
  out.forEach((s) => { counts[s.status]++; });
  res.json({ staff: out, counts, total: out.length });
}

// GET /api/staff-directory/:id  (profile, status history, transfers, merit)
async function getOne(req, res) {
  const s = await load(req);
  const [history, transfers] = await Promise.all([
    prisma.staffStatusChange.findMany({ where: { staffId: s.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.staffTransfer.findMany({ where: { staffId: s.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const open = transfers.find((t) => t.status === "PROPOSED") || null;
  const next = NEXT_LEVEL[s.dutyLevel] || null;
  const colleagues = s.countyId ? await prisma.staffMember.findMany({ where: { countyId: s.countyId, active: true }, orderBy: { serialNo: "asc" } }) : [];
  const brief = (x) => ({ id: x.id, fullName: x.fullName, designation: x.designation });
  res.json({
    ...toPublic(s, req.user),
    reportsTo: s.reportsToId ? brief(colleagues.find((x) => x.id === s.reportsToId) || { id: s.reportsToId, fullName: "(not in this county)", designation: "" }) : null,
    directReports: colleagues.filter((x) => x.reportsToId === s.id).map(brief),
    reportsToOptions: canManage(req.user, s) ? colleagues.filter((x) => x.id !== s.id).map(brief) : [],
    history,
    transfers,
    transfer: {
      nextLevel: next,
      merit: next ? computeMerit(s) : null,
      options: next === "COUNTY_OFFICE" ? COUNTY_OFFICES : next === "MINISTRY" ? [MINISTRY_STATION] : [],
      open,
      canPropose: Boolean(next) && !open && canManage(req.user, s),
    },
  });
}

const statusSchema = z.object({
  status: z.enum(["ACTIVE_OFFICE", "FIELDWORK", "ON_LEAVE"]),
  note: z.string().trim().max(200).optional().or(z.literal("")),
  until: z.string().optional().or(z.literal("")),
});

// PUT /api/staff-directory/:id/status
async function setStatus(req, res) {
  const s = await load(req);
  if (!canManage(req.user, s)) throw httpError(403, "You can't change this person's status");
  const d = statusSchema.parse(req.body);
  const now = new Date();
  let until = null;
  if (d.until) {
    until = new Date(d.until);
    if (Number.isNaN(until.getTime())) throw httpError(400, "That end date is not valid");
    if (d.status !== "ACTIVE_OFFICE" && until < new Date(now.toDateString())) throw httpError(400, "The end date can't be in the past");
  }
  if (d.status === "ACTIVE_OFFICE") until = null;
  const note = d.note ? d.note : null;
  const updated = await prisma.staffMember.update({
    where: { id: s.id },
    data: { status: d.status, statusNote: note, statusSince: now, statusUntil: until, statusUpdatedBy: req.user.id },
  });
  await prisma.staffStatusChange.create({ data: { staffId: s.id, status: d.status, note, since: now, until, changedBy: req.user.id } });
  await recordAudit({ userId: req.user.id, action: "STAFF_STATUS_CHANGED", entityType: "StaffMember", entityId: s.id, metadata: { status: d.status } });
  res.json(toPublic(updated, req.user));
}

const editSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  designation: z.string().trim().min(2).max(120).optional(),
  jobGroup: z.string().trim().max(5).nullable().optional(),
  age: z.number().int().min(16).max(80).nullable().optional(),
  phoneNumber: z.string().trim().regex(/^0\d{9}$/, "Phone number must be 10 digits starting with 0").nullable().optional(),
  email: z.string().trim().toLowerCase().email().nullable().optional(),
  yearEmployed: z.number().int().min(1960).max(2100).nullable().optional(),
  qualifications: z.string().trim().max(500).nullable().optional(),
  remarks: z.string().trim().max(200).nullable().optional(),
}).strict();

// PATCH /api/staff-directory/:id
async function edit(req, res) {
  const s = await load(req);
  if (!canEdit(req.user, s)) throw httpError(403, "Only the Director or National Admin can edit a staff profile");
  const data = editSchema.parse(req.body);
  const updated = await prisma.staffMember.update({ where: { id: s.id }, data });
  await recordAudit({ userId: req.user.id, action: "STAFF_PROFILE_EDITED", entityType: "StaffMember", entityId: s.id, metadata: { fields: Object.keys(data) } });
  res.json(toPublic(updated, req.user));
}

// ---- transfers --------------------------------------------------------------
const proposeSchema = z.object({
  toStation: z.string().trim().min(2).max(120),
  appraisalScore: z.number().min(0).max(20).nullable().optional(),
  justification: z.string().trim().min(10, "Give the reason for the transfer (at least 10 characters)").max(1000),
  effectiveDate: z.string().optional().or(z.literal("")),
});

// POST /api/staff-directory/:id/transfers
async function propose(req, res) {
  const s = await load(req);
  if (!canManage(req.user, s)) throw httpError(403, "You can't propose a transfer for this person");
  const toLevel = NEXT_LEVEL[s.dutyLevel];
  if (!toLevel) throw httpError(409, "This person is already at the Ministry; there is no higher level to transfer to");
    const d = proposeSchema.parse(req.body);
  const open = await prisma.staffTransfer.findFirst({ where: { staffId: s.id, status: "PROPOSED" } });
  if (open) throw httpError(409, "There is already a transfer waiting for a decision for this person");
  const toStation = toLevel === "MINISTRY" ? MINISTRY_STATION : d.toStation;
  if (toLevel === "COUNTY_OFFICE" && !COUNTY_OFFICES.includes(toStation)) throw httpError(400, "Choose one of the county offices");
  let effectiveDate = null;
  if (d.effectiveDate) { effectiveDate = new Date(d.effectiveDate); if (Number.isNaN(effectiveDate.getTime())) throw httpError(400, "That effective date is not valid"); }
  const merit = computeMerit(s, { appraisal: d.appraisalScore ?? null });
  const t = await prisma.staffTransfer.create({
    data: {
      staffId: s.id, fromLevel: s.dutyLevel, toLevel, fromStation: s.dutyStation, toStation, fromCountyId: s.countyId, fromSubCountyId: s.subCountyId,
      meritScore: merit.total, meritBreakdown: merit, appraisalScore: d.appraisalScore ?? null,
      justification: d.justification, effectiveDate, requestedBy: req.user.id,
    },
  });
  await recordAudit({ userId: req.user.id, action: "STAFF_TRANSFER_PROPOSED", entityType: "StaffTransfer", entityId: t.id, metadata: { staffId: s.id, toLevel } });
  res.status(201).json(t);
}

/** The county Director's decision is final (both sub-county -> county and county -> Ministry).
 *  The National Admin can also decide, and can override a decision (see override). */
function mayDecide(user, t, staff) {
  if (user.role === "NATIONAL_ADMIN") return true;
  return user.role === "DIRECTOR" && staff.countyId === user.countyId;
}

/** Apply a transfer: new duty station and level; a Ministry posting leaves the county's staff list and its juniors go back to the Director. */
async function applyMove(t, staff) {
  await prisma.staffMember.update({
    where: { id: staff.id },
    data: { dutyStation: t.toStation, dutyLevel: t.toLevel, subCountyId: null, countyId: t.toLevel === "MINISTRY" ? null : staff.countyId, ...(t.toLevel === "MINISTRY" ? { reportsToId: null } : {}) },
  });
  if (t.toLevel === "MINISTRY") await prisma.staffMember.updateMany({ where: { reportsToId: staff.id }, data: { reportsToId: null } });
}

const decisionSchema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().max(300).optional().or(z.literal("")) });

// POST /api/staff-directory/transfers/:tid/decision
async function decide(req, res) {
  const t = await prisma.staffTransfer.findUnique({ where: { id: req.params.tid } });
  if (!t) throw httpError(404, "Transfer not found");
  const staff = await prisma.staffMember.findUnique({ where: { id: t.staffId } });
  const visible = await prisma.staffMember.findFirst({ where: { id: staff.id, ...scopeWhere(req.user) } });
  if (!visible) throw httpError(403, "This transfer is outside your area");
  if (t.status !== "PROPOSED") throw httpError(409, "This transfer has already been decided");
  if (!mayDecide(req.user, t, staff)) {
    throw httpError(403, "Only the county Director (or the National Admin) can decide this transfer");
  }
  const d = decisionSchema.parse(req.body);
  if (d.decision === "REJECT" && !d.note) throw httpError(400, "Give a reason for rejecting the transfer");
  const now = new Date();
  if (d.decision === "APPROVE") await applyMove(t, staff);
  const done = await prisma.staffTransfer.update({
    where: { id: t.id },
    data: { status: d.decision === "APPROVE" ? "APPROVED" : "REJECTED", decidedBy: req.user.id, decidedAt: now, decisionNote: d.note || null },
  });
  await recordAudit({ userId: req.user.id, action: d.decision === "APPROVE" ? "STAFF_TRANSFER_APPROVED" : "STAFF_TRANSFER_REJECTED", entityType: "StaffTransfer", entityId: t.id, metadata: { staffId: staff.id } });
  res.json(done);
}

const overrideSchema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().min(5, "Give the reason for the override").max(300) });

// POST /api/staff-directory/transfers/:tid/override   (National Admin only)
// Reverses a decision the Director already made: approve a rejected transfer, or undo an approved one.
async function override(req, res) {
  const t = await prisma.staffTransfer.findUnique({ where: { id: req.params.tid } });
  if (!t) throw httpError(404, "Transfer not found");
  if (!["APPROVED", "REJECTED"].includes(t.status)) throw httpError(409, "Only a decided transfer can be overridden");
  const d = overrideSchema.parse(req.body);
  const wanted = d.decision === "APPROVE" ? "APPROVED" : "REJECTED";
  if (t.status === wanted) throw httpError(409, `This transfer is already ${wanted.toLowerCase()}`);
  const staff = await prisma.staffMember.findUnique({ where: { id: t.staffId } });
  if (d.decision === "APPROVE") {
    if (staff.dutyStation !== t.fromStation) throw httpError(409, "This person has moved since; the transfer can't be applied now");
    await applyMove(t, staff);
  } else {
    if (staff.dutyStation !== t.toStation) throw httpError(409, "This person has moved since; the transfer can't be undone now");
    await prisma.staffMember.update({ where: { id: staff.id }, data: { dutyStation: t.fromStation, dutyLevel: t.fromLevel, countyId: t.fromCountyId ?? staff.countyId, subCountyId: t.fromSubCountyId ?? null } });
  }
  const done = await prisma.staffTransfer.update({ where: { id: t.id }, data: { status: wanted, overriddenBy: req.user.id, overriddenAt: new Date(), decisionNote: d.note } });
  await recordAudit({ userId: req.user.id, action: "STAFF_TRANSFER_OVERRIDDEN", entityType: "StaffTransfer", entityId: t.id, metadata: { staffId: staff.id, now: wanted } });
  res.json(done);
}

// ---- reporting lines --------------------------------------------------------
// Default: everyone reports to the Director (reportsToId = null). The Director decides who reports to whom.
const reportsSchema = z.object({ reportsToId: z.string().uuid().nullable() });

// PUT /api/staff-directory/:id/reports-to
async function setReportsTo(req, res) {
  const s = await load(req);
  if (!canManage(req.user, s)) throw httpError(403, "You can't change who this person reports to");
  const { reportsToId } = reportsSchema.parse(req.body);
  if (reportsToId) {
    if (reportsToId === s.id) throw httpError(400, "Someone can't report to themselves");
    const boss = await prisma.staffMember.findUnique({ where: { id: reportsToId } });
    if (!boss || !boss.active || boss.countyId !== s.countyId || !s.countyId) throw httpError(400, "Choose an active colleague in the same county");
    // no loops: walk up from the new boss
    let cur = boss, hops = 0;
    while (cur && cur.reportsToId && hops++ < 50) {
      if (cur.reportsToId === s.id) throw httpError(400, "That would make a loop: they already report (directly or not) to this person");
      cur = await prisma.staffMember.findUnique({ where: { id: cur.reportsToId } });
    }
  }
  const updated = await prisma.staffMember.update({ where: { id: s.id }, data: { reportsToId: reportsToId || null } });
  await recordAudit({ userId: req.user.id, action: "STAFF_REPORTING_LINE_CHANGED", entityType: "StaffMember", entityId: s.id, metadata: { toDirector: !reportsToId } });
  res.json(toPublic(updated, req.user));
}

// POST /api/staff-directory/transfers/:tid/cancel
async function cancel(req, res) {
  const t = await prisma.staffTransfer.findUnique({ where: { id: req.params.tid } });
  if (!t) throw httpError(404, "Transfer not found");
  if (t.status !== "PROPOSED") throw httpError(409, "Only a transfer that is still waiting can be cancelled");
  if (t.requestedBy !== req.user.id && req.user.role !== "NATIONAL_ADMIN") throw httpError(403, "Only the person who proposed it, or the National Admin, can cancel it");
  const done = await prisma.staffTransfer.update({ where: { id: t.id }, data: { status: "CANCELLED", decidedBy: req.user.id, decidedAt: new Date() } });
  await recordAudit({ userId: req.user.id, action: "STAFF_TRANSFER_CANCELLED", entityType: "StaffTransfer", entityId: t.id, metadata: { staffId: t.staffId } });
  res.json(done);
}

// GET /api/staff-directory/transfers?status=PROPOSED  (queue for deciders)
async function listTransfers(req, res) {
  const status = ["PROPOSED", "APPROVED", "REJECTED", "CANCELLED"].includes(req.query.status) ? req.query.status : "PROPOSED";
  const visible = await prisma.staffMember.findMany({ where: scopeWhere(req.user) });
  const byId = new Map(visible.map((s) => [s.id, s]));
  const all = await prisma.staffTransfer.findMany({ where: { status }, orderBy: { createdAt: "desc" } });
  res.json(
    all.filter((t) => byId.has(t.staffId)).map((t) => {
      const s = byId.get(t.staffId);
      return { ...t, staffName: s.fullName, staffDesignation: s.designation, canDecide: t.status === "PROPOSED" && mayDecide(req.user, t, s), canOverride: req.user.role === "NATIONAL_ADMIN" && ["APPROVED", "REJECTED"].includes(t.status) };
    })
  );
}

// GET /api/staff-directory/merit?level=SUB_COUNTY_OFFICE|COUNTY_OFFICE
// Everyone at that level who could move up, best merit first (automatic points only).
async function meritRanking(req, res) {
  const level = req.query.level === "COUNTY_OFFICE" ? "COUNTY_OFFICE" : "SUB_COUNTY_OFFICE";
  const rows = await prisma.staffMember.findMany({ where: { ...scopeWhere(req.user), active: true, dutyLevel: level } });
  const open = new Set((await prisma.staffTransfer.findMany({ where: { status: "PROPOSED" } })).map((t) => t.staffId));
  const ranked = rows
    .map((s) => ({ id: s.id, fullName: s.fullName, designation: s.designation, jobGroup: s.jobGroup, dutyStation: s.dutyStation, merit: computeMerit(s), pending: open.has(s.id), canManage: canManage(req.user, s) }))
    .sort((a, b) => b.merit.automatic - a.merit.automatic || a.fullName.localeCompare(b.fullName));
  res.json({ level, nextLevel: NEXT_LEVEL[level], ranked });
}

// POST /api/staff-directory/import-roster
// Loads the bundled Embu roster. Never overwrites: a person already there (same
// P/No) only has blank fields filled in; status and transfers are untouched.
async function importRoster(req, res) {
  const county = req.user.role === "DIRECTOR"
    ? await prisma.county.findUnique({ where: { id: req.user.countyId } })
    : await prisma.county.findFirst({ where: { name: "Embu" } });
  if (!county || county.name !== "Embu") throw httpError(409, "The bundled roster is for Embu County, and this account is not in Embu");
  const subs = await prisma.subCounty.findMany({ where: { countyId: county.id } });
  const subId = (name) => (subs.find((s) => s.name.toLowerCase() === name.toLowerCase()) || {}).id || null;
  const result = { created: 0, filled: 0, unchanged: 0, noSubCounty: [] };
  for (const r of ROSTER) {
    const base = {
      serialNo: r.serialNo, fullName: r.fullName, designation: r.designation, jobGroup: r.jobGroup, age: r.age,
      dutyStation: r.dutyStation, dutyLevel: r.dutyLevel, phoneNumber: r.phoneNumber, email: r.email,
      remarks: r.remarks, yearEmployed: r.yearEmployed, qualifications: r.qualifications,
    };
    const subCountyId = r.subCounty ? subId(r.subCounty) : null;
    if (r.subCounty && !subCountyId) result.noSubCounty.push(r.subCounty);
    const existing = await prisma.staffMember.findUnique({ where: { pNo: r.pNo } });
    if (!existing) {
      await prisma.staffMember.create({ data: { pNo: r.pNo, countyId: county.id, subCountyId, ...base } });
      result.created++;
      continue;
    }
    const patch = {};
    for (const [k, v] of Object.entries({ ...base, subCountyId })) {
      if ((existing[k] === null || existing[k] === undefined || existing[k] === "") && v !== null && v !== undefined && v !== "") patch[k] = v;
    }
    if (Object.keys(patch).length) { await prisma.staffMember.update({ where: { id: existing.id }, data: patch }); result.filled++; } else result.unchanged++;
  }
  await recordAudit({ userId: req.user.id, action: "STAFF_ROSTER_IMPORTED", entityType: "StaffMember", entityId: county.id, metadata: { created: result.created, filled: result.filled } });
  res.json({ ...result, total: ROSTER.length });
}

module.exports = { COUNTY_OFFICES, MINISTRY_STATION, STATUS_LABEL, override, setReportsTo, list, getOne, setStatus, edit, propose, decide, cancel, listTransfers, meritRanking, importRoster, effectiveStatus, scopeWhere };

const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { httpError } = require("../utils/geography");
const { normalizeKenyanPhone } = require("../utils/validators");
const R = require("../utils/leaveRules");

/*
 * Leave, on the County's leave application form.
 *   Part I   applicant (name, P/No, designation come from the Staff Directory)
 *   Part II  each supervisor up the reporting line recommends / does not recommend
 *            (the immediate supervisor also names who performs the duties meanwhile)
 *   Part III the Head of Department (the county Director) approves / does not approve
 *   Part IV  leave computation, worked out by the system at the final decision
 * The chain is the Staff Directory's reporting lines. Nobody is ever in their own chain.
 * The form's note is enforced: at most half the entitlement (and never more than 15 days)
 * carries into the next year; the rest is forfeited automatically.
 */

const SENIOR = ["NATIONAL_ADMIN", "DIRECTOR"];
const ROLE_LABEL = { NATIONAL_ADMIN: "National Admin", DIRECTOR: "Director", SUBCOUNTY_OFFICER: "Sub-County Officer", FIELD_OFFICER: "Field Officer", OTHER_STAFF: "Staff" };

// ---- who is who ---------------------------------------------------------------

/** The person's Staff Directory record. If the account isn't linked yet and exactly one unlinked record has the same email, link it. */
async function staffFor(user) {
  const s = await prisma.staffMember.findFirst({ where: { userId: user.id } });
  if (s) return s;
  if (!user.email) return null;
  const email = user.email.trim().toLowerCase();
  const m = (await prisma.staffMember.findMany({ where: { userId: null, active: true } })).filter((c) => c.email && c.email.trim().toLowerCase() === email);
  if (m.length !== 1) return null;
  await prisma.staffMember.update({ where: { id: m[0].id }, data: { userId: user.id } });
  await recordAudit({ userId: user.id, action: "STAFF_ACCOUNT_AUTO_LINKED", entityType: "StaffMember", entityId: m[0].id, metadata: { by: "email" } });
  return { ...m[0], userId: user.id };
}

/** Supervisors from the immediate one upward, then the Head of Department. */
async function buildChain(applicant, staff) {
  const steps = [], skipped = [];
  const isHeadUser = applicant.role === "NATIONAL_ADMIN" || applicant.role === "DIRECTOR";
  if (!isHeadUser) {
    const seen = new Set([staff.id]);
    let cur = staff;
    for (let i = 0; i < 30 && cur.reportsToId; i++) {
      const boss = await prisma.staffMember.findUnique({ where: { id: cur.reportsToId } });
      if (!boss || !boss.active || seen.has(boss.id)) break;
      seen.add(boss.id);
      const bu = boss.userId ? await prisma.user.findUnique({ where: { id: boss.userId } }) : null;
      if (bu && bu.active && SENIOR.includes(bu.role)) break; // reached the head: the Head step covers it
      if (!bu || !bu.active || bu.id === applicant.id) skipped.push(boss.fullName);
      else steps.push({ kind: "SUPERVISOR", approverId: bu.id, approverName: boss.fullName, approverDesignation: boss.designation });
      cur = boss;
    }
  }
  // Head of Department: the county's Director. A Director (or someone posted to the Ministry) goes to the National Admin.
  const toAdmin = applicant.role === "DIRECTOR" || applicant.role === "NATIONAL_ADMIN" || !staff.countyId || !applicant.countyId;
  const users = await prisma.user.findMany({ where: { active: true, role: toAdmin ? "NATIONAL_ADMIN" : "DIRECTOR", ...(toAdmin ? {} : { countyId: applicant.countyId }) } });
  let heads = users.filter((u) => u.id !== applicant.id);
  let headRole = toAdmin ? "NATIONAL_ADMIN" : "DIRECTOR";
  if (!heads.length && !toAdmin) { heads = (await prisma.user.findMany({ where: { active: true, role: "NATIONAL_ADMIN" } })).filter((u) => u.id !== applicant.id); headRole = "NATIONAL_ADMIN"; }
  if (!heads.length) throw httpError(409, "There is nobody above you to approve this leave. Ask the National Admin to set up the Director's account.");
  steps.push({ kind: "HEAD", approverRole: headRole, approverName: heads.map((h) => h.fullName).join(" / "), approverDesignation: headRole === "DIRECTOR" ? "Head of Department (Director)" : "National Admin" });
  return { steps: steps.map((s, i) => ({ ...s, stepNo: i + 1 })), skipped };
}

// ---- the leave year -----------------------------------------------------------

async function daysUsed(staffId, year, status, excludeId) {
  const rows = await prisma.leaveRequest.findMany({ where: { staffMemberId: staffId, year, leaveType: "Annual", status } });
  return rows.filter((r) => r.id !== excludeId).reduce((n, r) => n + (r.days || 0), 0);
}

/** Brought forward + entitlement for a year: as set, else carried from the year before under the cap, else the default. */
async function accountFor(staffId, year, depth = 0) {
  const rec = await prisma.leaveAccount.findFirst({ where: { staffMemberId: staffId, year } });
  if (rec) return { bf: rec.broughtForward, ent: rec.entitlement, source: "set" };
  if (depth < 6) {
    const prev = await accountFor(staffId, year - 1, depth + 1);
    const usedPrev = await daysUsed(staffId, year - 1, "APPROVED");
    if (prev.source !== "default" || usedPrev > 0) { // the year before was real: set, or leave was taken in it
      const bal = prev.bf + prev.ent - usedPrev;
      return { bf: R.carryForward(bal, prev.ent).carried, ent: prev.ent, source: "carried" };
    }
  }
  return { bf: 0, ent: R.DEFAULT_ENTITLEMENT, source: "default" };
}

async function balanceFor(staffId, year, excludeId) {
  const a = await accountFor(staffId, year);
  const taken = await daysUsed(staffId, year, "APPROVED", excludeId);
  const pending = await daysUsed(staffId, year, "PENDING", excludeId);
  const total = a.bf + a.ent;
  return { year, broughtForward: a.bf, entitlement: a.ent, taken, pending, available: total - taken - pending, balance: total - taken, source: a.source, carryCap: R.carryCap(a.ent), maxCarryDays: R.MAX_CARRY_DAYS };
}

// ---- reading ------------------------------------------------------------------

async function ensureSteps(leave, applicant) {
  let steps = await prisma.leaveStep.findMany({ where: { leaveId: leave.id }, orderBy: { stepNo: "asc" } });
  if (steps.length === 0 && leave.status === "PENDING") { // an application made before the chain of command existed
    const role = applicant && SENIOR.includes(applicant.role) ? "NATIONAL_ADMIN" : "DIRECTOR";
    const s = await prisma.leaveStep.create({ data: { leaveId: leave.id, stepNo: 1, kind: "HEAD", approverRole: role, approverName: "Head of Department", approverDesignation: role === "DIRECTOR" ? "Head of Department (Director)" : "National Admin" } });
    await prisma.leaveRequest.update({ where: { id: leave.id }, data: { currentStepNo: 1 } });
    leave.currentStepNo = 1; steps = [s];
  }
  return steps;
}

const mayAct = (user, step, applicant) => {
  if (!step || step.decision || user.id === applicant.id) return false;
  if (step.kind === "SUPERVISOR") return step.approverId === user.id;
  return user.role === "NATIONAL_ADMIN" || (user.role === "DIRECTOR" && step.approverRole === "DIRECTOR" && user.countyId === applicant.countyId);
};
const isHeadFor = (user, applicant) => user.id !== applicant.id && (user.role === "NATIONAL_ADMIN" || (user.role === "DIRECTOR" && user.countyId === applicant.countyId));

function canView(user, leave, steps, applicant) {
  if (leave.applicantId === user.id || user.role === "NATIONAL_ADMIN") return true;
  if (user.role === "DIRECTOR" && applicant && applicant.countyId === user.countyId) return true;
  return steps.some((s) => s.approverId === user.id || s.actedById === user.id);
}

function present(leave, steps, applicant, user) {
  const cur = steps.find((s) => s.stepNo === leave.currentStepNo);
  const pending = leave.status === "PENDING";
  return {
    id: leave.id, status: leave.status, leaveType: leave.leaveType, startDate: leave.startDate, endDate: leave.endDate, days: leave.days, year: leave.year,
    mobile: leave.mobile, outsideKenyaAck: leave.outsideKenyaAck, createdAt: leave.createdAt, decidedAt: leave.decidedAt, decisionNote: leave.decisionNote,
    applicant: { id: leave.applicantId, name: leave.applicantName || applicant?.fullName, pNo: leave.applicantPNo, designation: leave.applicantDesignation || applicant?.designation, countyName: applicant?.county?.name || null },
    relief: { name: leave.reliefName, pNo: leave.reliefPNo, designation: leave.reliefDesignation },
    chainSkipped: leave.chainSkipped,
    thro: steps.filter((s) => s.kind === "SUPERVISOR").map((s) => ({ name: s.approverName, designation: s.approverDesignation })),
    steps: steps.map((s) => ({ stepNo: s.stepNo, kind: s.kind, approverName: s.approverName, approverDesignation: s.approverDesignation, decision: s.decision, remarks: s.remarks, actedByName: s.actedByName, actedByDesignation: s.actedByDesignation, actedAt: s.actedAt })),
    currentStepNo: pending ? leave.currentStepNo : null,
    waitingFor: pending && cur ? { kind: cur.kind, name: cur.approverName, designation: cur.approverDesignation } : null,
    canAct: pending && mayAct(user, cur, applicant || {}),
    canSkip: pending && cur && cur.kind === "SUPERVISOR" && isHeadFor(user, applicant || {}),
    canCancel: pending && leave.applicantId === user.id,
    needsRelief: !leave.reliefName,
    firstSupervisorStep: Boolean(cur && cur.stepNo === 1 && cur.kind === "SUPERVISOR"),
    computation: leave.compEntitlement == null ? null : { broughtForward: leave.compBroughtForward, entitlement: leave.compEntitlement, taken: leave.compTaken, deducted: leave.compDeducted, balance: leave.compBalance, carried: leave.compCarried, forfeited: leave.compForfeited },
  };
}

async function load(id) {
  const leave = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!leave) throw httpError(404, "Leave application not found");
  const applicant = await prisma.user.findUnique({ where: { id: leave.applicantId }, include: { county: { select: { name: true } } } });
  const steps = await ensureSteps(leave, applicant);
  return { leave, steps, applicant };
}

// GET /api/leave?view=mine|inbox|involved|all
async function list(req, res) {
  const view = String(req.query.view || "mine");
  let leaves = [];
  if (view === "mine") leaves = await prisma.leaveRequest.findMany({ where: { applicantId: req.user.id }, orderBy: { createdAt: "desc" } });
  else if (view === "all") {
    if (!SENIOR.includes(req.user.role)) throw httpError(403, "Only the Director and the National Admin see everyone's leave");
    leaves = await prisma.leaveRequest.findMany({ orderBy: { createdAt: "desc" } });
  } else leaves = await prisma.leaveRequest.findMany({ where: view === "inbox" ? { status: "PENDING" } : {}, orderBy: { createdAt: "desc" } });

  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(leaves.map((l) => l.applicantId))] } }, include: { county: { select: { name: true } } } });
  const uBy = new Map(users.map((u) => [u.id, u]));
  const out = [];
  for (const l of leaves) {
    const applicant = uBy.get(l.applicantId);
    if (view === "all" && req.user.role === "DIRECTOR" && applicant?.countyId !== req.user.countyId) continue;
    const steps = await ensureSteps(l, applicant);
    if (view === "inbox" && !mayAct(req.user, steps.find((s) => s.stepNo === l.currentStepNo), applicant || {})) continue;
    if (view === "involved" && l.applicantId !== req.user.id && !steps.some((s) => s.approverId === req.user.id || s.actedById === req.user.id)) continue;
    out.push(present(l, steps, applicant, req.user));
  }
  res.json(out);
}

// GET /api/leave/:id
async function getOne(req, res) {
  const { leave, steps, applicant } = await load(req.params.id);
  if (!canView(req.user, leave, steps, applicant)) throw httpError(404, "Leave application not found");
  res.json(present(leave, steps, applicant, req.user));
}

// ---- applying -----------------------------------------------------------------

const applySchema = z.object({
  leaveType: z.enum(R.LEAVE_TYPES),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  mobile: z.string().trim().min(1, "Give the mobile number you can be reached on during leave"),
  outsideKenyaAck: z.literal(true, { errorMap: () => ({ message: "Tick the box to confirm you understand the permission needed to spend leave outside Kenya" }) }),
});

async function checkApplication(user, d, { forSubmit }) {
  const staff = await staffFor(user);
  if (!staff) throw httpError(409, "Your login isn't linked to the Staff Directory yet, so the form can't be filled with your P/No. Ask the Director to link your account.");
  if (!staff.active) throw httpError(409, "Your staff record is marked inactive");
  if (d.endDate < d.startDate) throw httpError(400, "The last day is before the first day");
  const today = R.toUtcDay(new Date());
  if (R.toUtcDay(d.startDate) < today) throw httpError(400, "Leave must begin today or later");
  const days = R.daysFor(d.leaveType, d.startDate, d.endDate);
  if (days < 1) throw httpError(400, "Those dates are all weekend days. Choose working days.");
  const year = d.startDate.getUTCFullYear();
  let bal = null;
  if (d.leaveType === "Annual") {
    if (d.endDate.getUTCFullYear() !== year) throw httpError(400, "Annual leave can't run across two leave years. Apply for each year separately.");
    bal = await balanceFor(staff.id, year);
    if (days > bal.available) throw httpError(409, `You asked for ${days} working days but have ${bal.available} available for ${year} (${bal.broughtForward} brought forward + ${bal.entitlement} entitlement, less ${bal.taken} taken and ${bal.pending} already applied for).`);
  }
  const mine = await prisma.leaveRequest.findMany({ where: { applicantId: user.id, status: { in: ["PENDING", "APPROVED"] } } });
  const clash = mine.find((o) => R.toUtcDay(d.startDate) <= R.toUtcDay(o.endDate) && R.toUtcDay(d.endDate) >= R.toUtcDay(o.startDate));
  if (clash) throw httpError(409, "You already have leave applied for or approved on some of those dates");
  const chain = await buildChain(user, staff);
  return { staff, days, year, bal, chain };
}

// POST /api/leave
async function apply(req, res) {
  const d = applySchema.parse(req.body);
  const mobile = normalizeKenyanPhone(d.mobile);
  if (!mobile) throw httpError(400, "Enter a valid mobile number, e.g. 0712 345 678");
  const { staff, days, year, chain } = await checkApplication(req.user, d, { forSubmit: true });
  const leave = await prisma.leaveRequest.create({
    data: {
      applicantId: req.user.id, leaveType: d.leaveType, startDate: d.startDate, endDate: d.endDate, status: "PENDING",
      staffMemberId: staff.id, applicantName: staff.fullName, applicantPNo: staff.pNo, applicantDesignation: staff.designation,
      days, year, mobile, outsideKenyaAck: true, currentStepNo: 1, chainSkipped: chain.skipped.length ? chain.skipped.join(", ") : null,
    },
  });
  for (const s of chain.steps) await prisma.leaveStep.create({ data: { leaveId: leave.id, ...s } });
  await recordAudit({ userId: req.user.id, action: "LEAVE_APPLIED", entityType: "LeaveRequest", entityId: leave.id, metadata: { type: d.leaveType, days, steps: chain.steps.length } });
  const { steps, applicant } = await load(leave.id);
  res.status(201).json(present(leave, steps, applicant, req.user));
}

// GET /api/leave/preview?leaveType=&startDate=&endDate=  (days, balance and who it goes through, saving nothing)
async function preview(req, res) {
  const q = z.object({ leaveType: z.enum(R.LEAVE_TYPES), startDate: z.coerce.date(), endDate: z.coerce.date() }).parse(req.query);
  const staff = await staffFor(req.user);
  if (!staff) return res.json({ linked: false, message: "Your login isn't linked to the Staff Directory yet. Ask the Director to link your account." });
  const out = { linked: true, staff: { name: staff.fullName, pNo: staff.pNo, designation: staff.designation }, balance: await balanceFor(staff.id, new Date().getUTCFullYear()) };
  if (q.endDate >= q.startDate) {
    out.days = R.daysFor(q.leaveType, q.startDate, q.endDate);
    const chain = await buildChain(req.user, staff).catch((e) => ({ error: e.message }));
    if (chain.error) out.chainError = chain.error;
    else { out.thro = chain.steps.map((s) => ({ kind: s.kind, name: s.approverName, designation: s.approverDesignation })); out.skipped = chain.skipped; }
  }
  res.json(out);
}

// GET /api/leave/balance
async function myBalance(req, res) {
  const staff = await staffFor(req.user);
  if (!staff) return res.json({ linked: false });
  res.json({ linked: true, staff: { name: staff.fullName, pNo: staff.pNo, designation: staff.designation }, ...(await balanceFor(staff.id, Number(req.query.year) || new Date().getUTCFullYear())) });
}

// ---- acting on a step ---------------------------------------------------------

const reliefSchema = z.object({ name: z.string().trim().min(2).max(120), pNo: z.string().trim().max(40).optional(), designation: z.string().trim().min(2).max(120) });
const actSchema = z.object({
  decision: z.enum(["RECOMMENDED", "NOT_RECOMMENDED", "APPROVED", "NOT_APPROVED"]),
  remarks: z.string().trim().max(1000).optional(),
  relief: reliefSchema.optional(),
});

async function actorLine(user) {
  const s = await prisma.staffMember.findFirst({ where: { userId: user.id } });
  return { name: s?.fullName || user.fullName, designation: s?.designation || user.designation || ROLE_LABEL[user.role] || "" };
}

// POST /api/leave/:id/act
async function act(req, res) {
  const body = actSchema.parse(req.body);
  const { leave, steps, applicant } = await load(req.params.id);
  if (!canView(req.user, leave, steps, applicant)) throw httpError(404, "Leave application not found");
  if (leave.status !== "PENDING") throw httpError(409, "This application has already been decided or withdrawn");
  const step = steps.find((s) => s.stepNo === leave.currentStepNo);
  if (!step || step.decision) throw httpError(409, "Nothing is waiting for action on this application");
  if (!mayAct(req.user, step, applicant)) throw httpError(403, applicant.id === req.user.id ? "You can't act on your own leave application" : "It isn't your turn to act on this application");
  const supervisor = step.kind === "SUPERVISOR";
  if (supervisor && !["RECOMMENDED", "NOT_RECOMMENDED"].includes(body.decision)) throw httpError(400, "Choose Recommended or Not recommended");
  if (!supervisor && !["APPROVED", "NOT_APPROVED"].includes(body.decision)) throw httpError(400, "Choose Approved or Not approved");
  if (["NOT_RECOMMENDED", "NOT_APPROVED"].includes(body.decision) && (body.remarks || "").length < 3) throw httpError(400, "Give your reason in the remarks");

  const relief = body.relief ? { reliefName: body.relief.name, reliefPNo: body.relief.pNo || null, reliefDesignation: body.relief.designation } : null;
  const positive = ["RECOMMENDED", "APPROVED"].includes(body.decision);
  const firstSupervisor = supervisor && step.stepNo === 1;
  if (positive && (firstSupervisor || !supervisor) && !relief && !leave.reliefName) throw httpError(400, "Name the officer who will perform the duties during the leave (name and designation)");

  let computation = null;
  if (!supervisor && body.decision === "APPROVED") {
    const acct = await accountFor(leave.staffMemberId, leave.year);
    const taken = await daysUsed(leave.staffMemberId, leave.year, "APPROVED", leave.id);
    const deducted = leave.leaveType === "Annual" ? leave.days : 0;
    if (deducted > acct.bf + acct.ent - taken) throw httpError(409, `Can't approve: ${leave.days} days exceed the ${acct.bf + acct.ent - taken} left for ${leave.year}. Choose Not approved, or ask the applicant to apply for fewer days.`);
    const balance = acct.bf + acct.ent - taken - deducted;
    const cf = R.carryForward(balance, acct.ent);
    computation = { compBroughtForward: acct.bf, compEntitlement: acct.ent, compTaken: taken, compDeducted: deducted, compBalance: balance, compCarried: cf.carried, compForfeited: cf.forfeited };
  }

  const who = await actorLine(req.user);
  const now = new Date();
  const last = steps.length === step.stepNo;
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.leaveStep.updateMany({ where: { id: step.id, decision: null }, data: { decision: body.decision, remarks: body.remarks || null, actedById: req.user.id, actedByName: who.name, actedByDesignation: who.designation, actedAt: now } });
    if (claimed.count === 0) throw httpError(409, "Someone has just acted on this application");
    const patch = { ...(relief || {}) };
    if (supervisor) patch.currentStepNo = step.stepNo + 1;
    else Object.assign(patch, { status: body.decision === "APPROVED" ? "APPROVED" : "REJECTED", approverId: req.user.id, decisionNote: body.remarks || null, decidedAt: now, currentStepNo: null, ...(computation || {}) });
    await tx.leaveRequest.update({ where: { id: leave.id }, data: patch });
  });
  await recordAudit({ userId: req.user.id, action: "LEAVE_" + body.decision, entityType: "LeaveRequest", entityId: leave.id, metadata: { step: step.stepNo, of: steps.length } });
  const fresh = await load(leave.id);
  res.json(present(fresh.leave, fresh.steps, fresh.applicant, req.user));
}

// POST /api/leave/:id/skip  (Head only) when a supervisor in the chain can't act
async function skip(req, res) {
  const { reason } = z.object({ reason: z.string().trim().min(5, "Give the reason").max(500) }).parse(req.body);
  const { leave, steps, applicant } = await load(req.params.id);
  if (!isHeadFor(req.user, applicant || {})) throw httpError(403, "Only the Head of Department can pass over a supervisor");
  if (leave.status !== "PENDING") throw httpError(409, "This application has already been decided or withdrawn");
  const step = steps.find((s) => s.stepNo === leave.currentStepNo);
  if (!step || step.kind !== "SUPERVISOR" || step.decision) throw httpError(409, "There is no supervisor step waiting");
  const who = await actorLine(req.user);
  await prisma.$transaction(async (tx) => {
    const c = await tx.leaveStep.updateMany({ where: { id: step.id, decision: null }, data: { decision: "SKIPPED", remarks: reason, actedById: req.user.id, actedByName: who.name, actedByDesignation: who.designation, actedAt: new Date() } });
    if (c.count === 0) throw httpError(409, "Someone has just acted on this application");
    await tx.leaveRequest.update({ where: { id: leave.id }, data: { currentStepNo: step.stepNo + 1 } });
  });
  await recordAudit({ userId: req.user.id, action: "LEAVE_STEP_SKIPPED", entityType: "LeaveRequest", entityId: leave.id, metadata: { step: step.stepNo } });
  const fresh = await load(leave.id);
  res.json(present(fresh.leave, fresh.steps, fresh.applicant, req.user));
}

// POST /api/leave/:id/cancel  (the applicant, while it is still pending)
async function cancel(req, res) {
  const { leave, steps, applicant } = await load(req.params.id);
  if (leave.applicantId !== req.user.id) throw httpError(403, "Only the applicant can withdraw an application");
  if (leave.status !== "PENDING") throw httpError(409, "Only an application still in progress can be withdrawn");
  await prisma.leaveRequest.update({ where: { id: leave.id }, data: { status: "CANCELLED", currentStepNo: null, decidedAt: new Date() } });
  await recordAudit({ userId: req.user.id, action: "LEAVE_WITHDRAWN", entityType: "LeaveRequest", entityId: leave.id });
  const fresh = await load(leave.id);
  res.json(present(fresh.leave, fresh.steps, fresh.applicant, req.user));
}

// ---- leave accounts (Director / National Admin) -------------------------------

async function staffInScope(req) {
  const s = await prisma.staffMember.findUnique({ where: { id: req.params.staffId } });
  if (!s) throw httpError(404, "Staff member not found");
  if (req.user.role !== "NATIONAL_ADMIN" && s.countyId !== req.user.countyId) throw httpError(403, "This person is outside your county");
  return s;
}

// GET /api/leave/accounts/:staffId?year=
async function getAccount(req, res) {
  const s = await staffInScope(req);
  res.json(await balanceFor(s.id, Number(req.query.year) || new Date().getUTCFullYear()));
}

const accountSchema = z.object({ year: z.number().int().min(2020).max(2100), entitlement: z.number().int().min(1).max(60), broughtForward: z.number().int().min(0).max(60) });

// PUT /api/leave/accounts/:staffId  { year, entitlement, broughtForward }
async function setAccount(req, res) {
  const s = await staffInScope(req);
  const d = accountSchema.parse(req.body);
  const cap = R.carryCap(d.entitlement);
  if (d.broughtForward > cap) throw httpError(400, `Not allowed: only half the entitlement, and never more than ${R.MAX_CARRY_DAYS} days, can be carried forward. With an entitlement of ${d.entitlement} the most is ${cap} day(s); the rest is forfeited.`);
  const where = { staffMemberId: s.id, year: d.year };
  const ex = await prisma.leaveAccount.findFirst({ where });
  if (ex) await prisma.leaveAccount.update({ where: { id: ex.id }, data: { entitlement: d.entitlement, broughtForward: d.broughtForward, setById: req.user.id } });
  else await prisma.leaveAccount.create({ data: { ...where, entitlement: d.entitlement, broughtForward: d.broughtForward, setById: req.user.id } });
  await recordAudit({ userId: req.user.id, action: "LEAVE_ACCOUNT_SET", entityType: "StaffMember", entityId: s.id, metadata: { year: d.year, entitlement: d.entitlement, broughtForward: d.broughtForward } });
  res.json(await balanceFor(s.id, d.year));
}

module.exports = { list, getOne, apply, preview, myBalance, act, skip, cancel, getAccount, setAccount, staffFor, balanceFor, accountFor };

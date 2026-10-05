const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { areaScope, inArea, httpError } = require("../utils/geography");
const { saveFile, assertValidFile, FILE_LIST_SELECT } = require("../utils/fileStorage");

/*
 * Field operations and leave, scoped so no county (or sub-county) sees or
 * decides another's records. Previously every staff member could list every
 * leave request and field visit in the country, and any approver could decide
 * them across counties; visits could be planned for, and reports filed on,
 * cooperatives anywhere.
 *
 *   NATIONAL_ADMIN    everything
 *   DIRECTOR          their county
 *   SUBCOUNTY_OFFICER their sub-county (their county if no sub-county assigned yet)
 *   FIELD_OFFICER     their own leave and visits
 */

// Ids of the staff whose leave this user may see/decide.
async function staffIdsInArea(user) {
  const scope = areaScope(user);
  const staff = await prisma.user.findMany({ where: scope, select: { id: true } });
  return staff.map((s) => s.id);
}

// Ids of the cooperatives whose visits this user may see/decide/plan.
async function coopIdsInArea(user) {
  const scope = areaScope(user);
  const coops = await prisma.cooperative.findMany({ where: scope, select: { id: true } });
  return coops.map((c) => c.id);
}

// --- Leave requests ---

const leaveSchema = z.object({
  leaveType: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  reason: z.string().optional(),
});

async function applyLeave(req, res) {
  const data = leaveSchema.parse(req.body);
  if (data.endDate < data.startDate) throw httpError(400, "The end date is before the start date");
  const leave = await prisma.leaveRequest.create({
    data: { ...data, applicantId: req.user.id },
  });
  res.status(201).json(leave);
}

async function listLeave(req, res) {
  const { mine } = req.query;
  let where;
  if (mine === "true" || req.user.role === "FIELD_OFFICER") {
    where = { applicantId: req.user.id };
  } else if (req.user.role === "NATIONAL_ADMIN") {
    where = {};
  } else {
    where = { applicantId: { in: await staffIdsInArea(req.user) } };
  }
  const leaves = await prisma.leaveRequest.findMany({
    where,
    include: { applicant: { select: { id: true, fullName: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(leaves);
}

async function decideLeave(req, res) {
  const { approve, decisionNote } = z
    .object({ approve: z.boolean(), decisionNote: z.string().optional() })
    .parse(req.body);

  const existing = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
  if (!existing) throw httpError(404, "Leave request not found");
  if (existing.applicantId === req.user.id) throw httpError(403, "You can't decide your own leave request");
  if (existing.status !== "PENDING") throw httpError(409, "This leave request has already been decided");
  const applicant = await prisma.user.findUnique({ where: { id: existing.applicantId } });
  if (req.user.role !== "NATIONAL_ADMIN" && (!applicant || applicant.countyId !== req.user.countyId || !inArea(req.user, applicant))) {
    throw httpError(403, "This leave request is outside your area");
  }

  const leave = await prisma.leaveRequest.update({
    where: { id: req.params.id },
    data: {
      status: approve ? "APPROVED" : "REJECTED",
      approverId: req.user.id,
      decisionNote,
    },
  });

  await recordAudit({
    userId: req.user.id,
    action: approve ? "APPROVE_LEAVE" : "REJECT_LEAVE",
    entityType: "LeaveRequest",
    entityId: leave.id,
  });

  res.json(leave);
}

// --- Field visit planner ---

const visitSchema = z.object({
  cooperativeId: z.string().uuid(),
  plannedDate: z.coerce.date(),
  purpose: z.string().min(1),
});

async function planVisit(req, res) {
  const data = visitSchema.parse(req.body);
  const coop = await prisma.cooperative.findUnique({ where: { id: data.cooperativeId } });
  if (!coop) throw httpError(404, "Cooperative not found");
  if (req.user.role !== "NATIONAL_ADMIN" && (coop.countyId !== req.user.countyId || !inArea(req.user, coop))) {
    throw httpError(403, "You can only plan visits to cooperatives in your area");
  }
  const visit = await prisma.fieldVisit.create({
    data: { ...data, officerId: req.user.id },
  });
  res.status(201).json(visit);
}

async function listVisits(req, res) {
  const { mine, status } = req.query;
  let where;
  if (mine === "true" || req.user.role === "FIELD_OFFICER") {
    where = { officerId: req.user.id };
  } else if (req.user.role === "NATIONAL_ADMIN") {
    where = {};
  } else {
    where = { cooperativeId: { in: await coopIdsInArea(req.user) } };
  }
  const visits = await prisma.fieldVisit.findMany({
    where: { ...where, ...(status ? { status } : {}) },
    include: {
      officer: { select: { id: true, fullName: true } },
      cooperative: { select: { id: true, name: true } },
      report: true,
    },
    orderBy: { plannedDate: "desc" },
  });
  res.json(visits);
}

// Load a visit and confirm the user's area covers its cooperative.
async function visitInArea(req) {
  const visit = await prisma.fieldVisit.findUnique({ where: { id: req.params.id } });
  if (!visit) throw httpError(404, "Visit not found");
  const coop = await prisma.cooperative.findUnique({ where: { id: visit.cooperativeId } });
  const covered = req.user.role === "NATIONAL_ADMIN" || (coop && coop.countyId === req.user.countyId && inArea(req.user, coop));
  return { visit, coop, covered };
}

async function decideVisit(req, res) {
  const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
  const { visit, covered } = await visitInArea(req);
  if (!covered) throw httpError(403, "This visit is outside your area");
  if (visit.officerId === req.user.id && req.user.role !== "NATIONAL_ADMIN") throw httpError(403, "You can't authorise your own visit plan");
  if (visit.status !== "PLANNED") throw httpError(409, "This visit has already been decided");
  const updated = await prisma.fieldVisit.update({
    where: { id: visit.id },
    data: {
      status: approve ? "AUTHORIZED" : "REJECTED",
      approverId: req.user.id,
    },
  });
  res.json(updated);
}

const reportSchema = z.object({
  narrative: z.string().min(1),
  achievements: z.string().optional(),
  dataPoints: z.record(z.any()).optional(),
  nextActions: z.string().optional(),
});

// Only the officer who made the visit files its report, and only once the
// visit was authorised and hasn't already been reported.
async function submitVisitReport(req, res) {
  const data = reportSchema.parse(req.body);
  const { visit } = await visitInArea(req);
  if (visit.officerId !== req.user.id) throw httpError(403, "Only the officer who made this visit can file its report");
  if (visit.status !== "AUTHORIZED") {
    throw httpError(409, visit.status === "COMPLETED" ? "This visit already has a report" : "This visit hasn't been authorised");
  }

  const report = await prisma.visitReport.create({
    data: { ...data, visitId: visit.id },
  });

  await prisma.fieldVisit.update({
    where: { id: visit.id },
    data: { status: "COMPLETED" },
  });

  res.status(201).json(report);
}

// POST /field-ops/visits/:id/photos  (multipart "photos", up to 5)
// Evidence photos from a visit, added by the visiting officer (or a Director
// covering that area).
async function addVisitPhotos(req, res) {
  const { visit, coop, covered } = await visitInArea(req);
  const isOfficer = visit.officerId === req.user.id;
  const isOverseer = covered && ["DIRECTOR", "NATIONAL_ADMIN"].includes(req.user.role);
  if (!isOfficer && !isOverseer) throw httpError(403, "Only the visiting officer or their Director can add photos");
  const photos = req.files || [];
  if (!photos.length) throw httpError(400, "Attach at least one photo");
  photos.forEach((p) => assertValidFile(p, "VISIT_PHOTO"));
  const saved = [];
  for (const file of photos) {
    saved.push(await saveFile({ file, purpose: "VISIT_PHOTO", scope: { countyId: coop.countyId, cooperativeId: coop.id, visitId: visit.id }, uploadedByUserId: req.user.id }));
  }
  res.status(201).json(saved);
}

module.exports = {
  applyLeave,
  listLeave,
  decideLeave,
  planVisit,
  listVisits,
  decideVisit,
  submitVisitReport,
  addVisitPhotos,
};

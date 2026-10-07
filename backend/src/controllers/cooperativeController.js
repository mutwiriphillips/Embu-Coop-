const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { resolveLocation, areaScope, httpError } = require("../utils/geography");

const VALUE_CHAINS = [
  "COFFEE", "DAIRY", "MIRAA", "IRRIGATION", "TEA", "SUGARCANE", "COTTON",
  "CASHEWNUT", "FISHERIES", "LIVESTOCK", "POULTRY", "SACCO", "HOUSING",
  "TRANSPORT", "HANDICRAFTS", "OTHER",
];

const coopSchema = z.object({
  name: z.string().min(1),
  registrationNumber: z.string().min(1),
  valueChain: z.enum(VALUE_CHAINS),
  // Blank is treated as "not sent": Directors and officers are placed in
  // their own county by the server, so only a National Admin must choose one.
  countyId: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().uuid().optional()),
  // Either pick from the dropdowns (subCountyId / wardId) or, for older
  // clients, send the names as text; resolveLocation reconciles the two.
  subCountyId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()),
  wardId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()),
  subCounty: z.string().min(1).optional(),
  ward: z.string().min(1).optional(),
  managerId: z.string().uuid().optional().nullable(),
});

const memberSchema = z.object({
  legalName: z.string().min(1),
  nationalId: z.string().min(1),
  phoneNumber: z.string().optional(),
  gender: z.enum(["MALE", "FEMALE"]),
  shareCapital: z.number().nonnegative().default(0),
});


// GET /cooperatives?countyId=..&subCountyId=..&wardId=..&valueChain=COFFEE&q=search
// (older ?subCounty=&ward= text filters still work)
async function listCooperatives(req, res) {
  const { valueChain, subCounty, ward, q, subCountyId, wardId } = req.query;
  // Server-side area scope: a Director sees their county, a Sub-County
  // Officer their sub-county, regardless of what filters the client sends.
  const scope = areaScope(req.user);
  if (scope.subCountyId && subCountyId && subCountyId !== scope.subCountyId) {
    throw httpError(403, "You can only view your own sub-county");
  }
  const countyId = scope.countyId || req.query.countyId;

  const cooperatives = await prisma.cooperative.findMany({
    where: {
      // A Cooperative Manager only ever sees the cooperative(s) they manage.
      ...(req.user.role === "COOPERATIVE_MANAGER" ? { managerId: req.user.id } : {}),
      ...(countyId ? { countyId } : {}),
      ...(scope.subCountyId ? { subCountyId: scope.subCountyId } : subCountyId ? { subCountyId } : {}),
      ...(wardId ? { wardId } : {}),
      ...(valueChain ? { valueChain } : {}),
      ...(subCounty ? { subCounty } : {}),
      ...(ward ? { ward } : {}),
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    include: {
      manager: { select: { id: true, fullName: true } },
      county: { select: { id: true, name: true } },
      _count: { select: { members: true, documents: true } },
    },
    orderBy: { name: "asc" },
  });

  res.json(cooperatives);
}

async function getCooperative(req, res) {
  const coop = await prisma.cooperative.findUniqueOrThrow({
    where: { id: req.params.id },
    include: {
      manager: { select: { id: true, fullName: true } },
      county: { select: { id: true, name: true } },
      members: true,
      documents: true,
      committees: { include: { members: true, signatories: true } },
      agms: true,
    },
  });
  res.json(coop);
}

async function createCooperative(req, res) {
  const data = coopSchema.parse(req.body);
  const scope = areaScope(req.user);
  const countyId = scope.countyId || data.countyId;
  if (!countyId) throw httpError(400, "Choose the county for this cooperative");
  const location = await resolveLocation({ countyId, subCountyId: data.subCountyId, wardId: data.wardId, subCounty: data.subCounty, ward: data.ward });
  if (!location.subCounty || !location.ward) {
    throw httpError(400, "Choose the cooperative's sub-county and ward");
  }
  // A Sub-County Officer can only register cooperatives in their own sub-county.
  if (scope.subCountyId && location.subCountyId !== scope.subCountyId) {
    throw httpError(403, "You can only register cooperatives in your own sub-county");
  }
  const { subCountyId, wardId, subCounty, ward, ...rest } = data;

  const coop = await prisma.cooperative.create({
    data: { ...rest, countyId, ...location },
  });

  await recordAudit({
    userId: req.user.id,
    action: "CREATE_COOPERATIVE",
    entityType: "Cooperative",
    entityId: coop.id,
  });

  res.status(201).json(coop);
}

// Fields only county staff may change. A Cooperative Manager can update their
// society's name, sub-county and ward, but not its county (which decides who
// oversees it), registration number, value chain (which drives credit
// scoring), or who its manager is.
const STAFF_ONLY_COOP_FIELDS = ["countyId", "registrationNumber", "valueChain", "managerId"];

async function updateCooperative(req, res) {
  const data = coopSchema.partial().parse(req.body);
  if (req.user.role === "COOPERATIVE_MANAGER") {
    const blocked = STAFF_ONLY_COOP_FIELDS.filter((f) => data[f] !== undefined);
    if (blocked.length) {
      return res.status(403).json({ error: `Only county staff can change: ${blocked.join(", ")}` });
    }
  }
  const { subCountyId, wardId, subCounty, ward, ...rest } = data;
  // Moving a cooperative to another county is a National Admin decision.
  if (rest.countyId && req.user.role !== "NATIONAL_ADMIN" && req.user.role !== "COOPERATIVE_MANAGER" && rest.countyId !== req.user.countyId) {
    throw httpError(403, "Only the National Admin can move a cooperative to another county");
  }
  let location = {};
  if ([subCountyId, wardId, subCounty, ward].some((v) => v !== undefined)) {
    const current = req.cooperative || (await prisma.cooperative.findUnique({ where: { id: req.params.id } }));
    location = await resolveLocation({ countyId: rest.countyId || current.countyId, subCountyId, wardId, subCounty, ward });
    const scope = areaScope(req.user);
    if (scope.subCountyId && location.subCountyId && location.subCountyId !== scope.subCountyId) {
      throw httpError(403, "You can only place cooperatives in your own sub-county");
    }
  }
  const coop = await prisma.cooperative.update({
    where: { id: req.params.id },
    data: { ...rest, ...location },
  });

  await recordAudit({
    userId: req.user.id,
    action: "UPDATE_COOPERATIVE",
    entityType: "Cooperative",
    entityId: coop.id,
    metadata: data,
  });

  res.json(coop);
}

async function deleteCooperative(req, res) {
  await prisma.cooperative.delete({ where: { id: req.params.id } });
  await recordAudit({
    userId: req.user.id,
    action: "DELETE_COOPERATIVE",
    entityType: "Cooperative",
    entityId: req.params.id,
  });
  res.status(204).send();
}

// --- Members ---

async function listMembers(req, res) {
  const members = await prisma.member.findMany({
    where: { cooperativeId: req.params.id },
    orderBy: { legalName: "asc" },
  });
  res.json(members);
}

async function addMember(req, res) {
  const data = memberSchema.parse(req.body);
  const member = await prisma.member.create({
    data: { ...data, cooperativeId: req.params.id },
  });

  await recordAudit({
    userId: req.user.id,
    action: "ADD_MEMBER",
    entityType: "Member",
    entityId: member.id,
    metadata: { cooperativeId: req.params.id },
  });

  res.status(201).json(member);
}

async function updateMember(req, res) {
  const data = memberSchema.partial().parse(req.body);
  const member = await prisma.member.update({
    where: { id: req.params.memberId },
    data,
  });
  res.json(member);
}

async function removeMember(req, res) {
  await prisma.member.delete({ where: { id: req.params.memberId } });
  res.status(204).send();
}

module.exports = {
  VALUE_CHAINS,
  listCooperatives,
  getCooperative,
  createCooperative,
  updateCooperative,
  deleteCooperative,
  listMembers,
  addMember,
  updateMember,
  removeMember,
};

const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { resolveLocation, areaScope, httpError, norm } = require("../utils/geography");
const { assertBelongs } = require("../utils/ownership");
const { withLiveStatus } = require("../utils/governance");
const { optionalDate, phoneSchema, nationalIdSchema } = require("../utils/validators");

// Two societies can't share a name in one county (the Registrar doesn't allow
// it), and two entries with the same name are almost always an accidental
// double registration. A registration number is unique everywhere.
async function assertNameAndNumberFree({ countyId, name, registrationNumber, exceptId }) {
  if (name !== undefined) {
    const sameCounty = await prisma.cooperative.findMany({ where: { countyId }, select: { id: true, name: true, registrationNumber: true } });
    const twin = sameCounty.find((c) => c.id !== exceptId && norm(c.name) === norm(name));
    if (twin) {
      throw httpError(409, `A cooperative named "${twin.name}" (reg. no. ${twin.registrationNumber}) is already registered in this county. Open that record instead of registering it again.`);
    }
  }
  if (registrationNumber !== undefined) {
    const taken = await prisma.cooperative.findFirst({ where: { registrationNumber } });
    if (taken && taken.id !== exceptId) {
      throw httpError(409, `Registration number ${registrationNumber} is already used by "${taken.name}".`);
    }
  }
}

const VALUE_CHAINS = [
  "COFFEE", "DAIRY", "MIRAA", "IRRIGATION", "TEA", "SUGARCANE", "COTTON",
  "CASHEWNUT", "FISHERIES", "LIVESTOCK", "POULTRY", "SACCO", "HOUSING",
  "TRANSPORT", "HANDICRAFTS", "OTHER",
];

const coopSchema = z.object({
  name: z.string().trim().min(1),
  registrationNumber: z.string().trim().min(1),
  // Date on the Certificate of Registration. Optional in the API so existing
  // societies keep working until it is filled in.
  registrationDate: optionalDate("Date of registration"),
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

// A society can't have been registered tomorrow.
function assertNotFuture(d) {
  if (d && d.getTime() > Date.now() + 24 * 3600 * 1000) throw httpError(400, "Date of registration cannot be in the future");
}

async function getCooperative(req, res) {
  const coop = await prisma.cooperative.findUniqueOrThrow({
    where: { id: req.params.id },
    include: {
      manager: { select: { id: true, fullName: true } },
      county: { select: { id: true, name: true } },
      members: true,
      documents: { orderBy: { createdAt: "desc" } },
      committees: { include: { members: true, signatories: true }, orderBy: { createdAt: "desc" } },
      agms: true,
    },
  });
  // Committee status is recomputed from today's date (the stored value goes
  // stale as terms run out), and the committee in force is marked current.
  res.json({ ...coop, committees: withLiveStatus(coop.committees) });
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
  assertNotFuture(rest.registrationDate);
  await assertNameAndNumberFree({ countyId, name: rest.name, registrationNumber: rest.registrationNumber });

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
const STAFF_ONLY_COOP_FIELDS = ["countyId", "registrationNumber", "registrationDate", "valueChain", "managerId"];

async function updateCooperative(req, res) {
  const data = coopSchema.partial().parse(req.body);
  if (req.user.role === "COOPERATIVE_MANAGER") {
    const blocked = STAFF_ONLY_COOP_FIELDS.filter((f) => data[f] !== undefined);
    if (blocked.length) {
      return res.status(403).json({ error: `Only county staff can change: ${blocked.join(", ")}` });
    }
  }
  const { subCountyId, wardId, subCounty, ward, ...rest } = data;
  assertNotFuture(rest.registrationDate);
  // Moving a cooperative to another county is a National Admin decision.
  if (rest.countyId && req.user.role !== "NATIONAL_ADMIN" && req.user.role !== "COOPERATIVE_MANAGER" && rest.countyId !== req.user.countyId) {
    throw httpError(403, "Only the National Admin can move a cooperative to another county");
  }
  const existing = req.cooperative || (await prisma.cooperative.findUnique({ where: { id: req.params.id } }));
  if (rest.name !== undefined || rest.registrationNumber !== undefined) {
    await assertNameAndNumberFree({
      countyId: rest.countyId || existing.countyId,
      name: rest.name !== undefined && rest.name !== existing.name ? rest.name : undefined,
      registrationNumber: rest.registrationNumber !== undefined && rest.registrationNumber !== existing.registrationNumber ? rest.registrationNumber : undefined,
      exceptId: existing.id,
    });
  }
  let location = {};
  if ([subCountyId, wardId, subCounty, ward].some((v) => v !== undefined)) {
    const current = existing;
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

// Deleting is for a cooperative registered by mistake (a duplicate, a typo):
// one that holds nothing. Deleting also wipes every member, ledger entry,
// document and committee under it, so a cooperative that holds records is
// refused rather than silently emptied; the Director sees exactly what it holds.
const HOLDINGS = [
  ["members", "member"], ["documents", "document"], ["committees", "committee"], ["agms", "AGM"],
  ["candidates", "election candidate"], ["contributions", "contribution"], ["produceDeliveries", "produce delivery"],
  ["payouts", "payout"], ["assets", "asset"], ["fieldVisits", "field visit"], ["creditAssessments", "credit assessment"],
  ["supervisoryBoard", "supervisory board member"],
];

async function deleteCooperative(req, res) {
  const coop = await prisma.cooperative.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, registrationNumber: true, _count: { select: Object.fromEntries(HOLDINGS.map(([k]) => [k, true])) } },
  });
  if (!coop) throw httpError(404, "Cooperative not found");
  const files = await prisma.storedFile.count({ where: { cooperativeId: coop.id } });
  const held = HOLDINGS.filter(([k]) => coop._count[k] > 0).map(([k, label]) => `${coop._count[k]} ${label}${coop._count[k] === 1 ? "" : "s"}`);
  if (files > 0) held.push(`${files} stored file${files === 1 ? "" : "s"}`);
  if (held.length) {
    throw httpError(409, `${coop.name} (${coop.registrationNumber}) can't be deleted because it holds records: ${held.join(", ")}. Only a cooperative with nothing recorded under it (such as a duplicate registration) can be deleted.`);
  }
  await prisma.cooperative.delete({ where: { id: coop.id } });
  await recordAudit({
    userId: req.user.id,
    action: "DELETE_COOPERATIVE",
    entityType: "Cooperative",
    entityId: coop.id,
    metadata: { name: coop.name, registrationNumber: coop.registrationNumber },
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

// POST /cooperatives/:id/members/bulk
// Adds a reviewed list of members in one go (used by the PDF import). All or
// nothing: if any row is wrong, or already a member, NOTHING is saved and the
// response lists each problem by row so they can be fixed and resubmitted.
const bulkRowSchema = z.object({
  legalName: z.string().trim().min(2, "Enter the member's full name"),
  nationalId: nationalIdSchema,
  phoneNumber: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), phoneSchema.optional()),
  gender: z.enum(["MALE", "FEMALE"], { errorMap: () => ({ message: "Choose Male or Female" }) }),
});
const MAX_BULK = 2000;

async function addMembersBulk(req, res) {
  const input = req.body && req.body.members;
  if (!Array.isArray(input) || input.length === 0) throw httpError(400, "Send at least one member");
  if (input.length > MAX_BULK) throw httpError(400, `Add at most ${MAX_BULK} members at a time`);

  const rowErrors = [];
  const clean = [];
  const seen = new Map();
  input.forEach((raw, i) => {
    const parsed = bulkRowSchema.safeParse(raw);
    if (!parsed.success) {
      rowErrors.push({ row: i + 1, name: raw && raw.legalName, errors: parsed.error.issues.map((x) => x.message) });
      return;
    }
    const row = parsed.data;
    if (seen.has(row.nationalId)) {
      rowErrors.push({ row: i + 1, name: row.legalName, errors: [`ID ${row.nationalId} is also on row ${seen.get(row.nationalId)}`] });
      return;
    }
    seen.set(row.nationalId, i + 1);
    clean.push({ row: i + 1, ...row });
  });

  const existing = await prisma.member.findMany({ where: { cooperativeId: req.params.id }, select: { nationalId: true } });
  const have = new Set(existing.map((m) => String(m.nationalId).toUpperCase()));
  for (const r of clean) {
    if (have.has(r.nationalId)) rowErrors.push({ row: r.row, name: r.legalName, errors: [`ID ${r.nationalId} is already a member of this cooperative`] });
  }

  if (rowErrors.length) {
    rowErrors.sort((a, b) => a.row - b.row);
    return res.status(422).json({
      error: `${rowErrors.length} ${rowErrors.length === 1 ? "row needs" : "rows need"} fixing. Nothing was added.`,
      rowErrors,
    });
  }

  await prisma.member.createMany({
    data: clean.map(({ row, ...m }) => ({ ...m, cooperativeId: req.params.id, shareCapital: 0 })),
  });

  // Counts only: names, IDs and phones never go into the audit log.
  await recordAudit({
    userId: req.user.id,
    action: "BULK_ADD_MEMBERS",
    entityType: "Cooperative",
    entityId: req.params.id,
    metadata: { count: clean.length },
  });

  res.status(201).json({ created: clean.length });
}

async function updateMember(req, res) {
  const data = memberSchema.partial().parse(req.body);
  assertBelongs(await prisma.member.findUnique({ where: { id: req.params.memberId } }), req.params.id, "Member");
  const member = await prisma.member.update({
    where: { id: req.params.memberId },
    data,
  });
  res.json(member);
}

// Removing a member also removes their contributions, deliveries, payouts,
// assets and input credits (they cascade), which would silently change the
// cooperative's ledger and credit score. A member with any such record is
// refused; one entered by mistake, with nothing under it, can be removed.
async function removeMember(req, res) {
  const member = await prisma.member.findUnique({
    where: { id: req.params.memberId },
    select: {
      id: true, cooperativeId: true, legalName: true,
      _count: { select: { contributions: true, produceDeliveries: true, payouts: true, assets: true, inputCredits: true, inputCollections: true } },
    },
  });
  assertBelongs(member, req.params.id, "Member");
  const labels = { contributions: "contribution", produceDeliveries: "produce delivery", payouts: "payout", assets: "asset", inputCredits: "input credit", inputCollections: "input collection" };
  const held = Object.entries(member._count).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${labels[k]}${n === 1 ? "" : "s"}`);
  if (held.length) {
    throw httpError(409, `${member.legalName} can't be removed because they have records: ${held.join(", ")}. Removing them would erase that history from the cooperative's ledger.`);
  }
  await prisma.member.delete({ where: { id: member.id } });
  await recordAudit({ userId: req.user.id, action: "REMOVE_MEMBER", entityType: "Member", entityId: member.id, metadata: { cooperativeId: member.cooperativeId } });
  res.status(204).send();
}

module.exports = {
  addMembersBulk,
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

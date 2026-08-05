const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");

const coopSchema = z.object({
  name: z.string().min(1),
  registrationNumber: z.string().min(1),
  valueChain: z.enum(["COFFEE", "DAIRY", "MIRAA", "IRRIGATION", "OTHER"]),
  subCounty: z.string().min(1),
  ward: z.string().min(1),
  managerId: z.string().uuid().optional().nullable(),
});

const memberSchema = z.object({
  legalName: z.string().min(1),
  nationalId: z.string().min(1),
  phoneNumber: z.string().optional(),
  gender: z.enum(["MALE", "FEMALE"]),
  shareCapital: z.number().nonnegative().default(0),
});

// GET /cooperatives?valueChain=COFFEE&subCounty=..&ward=..&q=search
async function listCooperatives(req, res) {
  const { valueChain, subCounty, ward, q } = req.query;

  const cooperatives = await prisma.cooperative.findMany({
    where: {
      ...(valueChain ? { valueChain } : {}),
      ...(subCounty ? { subCounty } : {}),
      ...(ward ? { ward } : {}),
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    include: {
      manager: { select: { id: true, fullName: true } },
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
  const coop = await prisma.cooperative.create({ data });

  await recordAudit({
    userId: req.user.id,
    action: "CREATE_COOPERATIVE",
    entityType: "Cooperative",
    entityId: coop.id,
  });

  res.status(201).json(coop);
}

async function updateCooperative(req, res) {
  const data = coopSchema.partial().parse(req.body);
  const coop = await prisma.cooperative.update({
    where: { id: req.params.id },
    data,
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

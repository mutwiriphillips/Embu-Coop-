const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");

const allocateSchema = z.object({
  memberId: z.string().uuid(),
  programName: z.string().min(1),
  totalAmount: z.number().positive(),
  allocatedDate: z.coerce.date(),
  expiryDate: z.coerce.date().optional(),
});

// POST /cooperatives/:id/input-credits — a Director/Sub-county Officer
// records that a government programme has allocated a farmer a specific
// input credit. This platform never disburses the credit itself and never
// decides who qualifies — it only records an allocation staff attest is
// real, then tracks how it gets drawn down. Scoped through the same
// requireCooperativeAccess used everywhere else in the financial ledger.
async function allocateCredit(req, res) {
  const data = allocateSchema.parse(req.body);

  const member = await prisma.member.findUniqueOrThrow({ where: { id: data.memberId } });
  if (member.cooperativeId !== req.params.id) {
    return res.status(400).json({ error: "Member does not belong to this cooperative" });
  }

  const credit = await prisma.farmerInputCredit.create({
    data: {
      memberId: data.memberId,
      programName: data.programName,
      totalAmount: data.totalAmount,
      remainingAmount: data.totalAmount,
      allocatedById: req.user.id,
      allocatedDate: data.allocatedDate,
      expiryDate: data.expiryDate,
    },
  });

  await recordAudit({
    userId: req.user.id,
    action: "ALLOCATE_INPUT_CREDIT",
    entityType: "FarmerInputCredit",
    entityId: credit.id,
    metadata: { memberId: data.memberId, programName: data.programName, totalAmount: data.totalAmount },
  });

  res.status(201).json(credit);
}

// GET /cooperatives/:id/input-credits?memberId=..
async function listCredits(req, res) {
  const { memberId } = req.query;
  const credits = await prisma.farmerInputCredit.findMany({
    where: {
      member: { cooperativeId: req.params.id },
      ...(memberId ? { memberId } : {}),
    },
    include: { member: { select: { id: true, legalName: true } } },
    orderBy: { allocatedDate: "desc" },
  });
  res.json(credits);
}

module.exports = { allocateCredit, listCredits };

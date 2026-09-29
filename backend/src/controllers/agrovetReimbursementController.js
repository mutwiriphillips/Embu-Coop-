const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");

// GET /agrovets/:id/collections?status=PENDING_REIMBURSEMENT
// Staff-side view of one shop's collections, scoped via requireAgrovetShopAccess.
async function listShopCollectionsForStaff(req, res) {
  const { status } = req.query;
  const collections = await prisma.inputCollection.findMany({
    where: { agrovetShopId: req.params.id, ...(status ? { status } : {}) },
    include: { items: true, member: { select: { id: true, legalName: true } } },
    orderBy: { collectionDate: "desc" },
  });
  res.json(collections);
}

const reimburseSchema = z.object({
  collectionIds: z.array(z.string().uuid()).min(1),
  method: z.enum(["MPESA", "CASH", "BANK_TRANSFER", "OTHER"]).default("BANK_TRANSFER"),
  externalRef: z.string().optional(),
  periodLabel: z.string().optional(),
  reimbursementDate: z.coerce.date(),
});

// POST /agrovets/:id/reimbursements — batch-settles a named set of a shop's
// still-pending collections in one transaction. Only collections that are
// genuinely PENDING_REIMBURSEMENT and actually belong to this shop are
// eligible, so a stray ID from another shop (or one already settled) can
// never be folded into someone else's reimbursement total.
async function createReimbursement(req, res) {
  const data = reimburseSchema.parse(req.body);

  const collections = await prisma.inputCollection.findMany({
    where: { id: { in: data.collectionIds }, agrovetShopId: req.params.id, status: "PENDING_REIMBURSEMENT" },
  });

  if (collections.length !== data.collectionIds.length) {
    return res.status(409).json({
      error: "One or more collections are not eligible — they may belong to a different shop, or already be settled.",
    });
  }

  const totalAmount = collections.reduce((sum, c) => sum + Number(c.totalValue), 0);

  const reimbursement = await prisma.$transaction(async (tx) => {
    const created = await tx.agrovetReimbursement.create({
      data: {
        agrovetShopId: req.params.id,
        totalAmount,
        periodLabel: data.periodLabel,
        method: data.method,
        externalRef: data.externalRef,
        reimbursementDate: data.reimbursementDate,
        processedById: req.user.id,
      },
    });

    await tx.inputCollection.updateMany({
      where: { id: { in: data.collectionIds } },
      data: { status: "REIMBURSED", reimbursementId: created.id },
    });

    return created;
  });

  await recordAudit({
    userId: req.user.id,
    action: "REIMBURSE_AGROVET",
    entityType: "AgrovetReimbursement",
    entityId: reimbursement.id,
    metadata: { agrovetShopId: req.params.id, totalAmount, collectionCount: collections.length },
  });

  res.status(201).json(reimbursement);
}

// GET /agrovets/:id/reimbursements
async function listReimbursements(req, res) {
  const reimbursements = await prisma.agrovetReimbursement.findMany({
    where: { agrovetShopId: req.params.id },
    include: { processedBy: { select: { id: true, fullName: true } }, collections: true },
    orderBy: { reimbursementDate: "desc" },
  });
  res.json(reimbursements);
}

module.exports = { listShopCollectionsForStaff, createReimbursement, listReimbursements };

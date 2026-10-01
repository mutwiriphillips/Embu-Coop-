const bcrypt = require("bcryptjs");
const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");

// GET /agrovets?status=PENDING&countyId=.. — county-scoped for everyone
// except NATIONAL_ADMIN, enforced at the route level via the user's own
// countyId (mirrors how the cooperative registry scopes itself).
async function listAgrovets(req, res) {
  const { status } = req.query;
  const countyId = req.user.role === "NATIONAL_ADMIN" ? req.query.countyId : req.user.countyId;

  const shops = await prisma.agrovetShop.findMany({
    where: {
      ...(countyId ? { countyId } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      county: { select: { id: true, name: true } },
      reviewedBy: { select: { id: true, fullName: true } },
      approvedBy: { select: { id: true, fullName: true } },
      registeredBy: { select: { id: true, fullName: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(shops);
}

// GET /agrovets/:id — full detail, county-scoped via requireAgrovetShopAccess
async function getAgrovet(req, res) {
  const shop = await prisma.agrovetShop.findUnique({
    where: { id: req.params.id },
    include: {
      county: { select: { id: true, name: true } },
      products: { where: { active: true } },
      reviewedBy: { select: { id: true, fullName: true } },
      approvedBy: { select: { id: true, fullName: true } },
    },
  });
  res.json(shop);
}

// Tier 1: Sub-county Officer reviews (PENDING -> REVIEWED or REJECTED)
async function reviewAgrovet(req, res) {
  const { approve, note } = z.object({ approve: z.boolean(), note: z.string().optional() }).parse(req.body);

  const shop = req.targetAgrovetShop;
  if (shop.status !== "PENDING") {
    return res.status(409).json({ error: `Shop must be PENDING to review (current: ${shop.status})` });
  }

  const updated = await prisma.agrovetShop.update({
    where: { id: shop.id },
    data: {
      status: approve ? "REVIEWED" : "REJECTED",
      reviewedById: req.user.id,
      reviewedAt: new Date(),
      rejectionNote: approve ? null : note,
    },
  });

  await recordAudit({
    userId: req.user.id,
    action: approve ? "REVIEW_AGROVET_APPROVE" : "REVIEW_AGROVET_REJECT",
    entityType: "AgrovetShop",
    entityId: shop.id,
  });

  res.json(updated);
}

// Tier 2: Director signs off (REVIEWED -> APPROVED or REJECTED)
async function approveAgrovet(req, res) {
  const { approve, note } = z.object({ approve: z.boolean(), note: z.string().optional() }).parse(req.body);

  const shop = req.targetAgrovetShop;
  if (shop.status !== "REVIEWED") {
    return res.status(409).json({ error: `Shop must be REVIEWED before Director sign-off (current: ${shop.status})` });
  }

  const updated = await prisma.agrovetShop.update({
    where: { id: shop.id },
    data: {
      status: approve ? "APPROVED" : "REJECTED",
      approvedById: req.user.id,
      approvedAt: new Date(),
      rejectionNote: approve ? null : note,
    },
  });

  await recordAudit({
    userId: req.user.id,
    action: approve ? "APPROVE_AGROVET" : "REJECT_AGROVET",
    entityType: "AgrovetShop",
    entityId: shop.id,
  });

  res.json(updated);
}

// PATCH /agrovets/:id/suspend — for a shop already APPROVED that needs
// pulling out of service (e.g. a dispute) without deleting its history.
async function suspendAgrovet(req, res) {
  const shop = req.targetAgrovetShop;
  if (shop.status !== "APPROVED") {
    return res.status(409).json({ error: "Only an APPROVED shop can be suspended" });
  }
  const updated = await prisma.agrovetShop.update({ where: { id: shop.id }, data: { status: "SUSPENDED" } });
  await recordAudit({ userId: req.user.id, action: "SUSPEND_AGROVET", entityType: "AgrovetShop", entityId: shop.id });
  res.json(updated);
}


const blank = (schema) => z.preprocess((v) => (v === "" || v === null ? undefined : v), schema);
const registerSchema = z.object({
  shopName: z.string().min(1),
  ownerName: z.string().min(1),
  ownerNationalId: z.string().trim().min(1),
  phoneNumber: z.string().min(1),
  email: blank(z.string().email().optional()),
  physicalAddress: z.string().min(1),
  countyId: blank(z.string().uuid().optional()),
  subCounty: blank(z.string().optional()),
  reimbursementMsisdn: blank(z.string().optional()),
  temporaryPassword: z.string().min(8),
});

// POST /agrovets — county staff register a shop on its owner's behalf (for
// owners who won't apply online themselves). The registering officer's
// registration counts as the first-tier review, so the shop goes straight to
// REVIEWED and still needs a Director's sign-off (POST /:id/approve) before
// it can record a single collection. The owner signs in at /agrovet/login
// with their National ID and the temporary password the officer gives them.
async function registerAgrovet(req, res) {
  const data = registerSchema.parse(req.body);
  const countyId = req.user.role === "NATIONAL_ADMIN" ? data.countyId : req.user.countyId;
  if (!countyId) return res.status(400).json({ error: "Select the county this shop is in" });

  const existing = await prisma.agrovetAccount.findUnique({ where: { nationalId: data.ownerNationalId } });
  if (existing) {
    return res.status(409).json({ error: "An agrovet account already exists for this owner's National ID" });
  }

  const now = new Date();
  const shop = await prisma.agrovetShop.create({
    data: {
      name: data.shopName,
      ownerName: data.ownerName,
      phoneNumber: data.phoneNumber,
      email: data.email,
      physicalAddress: data.physicalAddress,
      countyId,
      subCounty: data.subCounty || req.user.subCounty || undefined,
      reimbursementMsisdn: data.reimbursementMsisdn,
      status: "REVIEWED",
      reviewedById: req.user.id,
      reviewedAt: now,
      registeredById: req.user.id,
      account: {
        create: {
          nationalId: data.ownerNationalId,
          phoneNumber: data.phoneNumber,
          email: data.email,
          passwordHash: await bcrypt.hash(data.temporaryPassword, 10),
        },
      },
    },
  });

  await recordAudit({
    userId: req.user.id,
    action: "REGISTER_AGROVET",
    entityType: "AgrovetShop",
    entityId: shop.id,
    metadata: { countyId, ownerNationalId: data.ownerNationalId },
  });

  res.status(201).json(shop);
}

module.exports = { registerAgrovet, listAgrovets, getAgrovet, reviewAgrovet, approveAgrovet, suspendAgrovet };

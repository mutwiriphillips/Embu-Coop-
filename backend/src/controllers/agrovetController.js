const bcrypt = require("bcryptjs");
const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { resolveLocation, areaScope, httpError } = require("../utils/geography");
const { saveFile, assertValidFile } = require("../utils/fileStorage");

// GET /agrovets?status=PENDING&countyId=.. — county-scoped for everyone
// except NATIONAL_ADMIN, enforced at the route level via the user's own
// countyId (mirrors how the cooperative registry scopes itself).
async function listAgrovets(req, res) {
  const { status, subCountyId, wardId } = req.query;
  // Director: their county. Sub-County Officer: their sub-county.
  const scope = areaScope(req.user);
  if (scope.subCountyId && subCountyId && subCountyId !== scope.subCountyId) {
    throw httpError(403, "You can only view your own sub-county");
  }
  const countyId = scope.countyId || req.query.countyId;

  const shops = await prisma.agrovetShop.findMany({
    where: {
      ...(countyId ? { countyId } : {}),
      ...(scope.subCountyId ? { subCountyId: scope.subCountyId } : subCountyId ? { subCountyId } : {}),
      ...(wardId ? { wardId } : {}),
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
  subCountyId: blank(z.string().uuid().optional()),
  wardId: blank(z.string().uuid().optional()),
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

  const scope = areaScope(req.user);
  const location = await resolveLocation({
    countyId,
    // A Sub-County Officer's shops are always in their own sub-county.
    subCountyId: scope.subCountyId || data.subCountyId,
    wardId: data.wardId,
  });
  if (!location.subCountyId || !location.wardId) throw httpError(400, "Choose the shop's sub-county and ward");

  const shopPhoto = req.files?.shopPhoto?.[0];
  const permit = req.files?.permit?.[0];
  assertValidFile(shopPhoto, "AGROVET_SHOP_PHOTO");
  assertValidFile(permit, "AGROVET_PERMIT");

  const now = new Date();
  const shop = await prisma.agrovetShop.create({
    data: {
      name: data.shopName,
      ownerName: data.ownerName,
      phoneNumber: data.phoneNumber,
      email: data.email,
      physicalAddress: data.physicalAddress,
      countyId,
      ...location,
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

  const fileScope = { countyId: shop.countyId, agrovetShopId: shop.id };
  if (shopPhoto) await saveFile({ file: shopPhoto, purpose: "AGROVET_SHOP_PHOTO", scope: fileScope, uploadedByUserId: req.user.id });
  if (permit) await saveFile({ file: permit, purpose: "AGROVET_PERMIT", scope: fileScope, uploadedByUserId: req.user.id });

  await recordAudit({
    userId: req.user.id,
    action: "REGISTER_AGROVET",
    entityType: "AgrovetShop",
    entityId: shop.id,
    metadata: { countyId, ownerNationalId: data.ownerNationalId },
  });

  res.status(201).json(shop);
}

// POST /agrovets/:id/files  (multipart: file, purpose)  staff add a shop photo
// or permit for a shop in their area (access already checked by the route).
async function uploadShopFile(req, res) {
  const purpose = req.body.purpose;
  if (!["AGROVET_SHOP_PHOTO", "AGROVET_PERMIT"].includes(purpose)) throw httpError(400, "Choose shop photo or business permit");
  const shop = req.targetAgrovetShop;
  const saved = await saveFile({ file: req.file, purpose, scope: { countyId: shop.countyId, agrovetShopId: shop.id }, uploadedByUserId: req.user.id });
  res.status(201).json(saved);
}

module.exports = { uploadShopFile, registerAgrovet, listAgrovets, getAgrovet, reviewAgrovet, approveAgrovet, suspendAgrovet };

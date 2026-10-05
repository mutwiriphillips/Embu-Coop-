const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { resolveLocation, httpError } = require("../utils/geography");
const { saveFile, assertValidFile } = require("../utils/fileStorage");

// Unlike member registration (which claims a Member record staff already
// created), an agrovet shop genuinely doesn't exist on this platform until
// it applies — so registration here CREATES the AgrovetShop itself, in
// PENDING status, alongside its login account, in one step.
const applySchema = z.object({
  shopName: z.string().min(1),
  ownerName: z.string().min(1),
  ownerNationalId: z.string().min(1),
  phoneNumber: z.string().min(1),
  email: z.preprocess((v) => (v === "" ? undefined : v), z.string().email().optional()),
  physicalAddress: z.string().min(1),
  countyId: z.string().uuid(),
  // Sub-county and ward come from the dropdowns. The sub-county is what
  // routes the application to the right Sub-County Officer for review.
  subCountyId: z.string().uuid(),
  wardId: z.string().uuid(),
  subCounty: z.string().optional(),
  reimbursementMsisdn: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  password: z.string().min(8),
});

const loginSchema = z.object({
  nationalId: z.string().min(1),
  password: z.string().min(1),
});

function signAgrovetToken(account) {
  return jwt.sign({ sub: account.id, type: "agrovet" }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });
}

function toPublicShop(shop, account) {
  return {
    shopId: shop.id,
    name: shop.name,
    ownerName: shop.ownerName,
    physicalAddress: shop.physicalAddress,
    subCounty: shop.subCounty,
    ward: shop.ward,
    status: shop.status,
    rejectionNote: shop.rejectionNote || undefined,
    county: shop.county ? { id: shop.county.id, name: shop.county.name } : undefined,
    account: { id: account.id, phoneNumber: account.phoneNumber, email: account.email },
  };
}

async function apply(req, res) {
  const data = applySchema.parse(req.body);

  const existing = await prisma.agrovetAccount.findUnique({ where: { nationalId: data.ownerNationalId } });
  if (existing) {
    return res.status(409).json({ error: "An agrovet account already exists for this National ID. Please log in instead." });
  }

  const location = await resolveLocation({ countyId: data.countyId, subCountyId: data.subCountyId, wardId: data.wardId });
  if (!location.wardId) throw httpError(400, "Choose your shop's ward");

  // Optional photo of the shop and copy of its business permit, sent with
  // the application. Checked before anything is created.
  const shopPhoto = req.files?.shopPhoto?.[0];
  const permit = req.files?.permit?.[0];
  assertValidFile(shopPhoto, "AGROVET_SHOP_PHOTO");
  assertValidFile(permit, "AGROVET_PERMIT");

  const passwordHash = await bcrypt.hash(data.password, 10);

  const shop = await prisma.agrovetShop.create({
    data: {
      name: data.shopName,
      ownerName: data.ownerName,
      phoneNumber: data.phoneNumber,
      email: data.email,
      physicalAddress: data.physicalAddress,
      countyId: data.countyId,
      ...location,
      reimbursementMsisdn: data.reimbursementMsisdn,
      account: {
        create: {
          nationalId: data.ownerNationalId,
          phoneNumber: data.phoneNumber,
          email: data.email,
          passwordHash,
        },
      },
    },
    include: { account: true, county: true },
  });

  const scope = { countyId: shop.countyId, agrovetShopId: shop.id };
  if (shopPhoto) await saveFile({ file: shopPhoto, purpose: "AGROVET_SHOP_PHOTO", scope, uploadedByAgrovetId: shop.account.id });
  if (permit) await saveFile({ file: permit, purpose: "AGROVET_PERMIT", scope, uploadedByAgrovetId: shop.account.id });

  await recordAudit({
    action: "AGROVET_APPLY",
    entityType: "AgrovetShop",
    entityId: shop.id,
    metadata: { countyId: data.countyId, ownerNationalId: data.ownerNationalId },
  });

  const token = signAgrovetToken(shop.account);
  res.status(201).json({ token, shop: toPublicShop(shop, shop.account) });
}

async function login(req, res) {
  const { nationalId, password } = loginSchema.parse(req.body);

  const account = await prisma.agrovetAccount.findUnique({
    where: { nationalId },
    include: { agrovetShop: { include: { county: true } } },
  });

  if (!account || !account.active) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, account.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  await prisma.agrovetAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });

  const token = signAgrovetToken(account);
  res.json({ token, shop: toPublicShop(account.agrovetShop, account) });
}

async function me(req, res) {
  res.json({ shop: toPublicShop(req.agrovetShop, req.agrovetAccount) });
}


// POST /api/agrovet/files  (multipart: file, purpose=AGROVET_SHOP_PHOTO|AGROVET_PERMIT)
// A shop owner adds a shop photo or business permit to their own shop. Allowed
// while the application is still pending, since a permit may be what the
// reviewing officer is waiting for.
async function uploadOwnFile(req, res) {
  const purpose = req.body.purpose;
  if (!["AGROVET_SHOP_PHOTO", "AGROVET_PERMIT"].includes(purpose)) throw httpError(400, "Choose shop photo or business permit");
  const saved = await saveFile({
    file: req.file,
    purpose,
    scope: { countyId: req.agrovetShop.countyId, agrovetShopId: req.agrovetShop.id },
    uploadedByAgrovetId: req.agrovetAccount.id,
  });
  res.status(201).json(saved);
}

module.exports = { apply, login, me, toPublicShop, uploadOwnFile };

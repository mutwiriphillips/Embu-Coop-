const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");

// GET /agrovet/farmer-lookup?nationalId=..
//
// A national ID is only unique WITHIN a cooperative in this schema (a
// deliberate choice made when Member was first modelled), so a bare ID
// lookup can — rarely, but really — match more than one Member. Rather
// than guess, this returns every match with its own active credits, and
// the shop must pick the specific memberId + farmerInputCreditId when it
// actually records a collection. No farmer's credit is ever exposed by
// membership alone; only ACTIVE credits with a remaining balance are shown.
async function farmerLookup(req, res) {
  const { nationalId } = z.object({ nationalId: z.string().min(1) }).parse(req.query);

  const members = await prisma.member.findMany({
    where: { nationalId },
    select: {
      id: true,
      legalName: true,
      cooperative: { select: { id: true, name: true } },
      inputCredits: {
        where: { status: "ACTIVE" },
        select: { id: true, programName: true, totalAmount: true, remainingAmount: true, expiryDate: true },
      },
    },
  });

  res.json(members);
}

const itemSchema = z.object({ inputProductId: z.string().uuid(), quantity: z.number().positive() });
const collectionSchema = z.object({
  farmerInputCreditId: z.string().uuid(),
  collectionDate: z.coerce.date(),
  items: z.array(itemSchema).min(1),
});

// POST /agrovet/collections — the point-of-sale event itself. Everything
// that could make this inconsistent (overdrawing a credit, billing for a
// product from a different shop, a stale price) is checked before a single
// row is written, and the write itself is one transaction: either the
// collection, its line items, and the credit decrement all land together,
// or none of them do.
async function recordCollection(req, res) {
  const data = collectionSchema.parse(req.body);

  const credit = await prisma.farmerInputCredit.findUnique({ where: { id: data.farmerInputCreditId } });
  if (!credit) return res.status(404).json({ error: "Input credit not found" });
  if (credit.status !== "ACTIVE") {
    return res.status(409).json({ error: `This credit is ${credit.status.toLowerCase()}, not active` });
  }
  if (credit.expiryDate && credit.expiryDate < data.collectionDate) {
    return res.status(409).json({ error: "This credit has expired" });
  }

  const productIds = data.items.map((i) => i.inputProductId);
  const products = await prisma.inputProduct.findMany({ where: { id: { in: productIds } } });
  const productMap = new Map(products.map((p) => [p.id, p]));

  for (const item of data.items) {
    const product = productMap.get(item.inputProductId);
    if (!product) return res.status(404).json({ error: `Product ${item.inputProductId} not found` });
    if (product.agrovetShopId !== req.agrovetShop.id) {
      return res.status(403).json({ error: `Product "${product.name}" does not belong to your shop` });
    }
    if (!product.active) {
      return res.status(409).json({ error: `Product "${product.name}" is no longer active` });
    }
  }

  const lineItems = data.items.map((item) => {
    const product = productMap.get(item.inputProductId);
    const lineTotal = Number(product.unitPrice) * item.quantity;
    return {
      inputProductId: product.id,
      productNameSnapshot: product.name,
      quantity: item.quantity,
      unitPriceSnapshot: product.unitPrice,
      lineTotal,
    };
  });
  const totalValue = lineItems.reduce((sum, li) => sum + li.lineTotal, 0);

  if (totalValue > Number(credit.remainingAmount)) {
    return res.status(409).json({
      error: `This collection (KES ${totalValue.toFixed(2)}) exceeds the farmer's remaining credit (KES ${Number(credit.remainingAmount).toFixed(2)})`,
    });
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      // Atomic, race-safe decrement: the WHERE clause re-checks the balance
      // as part of the same UPDATE statement, at the database level, not in
      // application code. If two collections against the same credit land
      // at the same instant, only one UPDATE can match this WHERE condition
      // — the other gets count: 0 and the whole request rolls back — so the
      // credit can never be driven below zero no matter how the requests
      // interleave. The pre-check above is a fast, friendly rejection for
      // the common case; this is what actually prevents a double-spend.
      const updateResult = await tx.farmerInputCredit.updateMany({
        where: { id: credit.id, status: "ACTIVE", remainingAmount: { gte: totalValue } },
        data: { remainingAmount: { decrement: totalValue } },
      });
      if (updateResult.count === 0) {
        throw new Error("INSUFFICIENT_OR_STALE_CREDIT");
      }

      const collection = await tx.inputCollection.create({
        data: {
          farmerInputCreditId: credit.id,
          memberId: credit.memberId,
          agrovetShopId: req.agrovetShop.id,
          totalValue,
          collectionDate: data.collectionDate,
          recordedByAgrovetId: req.agrovetAccount.id,
          items: { create: lineItems },
        },
        include: { items: true },
      });

      // Flip to EXHAUSTED once the balance actually hits zero — a second,
      // separate statement is fine here since it only ever narrows status,
      // never the money itself, and re-reads the just-decremented row.
      const refreshed = await tx.farmerInputCredit.findUniqueOrThrow({ where: { id: credit.id } });
      if (Number(refreshed.remainingAmount) <= 0) {
        await tx.farmerInputCredit.update({ where: { id: credit.id }, data: { status: "EXHAUSTED" } });
      }

      return collection;
    });
  } catch (err) {
    if (err.message === "INSUFFICIENT_OR_STALE_CREDIT") {
      return res.status(409).json({ error: "This credit no longer has enough remaining balance — it may have just been drawn down elsewhere." });
    }
    throw err;
  }

  await recordAudit({
    action: "RECORD_INPUT_COLLECTION",
    entityType: "InputCollection",
    entityId: result.id,
    metadata: { agrovetShopId: req.agrovetShop.id, memberId: credit.memberId, totalValue },
  });

  res.status(201).json(result);
}

// GET /agrovet/collections — the calling shop's own collection history only.
async function listShopCollections(req, res) {
  const { status } = req.query;
  const collections = await prisma.inputCollection.findMany({
    where: { agrovetShopId: req.agrovetShop.id, ...(status ? { status } : {}) },
    include: { items: true, member: { select: { id: true, legalName: true } } },
    orderBy: { collectionDate: "desc" },
  });
  res.json(collections);
}

module.exports = { farmerLookup, recordCollection, listShopCollections };

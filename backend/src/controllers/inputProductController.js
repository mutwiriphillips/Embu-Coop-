const { z } = require("zod");
const prisma = require("../config/db");

const productSchema = z.object({
  name: z.string().min(1),
  category: z.enum(["SEEDS", "FERTILIZER", "MANURE", "PESTICIDE", "EQUIPMENT", "TOOLS", "OTHER"]),
  unit: z.enum(["KG", "BAG", "LITRE", "PIECE", "OTHER"]).default("OTHER"),
  unitPrice: z.number().positive(),
});

// GET /agrovet/products — always the calling shop's own catalog, never
// another shop's; req.agrovetShop comes only from the verified token, so
// there is no ID for a shop to swap out and see someone else's prices.
async function listProducts(req, res) {
  const products = await prisma.inputProduct.findMany({
    where: { agrovetShopId: req.agrovetShop.id },
    orderBy: { name: "asc" },
  });
  res.json(products);
}

async function addProduct(req, res) {
  const data = productSchema.parse(req.body);
  const product = await prisma.inputProduct.create({
    data: { ...data, agrovetShopId: req.agrovetShop.id },
  });
  res.status(201).json(product);
}

async function updateProduct(req, res) {
  const data = productSchema.partial().parse(req.body);
  const product = await prisma.inputProduct.findUniqueOrThrow({ where: { id: req.params.productId } });
  if (product.agrovetShopId !== req.agrovetShop.id) {
    return res.status(403).json({ error: "This product does not belong to your shop" });
  }
  const updated = await prisma.inputProduct.update({ where: { id: product.id }, data });
  res.json(updated);
}

// Soft-delete only — a retired product must stay referenceable by past
// InputCollectionItem rows (which snapshot its name/price anyway), so it is
// deactivated, never actually removed.
async function deactivateProduct(req, res) {
  const product = await prisma.inputProduct.findUniqueOrThrow({ where: { id: req.params.productId } });
  if (product.agrovetShopId !== req.agrovetShop.id) {
    return res.status(403).json({ error: "This product does not belong to your shop" });
  }
  const updated = await prisma.inputProduct.update({ where: { id: product.id }, data: { active: false } });
  res.json(updated);
}

module.exports = { listProducts, addProduct, updateProduct, deactivateProduct };

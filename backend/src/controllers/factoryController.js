const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { areaScope, httpError, norm } = require("../utils/geography");
const { normalizeKenyanPhone } = require("../utils/validators");
const { VALUE_CHAINS } = require("../utils/societyType");

const blank = (v) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const factorySchema = z.object({
  name: z.string().trim().min(2, "Give the factory's name").max(120),
  valueChain: z.preprocess(blank, z.enum(VALUE_CHAINS).optional()),
  location: z.preprocess(blank, z.string().trim().max(120).optional()),
  contactPhone: z.preprocess(blank, z.string().trim().optional()).transform((v, ctx) => {
    if (v === undefined) return undefined;
    const n = normalizeKenyanPhone(v);
    if (!n) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid Kenyan phone number" }); return z.NEVER; }
    return n;
  }),
  countyId: z.preprocess(blank, z.string().uuid().optional()),
});

const shape = (f) => ({
  id: f.id, name: f.name, countyId: f.countyId, valueChain: f.valueChain, location: f.location, contactPhone: f.contactPhone,
  cooperatives: (f.cooperatives || []).map((l) => ({ id: l.cooperative?.id ?? l.cooperativeId, name: l.cooperative?.name })).sort((a, b) => String(a.name).localeCompare(String(b.name))),
});

async function loadScoped(req) {
  const f = await prisma.factory.findUnique({ where: { id: req.params.id } });
  if (!f) throw httpError(404, "Factory not found");
  if (req.user.role !== "NATIONAL_ADMIN" && f.countyId !== req.user.countyId) throw httpError(403, "This factory is outside your county");
  return f;
}

// GET /api/factories?countyId=&valueChain=
async function list(req, res) {
  const scope = areaScope(req.user);
  const countyId = scope.countyId || req.query.countyId;
  const rows = await prisma.factory.findMany({
    where: { ...(countyId ? { countyId } : {}), ...(req.query.valueChain ? { valueChain: String(req.query.valueChain) } : {}) },
    include: { cooperatives: { include: { cooperative: { select: { id: true, name: true } } } } },
    orderBy: { name: "asc" },
  });
  res.json(rows.map(shape));
}

async function assertNameFree(countyId, name, exceptId) {
  const same = await prisma.factory.findMany({ where: { countyId } });
  const twin = same.find((f) => f.id !== exceptId && norm(f.name) === norm(name));
  if (twin) throw httpError(409, `A factory called "${twin.name}" is already registered in this county`);
}

// POST /api/factories   (Director for their county; National Admin picks the county)
async function create(req, res) {
  const d = factorySchema.parse(req.body);
  const countyId = req.user.role === "NATIONAL_ADMIN" ? d.countyId : req.user.countyId;
  if (!countyId) throw httpError(400, "Choose the county for this factory");
  await assertNameFree(countyId, d.name);
  const f = await prisma.factory.create({ data: { name: d.name, countyId, valueChain: d.valueChain || null, location: d.location || null, contactPhone: d.contactPhone || null } });
  await recordAudit({ userId: req.user.id, action: "FACTORY_CREATED", entityType: "Factory", entityId: f.id });
  res.status(201).json(shape(f));
}

// PATCH /api/factories/:id
async function update(req, res) {
  const f = await loadScoped(req);
  const d = factorySchema.partial().parse(req.body);
  if (d.name !== undefined) await assertNameFree(f.countyId, d.name, f.id);
  const data = {};
  for (const k of ["name", "valueChain", "location", "contactPhone"]) if (d[k] !== undefined) data[k] = d[k];
  const u = await prisma.factory.update({ where: { id: f.id }, data });
  await recordAudit({ userId: req.user.id, action: "FACTORY_UPDATED", entityType: "Factory", entityId: f.id, metadata: { fields: Object.keys(data) } });
  res.json(shape(u));
}

// DELETE /api/factories/:id  — only a factory that pays no society (nothing is silently unlinked)
async function remove(req, res) {
  const f = await loadScoped(req);
  const links = await prisma.cooperativeFactory.findMany({ where: { factoryId: f.id } });
  if (links.length) throw httpError(409, `${f.name} is linked to ${links.length} cooperative${links.length === 1 ? "" : "s"}. Remove it from them first.`);
  await prisma.factory.delete({ where: { id: f.id } });
  await recordAudit({ userId: req.user.id, action: "FACTORY_DELETED", entityType: "Factory", entityId: f.id });
  res.json({ ok: true });
}

// POST /api/cooperatives/:id/factories  { factoryId }
async function linkToCooperative(req, res) {
  const { factoryId } = z.object({ factoryId: z.string().uuid() }).parse(req.body);
  const coop = req.cooperative;
  const f = await prisma.factory.findUnique({ where: { id: factoryId } });
  if (!f || f.countyId !== coop.countyId) throw httpError(400, "Choose a factory registered in this cooperative's county");
  const have = await prisma.cooperativeFactory.findFirst({ where: { cooperativeId: coop.id, factoryId } });
  if (!have) await prisma.cooperativeFactory.create({ data: { cooperativeId: coop.id, factoryId } });
  await recordAudit({ userId: req.user.id, action: "FACTORY_LINKED", entityType: "Cooperative", entityId: coop.id, metadata: { factoryId } });
  res.status(have ? 200 : 201).json({ ok: true });
}

// DELETE /api/cooperatives/:id/factories/:factoryId
async function unlinkFromCooperative(req, res) {
  const link = await prisma.cooperativeFactory.findFirst({ where: { cooperativeId: req.cooperative.id, factoryId: req.params.factoryId } });
  if (!link) throw httpError(404, "That factory is not linked to this cooperative");
  await prisma.cooperativeFactory.delete({ where: { id: link.id } });
  await recordAudit({ userId: req.user.id, action: "FACTORY_UNLINKED", entityType: "Cooperative", entityId: req.cooperative.id, metadata: { factoryId: req.params.factoryId } });
  res.json({ ok: true });
}

module.exports = { list, create, update, remove, linkToCooperative, unlinkFromCooperative };

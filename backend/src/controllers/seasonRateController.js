const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { areaScope, httpError } = require("../utils/geography");
const { VALUE_CHAINS } = require("../utils/societyType");

const CROP_YEAR = /^(\d{4})\/(\d{4})$/;
const MAX_ROUNDS = 12;
const EDIT_ROLES = ["NATIONAL_ADMIN", "DIRECTOR"];

function validCropYear(v) {
  const m = CROP_YEAR.exec(String(v || "").trim());
  return !!m && Number(m[2]) === Number(m[1]) + 1;
}
// Kenya's coffee and many other crop years run October to September.
function currentCropYear(now = new Date()) {
  const y = now.getUTCFullYear();
  return now.getUTCMonth() >= 9 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}
const unitFor = (valueChain) => (valueChain === "DAIRY" ? "LITERS" : "KG");

const bulkSchema = z.object({
  valueChain: z.enum(VALUE_CHAINS),
  cropYear: z.string().trim().refine(validCropYear, "Crop year looks like 2025/2026"),
  rows: z
    .array(
      z.object({
        cooperativeId: z.string().uuid(),
        factoryId: z.string().uuid().nullable().optional(),
        rounds: z
          .array(
            z.object({
              roundNo: z.number().int().min(1).max(MAX_ROUNDS),
              avgPrice: z.number().positive("A price must be more than 0").max(100000).nullable(),
            })
          )
          .max(MAX_ROUNDS)
          .default([]),
      })
    )
    .min(1)
    .max(500),
});

// GET /api/season-rates?valueChain=COFFEE&cropYear=2025/2026&countyId=
// Every society of that value chain in the caller's area, grouped by sub-county,
// with the factory and each payment round for the crop year. A round with no
// price is simply absent ("Not yet").
async function list(req, res) {
  const valueChain = String(req.query.valueChain || "COFFEE").toUpperCase();
  if (!VALUE_CHAINS.includes(valueChain)) throw httpError(400, "Unknown value chain");
  const scope = areaScope(req.user);
  const countyId = scope.countyId || req.query.countyId || undefined;
  const subCountyId = scope.subCountyId || undefined;

  const coops = await prisma.cooperative.findMany({
    where: { valueChain, ...(countyId ? { countyId } : {}), ...(subCountyId ? { subCountyId } : {}) },
    include: { county: { select: { name: true } } },
  });
  const coopIds = coops.map((c) => c.id);
  const allRecords = coopIds.length ? await prisma.cropSeasonRecord.findMany({ where: { cooperativeId: { in: coopIds } } }) : [];
  const cropYears = [...new Set(allRecords.map((r) => r.cropYear))].sort().reverse();
  let cropYear = req.query.cropYear ? String(req.query.cropYear).trim() : cropYears[0] || currentCropYear();
  if (!validCropYear(cropYear)) throw httpError(400, "Crop year looks like 2025/2026");
  if (!cropYears.includes(cropYear)) cropYears.unshift(cropYear);
  cropYears.sort().reverse();

  const records = allRecords.filter((r) => r.cropYear === cropYear);
  const recIds = records.map((r) => r.id);
  const rounds = recIds.length ? await prisma.cropSeasonRound.findMany({ where: { recordId: { in: recIds } } }) : [];
  const factoryIds = [...new Set(records.map((r) => r.factoryId).filter(Boolean))];
  const factories = factoryIds.length ? await prisma.factory.findMany({ where: { id: { in: factoryIds } } }) : [];
  const facName = new Map(factories.map((f) => [f.id, f.name]));
  const recBy = new Map(records.map((r) => [r.cooperativeId, r]));

  const groups = new Map();
  let maxRound = 2;
  for (const c of coops) {
    const rec = recBy.get(c.id);
    const rs = rec ? rounds.filter((x) => x.recordId === rec.id).map((x) => ({ roundNo: x.roundNo, avgPrice: Number(x.avgPrice) })).sort((a, b) => a.roundNo - b.roundNo) : [];
    for (const r of rs) maxRound = Math.max(maxRound, r.roundNo);
    const sub = (c.subCounty || "").trim() || "Unassigned";
    const key = (req.user.role === "NATIONAL_ADMIN" && !countyId ? `${c.county?.name || ""}|` : "") + sub;
    if (!groups.has(key)) groups.set(key, { name: sub, countyName: c.county?.name || null, label: key.includes("|") ? `${c.county?.name} — ${sub}` : sub, societies: [] });
    groups.get(key).societies.push({
      cooperativeId: c.id,
      name: c.name,
      ward: c.ward || "",
      countyId: c.countyId,
      factoryId: rec?.factoryId || null,
      factoryName: rec?.factoryId ? facName.get(rec.factoryId) || null : null,
      rounds: rs,
      hasRecord: !!rec,
    });
  }
  const subCounties = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  for (const g of subCounties) g.societies.sort((a, b) => a.name.localeCompare(b.name));

  res.json({
    valueChain,
    cropYear,
    cropYears,
    unit: unitFor(valueChain),
    roundCount: maxRound,
    canEdit: EDIT_ROLES.includes(req.user.role),
    societyCount: coops.length,
    subCounties,
  });
}

// The shared save used by the screen and by the file import. All-or-nothing: every row is
// checked before anything is written. Only the rounds listed are touched; a null price
// clears that round back to "Not yet". With dryRun it reports what WOULD change.
async function runBulk(user, data, { dryRun = false } = {}) {
  const ids = data.rows.map((r) => r.cooperativeId);
  if (new Set(ids).size !== ids.length) throw httpError(400, "A society appears twice in the list");

  const coops = await prisma.cooperative.findMany({ where: { id: { in: ids } } });
  const byId = new Map(coops.map((c) => [c.id, c]));
  const facIds = [...new Set(data.rows.map((r) => r.factoryId).filter(Boolean))];
  const facs = facIds.length ? await prisma.factory.findMany({ where: { id: { in: facIds } } }) : [];
  const facById = new Map(facs.map((f) => [f.id, f]));

  const problems = [];
  for (const row of data.rows) {
    const c = byId.get(row.cooperativeId);
    if (!c) { problems.push("A society in the list no longer exists"); continue; }
    if (user.role !== "NATIONAL_ADMIN" && c.countyId !== user.countyId) throw httpError(403, `${c.name} is outside your county`);
    if (c.valueChain !== data.valueChain) problems.push(`${c.name} is not a ${data.valueChain.toLowerCase()} society`);
    if (row.factoryId) {
      const f = facById.get(row.factoryId);
      if (!f) problems.push(`${c.name}: that factory no longer exists`);
      else if (f.countyId !== c.countyId) problems.push(`${c.name}: the factory is in another county`);
    }
    const nos = row.rounds.map((r) => r.roundNo);
    if (new Set(nos).size !== nos.length) problems.push(`${c.name}: a payment number is repeated`);
  }
  if (problems.length) return { problems };

  const stats = { societies: 0, roundsSet: 0, roundsCleared: 0, linksAdded: 0 };
  const body = async (db) => {
    for (const row of data.rows) {
      const c = byId.get(row.cooperativeId);
      const where = { cooperativeId_cropYear: { cooperativeId: c.id, cropYear: data.cropYear } };
      let rec = await db.cropSeasonRecord.findUnique({ where });
      const wantsData = row.factoryId || row.rounds.some((r) => r.avgPrice != null);
      if (!rec) {
        if (!wantsData) continue;
        rec = dryRun ? { id: null } : await db.cropSeasonRecord.create({
          data: { cooperativeId: c.id, cropYear: data.cropYear, unit: unitFor(c.valueChain), factoryId: row.factoryId || null, updatedById: user.id },
        });
      } else if (!dryRun) {
        const patch = { updatedById: user.id };
        if (row.factoryId !== undefined) patch.factoryId = row.factoryId;
        await db.cropSeasonRecord.update({ where: { id: rec.id }, data: patch });
      }
      let touched = false;
      const facChanged = !!rec.id && row.factoryId !== undefined && (rec.factoryId || null) !== (row.factoryId || null);
      for (const r of row.rounds) {
        const existing = rec.id ? await db.cropSeasonRound.findFirst({ where: { recordId: rec.id, roundNo: r.roundNo } }) : null;
        if (r.avgPrice == null) {
          if (existing) { if (!dryRun) await db.cropSeasonRound.delete({ where: { id: existing.id } }); stats.roundsCleared++; touched = true; }
        } else if (existing) {
          if (Number(existing.avgPrice) !== r.avgPrice) { if (!dryRun) await db.cropSeasonRound.update({ where: { id: existing.id }, data: { avgPrice: r.avgPrice } }); stats.roundsSet++; touched = true; }
        } else {
          if (!dryRun) await db.cropSeasonRound.create({ data: { recordId: rec.id, roundNo: r.roundNo, avgPrice: r.avgPrice } });
          stats.roundsSet++; touched = true;
        }
      }
      if (touched || facChanged || !rec.id) stats.societies++;
      // The factory paying a society here also becomes one of its linked factories,
      // so the payout dashboard and the society page show it without a second entry.
      if (row.factoryId) {
        const link = await db.cooperativeFactory.findFirst({ where: { cooperativeId: c.id, factoryId: row.factoryId } });
        if (!link) { if (!dryRun) await db.cooperativeFactory.create({ data: { cooperativeId: c.id, factoryId: row.factoryId } }); stats.linksAdded++; }
      }
    }
  };
  if (dryRun) await body(prisma); else await prisma.$transaction(body);

  if (!dryRun) {
    await recordAudit({
      userId: user.id,
      action: data.viaFile ? "SEASON_RATES_IMPORTED" : "SEASON_RATES_SAVED",
      entityType: "CropSeasonRecord",
      entityId: data.cropYear,
      metadata: { valueChain: data.valueChain, cropYear: data.cropYear, ...stats },
    });
  }
  return { stats };
}

// PUT /api/season-rates/bulk  (National Admin, Director of the same county)
async function saveBulk(req, res) {
  const data = bulkSchema.parse(req.body);
  const out = await runBulk(req.user, data);
  if (out.problems) return res.status(422).json({ error: "Nothing was saved. " + out.problems.slice(0, 5).join("; "), problems: out.problems });
  res.json(out.stats);
}

// DELETE /api/season-rates/:cooperativeId?cropYear=2025/2026
async function remove(req, res) {
  const cropYear = String(req.query.cropYear || "");
  if (!validCropYear(cropYear)) throw httpError(400, "Crop year looks like 2025/2026");
  const coop = await prisma.cooperative.findUnique({ where: { id: req.params.cooperativeId } });
  if (!coop) throw httpError(404, "Society not found");
  if (req.user.role !== "NATIONAL_ADMIN" && coop.countyId !== req.user.countyId) throw httpError(403, "This society is outside your county");
  const rec = await prisma.cropSeasonRecord.findUnique({ where: { cooperativeId_cropYear: { cooperativeId: coop.id, cropYear } } });
  if (!rec) throw httpError(404, "Nothing recorded for that crop year");
  await prisma.cropSeasonRound.deleteMany({ where: { recordId: rec.id } });
  await prisma.cropSeasonRecord.delete({ where: { id: rec.id } });
  await recordAudit({ userId: req.user.id, action: "SEASON_RATES_CLEARED", entityType: "CropSeasonRecord", entityId: rec.id, metadata: { cropYear } });
  res.json({ ok: true });
}

module.exports = { list, saveBulk, remove, runBulk, unitFor, validCropYear, currentCropYear };

const prisma = require("../config/db");
const { areaScope } = require("../utils/geography");
const { summariseProduce, valueOf } = require("../utils/produceSummary");

// GET /api/reports/disbursements?from=&to=&countyId=
// County-scoped rollup of money disbursed OUT to farmers, grouped by
// cooperative. This is the top level of the trickle-down view:
// National (all counties, National Admin only) -> County -> Cooperative.
// Drilling further into individual farmer amounts happens per-cooperative
// via GET /cooperatives/:id/payouts/member-summary.
async function disbursementSummary(req, res) {
  const { from, to } = req.query;

  // Same county-scoping principle as the rest of the app: non-National-Admin
  // roles are always forced to their own county, regardless of query params.
  // A Sub-County Officer is further limited to their own sub-county, and a
  // Director may narrow to one sub-county or ward (?subCountyId= / ?wardId=).
  const scope = areaScope(req.user);
  const countyId = scope.countyId || req.query.countyId;
  const subCountyId = scope.subCountyId || req.query.subCountyId;
  const { wardId } = req.query;

  const dateFilter =
    from || to
      ? {
          payoutDate: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {};

  const payouts = await prisma.payout.findMany({
    where: {
      ...dateFilter,
      cooperative: {
        ...(countyId ? { countyId } : {}),
        ...(subCountyId ? { subCountyId } : {}),
        ...(wardId ? { wardId } : {}),
      },
    },
    select: {
      id: true,
      amount: true,
      cooperativeId: true,
      cooperative: { select: { id: true, name: true, county: { select: { id: true, name: true } } } },
    },
  });

  const byCooperative = new Map();
  for (const p of payouts) {
    const key = p.cooperativeId;
    if (!byCooperative.has(key)) {
      byCooperative.set(key, {
        cooperativeId: key,
        cooperativeName: p.cooperative.name,
        countyName: p.cooperative.county?.name,
        total: 0,
        payoutCount: 0,
      });
    }
    const entry = byCooperative.get(key);
    entry.total += Number(p.amount);
    entry.payoutCount += 1;
  }

  const byCooperativeArr = [...byCooperative.values()].sort((a, b) => b.total - a.total);
  const totalDisbursed = byCooperativeArr.reduce((sum, c) => sum + c.total, 0);

  // Why is the total what it is? The produce these payouts settled (quantity x
  // average price), and the factories that pay each society. Deliveries are
  // linked to a payout when it is recorded, so only linked deliveries explain a
  // payout; money paid with no produce attached (dividends, bonuses, older
  // entries) is reported separately rather than guessed at.
  const payoutById = new Map(payouts.map((p) => [p.id, p]));
  const coopIds = byCooperativeArr.map((c) => c.cooperativeId);
  const deliveries = coopIds.length
    ? await prisma.produceDelivery.findMany({
        where: { cooperativeId: { in: coopIds }, payoutId: { not: null } },
        select: { cooperativeId: true, payoutId: true, produceType: true, unit: true, quantity: true, ratePerUnit: true, totalValue: true },
      })
    : [];
  const links = coopIds.length ? await prisma.cooperativeFactory.findMany({ where: { cooperativeId: { in: coopIds } }, include: { factory: { select: { id: true, name: true } } } }) : [];
  const factoriesBy = new Map();
  for (const l of links) { if (!factoriesBy.has(l.cooperativeId)) factoriesBy.set(l.cooperativeId, []); factoriesBy.get(l.cooperativeId).push({ id: l.factory.id, name: l.factory.name }); }
  // Season rates directory: the latest crop year recorded for each society.
  const seasonRecs = coopIds.length ? await prisma.cropSeasonRecord.findMany({ where: { cooperativeId: { in: coopIds } } }) : [];
  const latestRec = new Map();
  for (const r of seasonRecs) { const cur = latestRec.get(r.cooperativeId); if (!cur || r.cropYear > cur.cropYear) latestRec.set(r.cooperativeId, r); }
  const recIds = [...latestRec.values()].map((r) => r.id);
  const seasonRounds = recIds.length ? await prisma.cropSeasonRound.findMany({ where: { recordId: { in: recIds } } }) : [];
  const seasonFacIds = [...new Set([...latestRec.values()].map((r) => r.factoryId).filter(Boolean))];
  const seasonFacs = seasonFacIds.length ? await prisma.factory.findMany({ where: { id: { in: seasonFacIds } } }) : [];
  const seasonFacName = new Map(seasonFacs.map((f) => [f.id, f.name]));
  const delBy = new Map();
  for (const d of deliveries) { if (!payoutById.has(d.payoutId)) continue; if (!delBy.has(d.cooperativeId)) delBy.set(d.cooperativeId, []); delBy.get(d.cooperativeId).push(d); }

  for (const c of byCooperativeArr) {
    const ds = delBy.get(c.cooperativeId) || [];
    const linkedPayoutIds = new Set(ds.map((d) => d.payoutId));
    const paidForProduce = [...linkedPayoutIds].reduce((n, id) => n + Number(payoutById.get(id).amount), 0);
    const fl = [...(factoriesBy.get(c.cooperativeId) || [])];
    const sr = latestRec.get(c.cooperativeId);
    if (sr && sr.factoryId && seasonFacName.has(sr.factoryId) && !fl.some((f) => f.id === sr.factoryId)) fl.push({ id: sr.factoryId, name: seasonFacName.get(sr.factoryId) });
    c.factories = fl.sort((a, b) => a.name.localeCompare(b.name));
    c.seasonRate = sr
      ? {
          cropYear: sr.cropYear,
          unit: sr.unit,
          factoryName: sr.factoryId ? seasonFacName.get(sr.factoryId) || null : null,
          rounds: seasonRounds.filter((x) => x.recordId === sr.id).map((x) => ({ roundNo: x.roundNo, avgPrice: Number(x.avgPrice) })).sort((a, b) => a.roundNo - b.roundNo),
        }
      : null;
    c.produce = summariseProduce(ds);
    c.produceValue = Math.round(ds.reduce((n, d) => n + (valueOf(d) || 0), 0) * 100) / 100;
    c.unpricedDeliveries = ds.filter((d) => valueOf(d) === null).length;
    c.paidForProduce = paidForProduce;
    c.paidWithoutProduce = Math.round((c.total - paidForProduce) * 100) / 100;
  }

  res.json({
    totalDisbursed,
    cooperativeCount: byCooperativeArr.length,
    periodFrom: from || null,
    periodTo: to || null,
    byCooperative: byCooperativeArr,
  });
}

module.exports = { disbursementSummary };

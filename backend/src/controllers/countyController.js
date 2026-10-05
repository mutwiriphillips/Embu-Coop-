const prisma = require("../config/db");
const { COUNTIES } = require("../data/kenyaCounties");
const { ensureCountyGeography, areaScope, httpError } = require("../utils/geography");

// Self-healing: every public county dropdown (staff signup, farmer
// registration, agrovet application) depends on this table holding all 47
// counties. If a deployment ever skipped seed-counties.js, or a database was
// reset without reseeding, those dropdowns would silently render empty — so
// if fewer than 47 rows exist, restore the missing ones here, idempotently
// (upsert by official code: existing rows are only name/region-corrected,
// never duplicated or deleted). Normally a no-op count query.
async function ensureAllCounties() {
  const count = await prisma.county.count();
  if (count >= COUNTIES.length) return;
  for (const [code, name, region] of COUNTIES) {
    await prisma.county.upsert({
      where: { code },
      update: { name, region },
      create: { code, name, region },
    });
  }
}

// Public: powers the landing page, signup form, and the dashboard county
// selector. No sensitive data — just the 47 official counties.
async function listCounties(req, res) {
  await ensureAllCounties();
  const counties = await prisma.county.findMany({
    orderBy: { name: "asc" },
  });
  res.json(counties);
}

// National rollup: cooperative counts per county, for NATIONAL_ADMIN and for
// the "coverage so far" panel on the dashboard. Cheap aggregate query.
async function countySummary(req, res) {
  const counties = await prisma.county.findMany({
    include: { _count: { select: { cooperatives: true, staff: true } } },
    orderBy: { name: "asc" },
  });

  res.json(
    counties.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      region: c.region,
      cooperativeCount: c._count.cooperatives,
      staffCount: c._count.staff,
    }))
  );
}


// GET /api/counties/:countyId/sub-counties  (public: official names only)
async function listSubCounties(req, res) {
  await ensureCountyGeography(req.params.countyId);
  const subs = await prisma.subCounty.findMany({
    where: { countyId: req.params.countyId },
    include: { _count: { select: { wards: true } } },
    orderBy: { name: "asc" },
  });
  res.json(subs.map((s) => ({ id: s.id, code: s.code, name: s.name, wardCount: s._count.wards })));
}

// GET /api/counties/sub-counties/:subCountyId/wards  (public: official names only)
async function listWards(req, res) {
  const sub = await prisma.subCounty.findUnique({ where: { id: req.params.subCountyId } });
  if (!sub) return res.status(404).json({ error: "Sub-county not found" });
  const wards = await prisma.ward.findMany({ where: { subCountyId: sub.id }, orderBy: { name: "asc" } });
  res.json(wards.map((w) => ({ id: w.id, code: w.code, name: w.name })));
}

/**
 * GET /api/counties/:countyId/breakdown[?subCountyId=]
 * The Director's drill-down. Without subCountyId: one row per sub-county in
 * the county. With subCountyId: one row per ward in that sub-county. Each row
 * counts cooperatives, members, staff, and agrovet shops (approved / awaiting
 * sign-off). Records that predate the dropdowns and aren't linked to a
 * sub-county or ward yet are counted separately as "unassigned" rather than
 * silently dropped, so the totals always add up.
 *
 * Scoping: a Director can only open their own county; a Sub-County Officer
 * only their own sub-county; the National Admin any county.
 */
async function countyBreakdown(req, res) {
  const { countyId } = req.params;
  let { subCountyId } = req.query;
  const user = req.user;

  if (user.role !== "NATIONAL_ADMIN" && user.countyId !== countyId) {
    throw httpError(403, "You can only view your own county");
  }
  const scope = areaScope(user);
  if (scope.subCountyId) {
    if (subCountyId && subCountyId !== scope.subCountyId) throw httpError(403, "You can only view your own sub-county");
    subCountyId = scope.subCountyId;
  }

  await ensureCountyGeography(countyId);
  const level = subCountyId ? "ward" : "subCounty";
  const key = level === "ward" ? "wardId" : "subCountyId";
  const areaWhere = { countyId, ...(subCountyId ? { subCountyId } : {}) };

  const [areas, coops, staff, shops] = await Promise.all([
    level === "ward"
      ? prisma.ward.findMany({ where: { subCountyId }, orderBy: { name: "asc" } })
      : prisma.subCounty.findMany({ where: { countyId }, orderBy: { name: "asc" } }),
    prisma.cooperative.findMany({ where: areaWhere, include: { _count: { select: { members: true } } } }),
    prisma.user.findMany({ where: { ...areaWhere, active: true } }),
    prisma.agrovetShop.findMany({ where: areaWhere }),
  ]);

  const tally = (rows, id) => rows.filter((r) => (r[key] || null) === id);
  const row = (id, name, code) => {
    const c = tally(coops, id), s = tally(shops, id);
    return {
      id, name, code,
      cooperatives: c.length,
      members: c.reduce((n, x) => n + (x._count?.members || 0), 0),
      staff: tally(staff, id).length,
      agrovetsApproved: s.filter((x) => x.status === "APPROVED").length,
      agrovetsAwaiting: s.filter((x) => x.status === "PENDING" || x.status === "REVIEWED").length,
    };
  };

  const rows = areas.map((a) => row(a.id, a.name, a.code));
  const unassigned = row(null, level === "ward" ? "No ward recorded yet" : "No sub-county recorded yet", null);
  const totals = ["cooperatives", "members", "staff", "agrovetsApproved", "agrovetsAwaiting"].reduce(
    (t, k) => ({ ...t, [k]: rows.reduce((n, r) => n + r[k], 0) + unassigned[k] }), {}
  );

  res.json({ level, countyId, subCountyId: subCountyId || null, rows, unassigned, totals });
}

module.exports = { listCounties, countySummary, ensureAllCounties, listSubCounties, listWards, countyBreakdown };

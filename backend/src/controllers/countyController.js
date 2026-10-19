const prisma = require("../config/db");
const { COUNTIES } = require("../data/kenyaCounties");
const { ensureCountyGeography, areaScope, httpError } = require("../utils/geography");

// Self-healing: every public county dropdown (staff signup, farmer
// registration, agrovet application) depends on this table holding all 47
// counties. If a deployment ever skipped seed-counties.js, or a database was
// reset without reseeding, those dropdowns would silently render empty — so
// if fewer than 47 rows exist, restore the missing ones here, idempotently
// (inserted by official code, existing rows are never touched or deleted).
// Checked once per server start, then remembered.
let countiesVerified = false;
async function ensureAllCounties() {
  if (countiesVerified) return;
  const existing = await prisma.county.findMany({ select: { code: true, name: true, region: true } });
  if (existing.length < COUNTIES.length) {
    // One batched insert for whatever is missing (not 47 round trips). Rows
    // that already exist are skipped, so concurrent callers can't clash.
    const have = new Set(existing.map((c) => c.code));
    const missing = COUNTIES.filter(([code]) => !have.has(code)).map(([code, name, region]) => ({ code, name, region }));
    if (missing.length) await prisma.county.createMany({ data: missing, skipDuplicates: true });
  }
  countiesVerified = true;
}

// The official county list never changes while the server runs, and a sleepy
// free-tier database makes every query slow, so the answer is kept in memory
// for 10 minutes. Callers that arrive while it is being loaded share the one
// query instead of each starting their own.
const LIST_TTL_MS = 10 * 60 * 1000;
let cached = null; // { at, rows }
let loading = null;

async function loadCounties() {
  const started = Date.now();
  await ensureAllCounties();
  const rows = await prisma.county.findMany({ orderBy: { name: "asc" } });
  const took = Date.now() - started;
  if (took > 2000) console.warn(`[counties] slow county load: ${took} ms (database or cold start)`);
  if (rows.length) cached = { at: Date.now(), rows };
  return rows;
}

// Public: powers the landing page, signup form, and the dashboard county
// selector. No sensitive data — just the 47 official counties.
async function listCounties(req, res) {
  let rows;
  if (cached && Date.now() - cached.at < LIST_TTL_MS) {
    rows = cached.rows;
  } else {
    loading = loading || loadCounties().finally(() => { loading = null; });
    rows = await loading;
  }
  res.set("Cache-Control", "public, max-age=300");
  res.json(rows);
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

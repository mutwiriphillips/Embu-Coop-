const prisma = require("../config/db");
const { COUNTIES } = require("../data/kenyaCounties");

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

module.exports = { listCounties, countySummary, ensureAllCounties };

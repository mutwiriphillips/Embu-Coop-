/**
 * Keeps the database's sub-counties and wards in line with
 * src/data/kenyaGeography.js, and keeps every record's sub-county consistent
 * with its ward. Shared by the server (runs once at start-up) and by
 * `npm run geo:sync`.
 *
 * What it does, and only this:
 *   - creates any sub-county or ward that is missing (by official code);
 *   - if a ward now belongs to a different sub-county in the reference data
 *     (e.g. Mwea and Makima wards moving from Mbeere South to the gazetted
 *     Mwea Sub-County), points the ward at its new sub-county;
 *   - any cooperative, staff member or agrovet shop whose ward sits in a
 *     different sub-county than the one recorded on it is moved to the ward's
 *     sub-county (link and text name), so filters, counts and Sub-County
 *     Officer access all agree.
 * It never deletes anything, never renames anything, never touches a record
 * without a ward, and does nothing at all when everything already matches
 * (two read queries). Safe to run any number of times.
 */
const { SUB_COUNTIES, WARDS, ADMIN_SUB_COUNTIES } = require("../data/kenyaGeography");

// Rows are created in a few batches (createMany + skipDuplicates) instead of
// one round trip per row. On a small hosted database a round trip costs tens
// of milliseconds, so ~1,500 one-at-a-time inserts could take minutes and
// starve the requests (like the county dropdown) waiting behind them.
const CHUNK = 500;
async function createInChunks(delegate, rows) {
  let n = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await delegate.createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true });
    n += res && typeof res.count === "number" ? res.count : 0;
  }
  return n;
}

async function syncReference(prisma) {
  const result = { subsAdded: 0, wardsAdded: 0, wardsMoved: [] };
  const counties = await prisma.county.findMany();
  const countyIdByCode = new Map(counties.map((c) => [Number(c.code), c.id]));

  let subs = await prisma.subCounty.findMany();
  let subByCode = new Map(subs.map((s) => [s.code, s]));
  const missingSubs = SUB_COUNTIES
    .filter(([code, countyCode]) => !subByCode.has(code) && countyIdByCode.has(countyCode)) // county not loaded yet: next run
    .map(([code, countyCode, name]) => ({ code, name, countyId: countyIdByCode.get(countyCode) }));
  if (missingSubs.length) {
    result.subsAdded = await createInChunks(prisma.subCounty, missingSubs);
    subs = await prisma.subCounty.findMany();
    subByCode = new Map(subs.map((s) => [s.code, s]));
  }
  const subByIdName = new Map([...subByCode.values()].map((s) => [s.id, s.name]));

  const wards = await prisma.ward.findMany();
  const wardByCode = new Map(wards.map((w) => [w.code, w]));
  const missingWards = [];
  for (const [code, subCode, name] of WARDS) {
    const sub = subByCode.get(subCode);
    if (!sub) continue;
    const existing = wardByCode.get(code);
    if (!existing) {
      missingWards.push({ code, name, subCountyId: sub.id });
    } else if (existing.subCountyId !== sub.id) {
      await prisma.ward.update({ where: { id: existing.id }, data: { subCountyId: sub.id } });
      result.wardsMoved.push({ ward: existing.name, from: subByIdName.get(existing.subCountyId) || "?", to: sub.name });
    }
  }
  if (missingWards.length) result.wardsAdded = await createInChunks(prisma.ward, missingWards);
  return result;
}

const MODELS = [
  { key: "cooperative", label: "Cooperative", describe: (r) => (r.registrationNumber ? `${r.name} (${r.registrationNumber})` : r.name), select: { name: true, registrationNumber: true } },
  { key: "user", label: "Staff", describe: (r) => `${r.fullName} <${r.email}>`, select: { fullName: true, email: true } },
  { key: "agrovetShop", label: "Agrovet shop", describe: (r) => r.name, select: { name: true } },
];

async function realignRecords(prisma) {
  const wards = await prisma.ward.findMany({ select: { id: true, subCountyId: true, name: true } });
  const wardById = new Map(wards.map((w) => [w.id, w]));
  const subs = await prisma.subCounty.findMany({ select: { id: true, name: true } });
  const subNameById = new Map(subs.map((s) => [s.id, s.name]));
  const moved = [];
  for (const m of MODELS) {
    const rows = await prisma[m.key].findMany({
      where: { wardId: { not: null } },
      select: { id: true, wardId: true, subCountyId: true, subCounty: true, ...m.select },
    });
    for (const r of rows) {
      const w = wardById.get(r.wardId);
      if (!w || w.subCountyId === r.subCountyId) continue;
      const to = subNameById.get(w.subCountyId);
      await prisma[m.key].update({ where: { id: r.id }, data: { subCountyId: w.subCountyId, subCounty: to } });
      moved.push({ type: m.label, record: m.describe(r), ward: w.name, from: r.subCounty || "—", to });
    }
  }
  return moved;
}

// Sub-County Officers covering a sub-county that gave wards to a newer one.
// They keep their assignment (nothing is changed for them); this only lists
// them so the Director can decide whether one should now cover the new
// sub-county instead.
async function officersToReview(prisma) {
  const sourceCodes = [...new Set(ADMIN_SUB_COUNTIES.map((a) => a.formedFrom))];
  if (!sourceCodes.length) return [];
  const sources = await prisma.subCounty.findMany({ where: { code: { in: sourceCodes } }, select: { id: true, code: true, name: true } });
  if (!sources.length) return [];
  const officers = await prisma.user.findMany({
    where: { role: "SUBCOUNTY_OFFICER", subCountyId: { in: sources.map((s) => s.id) } },
    select: { fullName: true, email: true, subCountyId: true },
  });
  return officers.map((o) => {
    const src = sources.find((s) => s.id === o.subCountyId);
    const newer = ADMIN_SUB_COUNTIES.filter((a) => a.formedFrom === src.code).map((a) => a.name).join(", ");
    return { officer: `${o.fullName} <${o.email}>`, covers: src.name, newer };
  });
}

async function reconcileGeography(prisma, log = console.log) {
  const ref = await syncReference(prisma);
  const moved = await realignRecords(prisma);
  if (ref.subsAdded || ref.wardsAdded) log(`[geography] added ${ref.subsAdded} sub-counties and ${ref.wardsAdded} wards`);
  ref.wardsMoved.forEach((w) => log(`[geography] ward ${w.ward}: ${w.from} -> ${w.to}`));
  moved.forEach((m) => log(`[geography] ${m.type} ${m.record} (ward ${m.ward}): sub-county ${m.from} -> ${m.to}`));
  if (ref.wardsMoved.length) {
    (await officersToReview(prisma)).forEach((o) =>
      log(`[geography] review: Sub-County Officer ${o.officer} covers ${o.covers}; ${o.newer} is now its own sub-county`)
    );
  }
  return { ...ref, recordsMoved: moved };
}

module.exports = { syncReference, realignRecords, officersToReview, reconcileGeography };

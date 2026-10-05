/**
 * Live-safe geography sync. Run on the live database with:
 *
 *   npm run geo:sync
 *
 *  1. Loads all 47 counties' sub-counties (290) and wards (1,450) from
 *     src/data/kenyaGeography.js. Upsert by official IEBC code: nothing is
 *     deleted, nothing duplicated, existing rows untouched.
 *  2. Links existing cooperatives, staff, and agrovet shops to the new
 *     sub-county / ward records by matching the text already stored on them
 *     (case-, spacing- and punctuation-insensitive, including known alternative
 *     spellings). Only fills in links that are empty; never overwrites a link
 *     someone already chose, and never changes the stored text.
 *  3. Lists every record it couldn't match, so a Director can pick the right
 *     sub-county / ward for it from the dropdowns.
 *
 * Safe to run repeatedly.
 */
const { PrismaClient } = require("@prisma/client");
const { COUNTIES } = require("../src/data/kenyaCounties");
const { SUB_COUNTIES, WARDS } = require("../src/data/kenyaGeography");

const prisma = new PrismaClient();
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function loadReferenceData() {
  let subs = 0, wards = 0;
  for (const [code, name, region] of COUNTIES) {
    await prisma.county.upsert({ where: { code }, update: {}, create: { code, name, region } });
  }
  const counties = await prisma.county.findMany();
  const countyIdByCode = new Map(counties.map((c) => [Number(c.code), c.id]));
  for (const [code, countyCode, name] of SUB_COUNTIES) {
    const exists = await prisma.subCounty.findUnique({ where: { code } });
    if (!exists) { await prisma.subCounty.create({ data: { code, name, countyId: countyIdByCode.get(countyCode) } }); subs++; }
  }
  const subIdByCode = new Map((await prisma.subCounty.findMany()).map((s) => [s.code, s.id]));
  for (const [code, subCode, name] of WARDS) {
    const exists = await prisma.ward.findUnique({ where: { code } });
    if (!exists) { await prisma.ward.create({ data: { code, name, subCountyId: subIdByCode.get(subCode) } }); wards++; }
  }
  console.log(`Reference data: added ${subs} sub-counties and ${wards} wards (already present ones left as they were).`);
  return { counties, subIdByCode };
}

function matcher(counties, subIdByCode) {
  const countyCodeById = new Map(counties.map((c) => [c.id, Number(c.code)]));
  return (countyId, subText, wardText) => {
    const cc = countyCodeById.get(countyId);
    const sub = SUB_COUNTIES.find(([, c, name]) => c === cc && norm(name) === norm(subText));
    if (!sub) return {};
    const ward = wardText
      ? WARDS.find(([, sc, name, aliases]) => sc === sub[0] && (norm(name) === norm(wardText) || (aliases || []).some((a) => norm(a) === norm(wardText))))
      : null;
    return { subCountyCode: sub[0], wardCode: ward ? ward[0] : null };
  };
}

async function linkModel(label, model, rows, match, wardIdByCode, subIdByCode) {
  let linked = 0;
  const unmatched = [];
  for (const r of rows) {
    if (!r.countyId) continue;
    const m = match(r.countyId, r.subCounty, r.ward);
    const data = {};
    if (!r.subCountyId && m.subCountyCode) data.subCountyId = subIdByCode.get(m.subCountyCode);
    if (!r.wardId && m.wardCode) data.wardId = wardIdByCode.get(m.wardCode);
    if (Object.keys(data).length) { await model.update({ where: { id: r.id }, data }); linked++; }
    const finalSub = r.subCountyId || data.subCountyId;
    const finalWard = r.wardId || data.wardId;
    if (!finalSub || (r.ward && !finalWard)) unmatched.push(r);
  }
  console.log(`\n${label}: linked ${linked} record(s).`);
  if (unmatched.length) {
    console.log(`  Needs a Director to choose from the dropdowns (${unmatched.length}):`);
    unmatched.forEach((r) => console.log(`   - ${r.label}  [recorded as: sub-county "${r.subCounty || "—"}", ward "${r.ward || "—"}"]`));
  } else {
    console.log("  Every record is linked.");
  }
}

async function main() {
  const { counties, subIdByCode } = await loadReferenceData();
  const wardIdByCode = new Map((await prisma.ward.findMany()).map((w) => [w.code, w.id]));
  const match = matcher(counties, subIdByCode);

  const coops = (await prisma.cooperative.findMany()).map((c) => ({ ...c, label: `${c.name} (${c.registrationNumber})` }));
  await linkModel("Cooperatives", prisma.cooperative, coops, match, wardIdByCode, subIdByCode);

  const staff = (await prisma.user.findMany({ where: { subCounty: { not: null } } })).map((u) => ({ ...u, label: `${u.fullName} <${u.email}> ${u.role}` }));
  await linkModel("Staff", prisma.user, staff, match, wardIdByCode, subIdByCode);

  const shops = (await prisma.agrovetShop.findMany({ where: { subCounty: { not: null } } })).map((s) => ({ ...s, label: s.name }));
  await linkModel("Agrovet shops", prisma.agrovetShop, shops, match, wardIdByCode, subIdByCode);

  const officers = await prisma.user.findMany({ where: { role: "SUBCOUNTY_OFFICER", subCountyId: null } });
  if (officers.length) {
    console.log("\nSub-County Officers with no sub-county yet (they see their whole county until a Director assigns one on Staff & Access):");
    officers.forEach((o) => console.log(`   - ${o.fullName} <${o.email}>`));
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });

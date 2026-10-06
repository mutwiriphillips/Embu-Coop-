/**
 * Live-safe geography sync. Run on the live database with:
 *
 *   npm run geo:sync
 *
 *  1. Loads all 47 counties' sub-counties (290 constituencies plus gazetted
 *     administrative sub-counties such as Mwea, Embu) and wards (1,450) from
 *     src/data/kenyaGeography.js, by official code: nothing is deleted,
 *     nothing duplicated or renamed. A ward that now belongs to a newer
 *     sub-county is pointed at it.
 *  2. Links existing cooperatives, staff, and agrovet shops to the new
 *     sub-county / ward records by matching the text already stored on them
 *     (case-, spacing- and punctuation-insensitive, including known alternative
 *     spellings). Only fills in links that are empty; never overwrites a link
 *     someone already chose, and never changes the stored text.
 *  3. Moves any record whose ward now sits in a different sub-county to that
 *     sub-county (the server also does this by itself at start-up).
 *  4. Lists every record it couldn't match, so a Director can pick the right
 *     sub-county / ward for it from the dropdowns, and any Sub-County Officer
 *     whose sub-county gave wards to a new one.
 *
 * Safe to run repeatedly.
 */
const { PrismaClient } = require("@prisma/client");
const { COUNTIES } = require("../src/data/kenyaCounties");
const { syncReference, realignRecords, officersToReview } = require("../src/utils/geographySync");

const prisma = new PrismaClient();
const { matchTextLocation, norm } = require("../src/utils/geography");
const { SUB_COUNTIES } = require("../src/data/kenyaGeography");
const SUB_NAME_BY_CODE = new Map(SUB_COUNTIES.map(([code, , name]) => [code, name]));

async function loadReferenceData() {
  for (const [code, name, region] of COUNTIES) {
    await prisma.county.upsert({ where: { code }, update: {}, create: { code, name, region } });
  }
  const ref = await syncReference(prisma);
  console.log(`Reference data: added ${ref.subsAdded} sub-counties and ${ref.wardsAdded} wards (already present ones left as they were).`);
  ref.wardsMoved.forEach((w) => console.log(`  Ward ${w.ward} now belongs to ${w.to} (was ${w.from}).`));
  const counties = await prisma.county.findMany();
  const subIdByCode = new Map((await prisma.subCounty.findMany()).map((s) => [s.code, s.id]));
  return { counties, subIdByCode };
}

function matcher(counties) {
  const countyCodeById = new Map(counties.map((c) => [c.id, Number(c.code)]));
  return (countyId, subText, wardText) => matchTextLocation(countyCodeById.get(countyId), subText, wardText);
}

async function linkModel(label, model, rows, match, wardIdByCode, subIdByCode) {
  let linked = 0;
  const unmatched = [];
  for (const r of rows) {
    if (!r.countyId) continue;
    const m = match(r.countyId, r.subCounty, r.ward);
    const data = {};
    if (!r.subCountyId && m.subCountyCode) {
      data.subCountyId = subIdByCode.get(m.subCountyCode);
      // The ward has moved to a newer sub-county (e.g. "Mbeere South / Makima"
      // is now Mwea): record the sub-county it is actually in.
      const current = SUB_NAME_BY_CODE.get(m.subCountyCode);
      if (current && norm(current) !== norm(r.subCounty)) data.subCounty = current;
    }
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
  const match = matcher(counties);

  const coops = (await prisma.cooperative.findMany()).map((c) => ({ ...c, label: `${c.name} (${c.registrationNumber})` }));
  await linkModel("Cooperatives", prisma.cooperative, coops, match, wardIdByCode, subIdByCode);

  const staff = (await prisma.user.findMany({ where: { subCounty: { not: null } } })).map((u) => ({ ...u, label: `${u.fullName} <${u.email}> ${u.role}` }));
  await linkModel("Staff", prisma.user, staff, match, wardIdByCode, subIdByCode);

  const shops = (await prisma.agrovetShop.findMany({ where: { subCounty: { not: null } } })).map((s) => ({ ...s, label: s.name }));
  await linkModel("Agrovet shops", prisma.agrovetShop, shops, match, wardIdByCode, subIdByCode);

  const moved = await realignRecords(prisma);
  console.log(`\nRecords moved to their ward's current sub-county: ${moved.length}`);
  moved.forEach((m) => console.log(`   - ${m.type}: ${m.record} (ward ${m.ward}): ${m.from} -> ${m.to}`));

  const review = await officersToReview(prisma);
  if (review.length) {
    console.log("\nSub-County Officers to review (left as they are; a Director decides on Staff & Access):");
    review.forEach((o) => console.log(`   - ${o.officer} covers ${o.covers}; ${o.newer} is now its own sub-county`));
  }

  const officers = await prisma.user.findMany({ where: { role: "SUBCOUNTY_OFFICER", subCountyId: null } });
  if (officers.length) {
    console.log("\nSub-County Officers with no sub-county yet (they see their whole county until a Director assigns one on Staff & Access):");
    officers.forEach((o) => console.log(`   - ${o.fullName} <${o.email}>`));
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });

/**
 * Seeds the 47 official counties of Kenya, per the Constitution's First
 * Schedule / IEBC county codes. This is factual public reference data, not
 * sample/demo content — run this in every environment before any county-
 * scoped record (staff, cooperative) can be created.
 *
 * Run with: node prisma/seed-counties.js
 * (Also invoked automatically by seed-pilot.js.)
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const { COUNTIES } = require("../src/data/kenyaCounties");

async function main() {
  for (const [code, name, region] of COUNTIES) {
    await prisma.county.upsert({
      where: { code },
      update: { name, region },
      create: { code, name, region },
    });
  }
  console.log(`Seeded ${COUNTIES.length} counties.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

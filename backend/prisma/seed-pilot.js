/**
 * Pilot / test-run seed — exactly what's needed to demo the system with:
 *   - 1 National Admin account (cross-county oversight)
 *   - 1 County Director (Embu — the original pilot county)
 *   - 1 County employee (Field Officer, Embu)
 *   - 1 Cooperative Manager (Embu)
 *   - 1 Cooperative, in Embu County, with the manager attached
 *
 * Requires the 47 counties to already exist — run seed-counties.js first
 * (this script also runs it for you via ensureCounties()).
 *
 * Run with: node prisma/seed-pilot.js
 */
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const { execSync } = require("child_process");

const prisma = new PrismaClient();
const PILOT_PASSWORD = "Pilot2026!";

async function ensureCounties() {
  const count = await prisma.county.count();
  if (count === 0) {
    console.log("No counties found — seeding all 47 first...");
    execSync("node prisma/seed-counties.js", { stdio: "inherit" });
  }
}

async function main() {
  await ensureCounties();

  const embu = await prisma.county.findUniqueOrThrow({ where: { code: "014" } });
  const passwordHash = await bcrypt.hash(PILOT_PASSWORD, 10);

  const nationalAdmin = await prisma.user.upsert({
    where: { email: "admin@cooperatives.go.ke" },
    update: {},
    create: {
      fullName: "National Cooperatives Admin",
      email: "admin@cooperatives.go.ke",
      passwordHash,
      role: "NATIONAL_ADMIN",
      designation: "State Department for Co-operatives",
    },
  });

  const director = await prisma.user.upsert({
    where: { email: "director@embu.go.ke" },
    update: {},
    create: {
      fullName: "Embu County Director",
      email: "director@embu.go.ke",
      passwordHash,
      role: "DIRECTOR",
      countyId: embu.id,
      designation: "Director, Co-operative Development",
      reportsToId: nationalAdmin.id,
    },
  });

  await prisma.user.upsert({
    where: { email: "employee@embu.go.ke" },
    update: {},
    create: {
      fullName: "Test Field Officer",
      email: "employee@embu.go.ke",
      passwordHash,
      role: "FIELD_OFFICER",
      countyId: embu.id,
      designation: "Field Officer",
      subCounty: "Runyenjes",
      ward: "Kagaari South",
      reportsToId: director.id,
      permissions: {
        create: [
          { module: "cooperatives", canView: true, canEdit: false },
          { module: "documents", canView: true, canEdit: true },
          { module: "governance", canView: true, canEdit: false },
        ],
      },
    },
  });

  const cooperative = await prisma.cooperative.upsert({
    where: { registrationNumber: "EMB-PILOT-0001" },
    update: {},
    create: {
      name: "Kirimiri Coffee Growers Cooperative Society",
      registrationNumber: "EMB-PILOT-0001",
      valueChain: "COFFEE",
      countyId: embu.id,
      subCounty: "Runyenjes",
      ward: "Kagaari South",
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: "manager@embu.go.ke" },
    update: {},
    create: {
      fullName: "Test Cooperative Manager",
      email: "manager@embu.go.ke",
      passwordHash,
      role: "COOPERATIVE_MANAGER",
      countyId: embu.id,
      designation: "Cooperative Manager",
      subCounty: "Runyenjes",
      ward: "Kagaari South",
      permissions: {
        create: [
          { module: "cooperatives", canView: true, canEdit: true },
          { module: "documents", canView: true, canEdit: true },
          { module: "governance", canView: true, canEdit: true },
        ],
      },
    },
  });

  await prisma.cooperative.update({
    where: { id: cooperative.id },
    data: { managerId: manager.id },
  });

  console.log("Pilot seed complete. All accounts share the password:", PILOT_PASSWORD);
  console.log(`  National Admin: admin@cooperatives.go.ke`);
  console.log(`  County Director (Embu): director@embu.go.ke`);
  console.log(`  Employee (Field Officer): employee@embu.go.ke`);
  console.log(`  Manager: manager@embu.go.ke`);
  console.log(`  Cooperative: ${cooperative.name} (${cooperative.registrationNumber}) — Embu County`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

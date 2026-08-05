/**
 * Pilot / test-run seed — exactly what's needed to demo the system with:
 *   - 1 Director account (admin oversight)
 *   - 1 County employee (Field Officer)
 *   - 1 Cooperative Manager
 *   - 1 Cooperative, with the manager attached
 *
 * Run with: node prisma/seed-pilot.js
 * (Use this INSTEAD of prisma/seed.js for a lean pilot; seed.js seeds a
 *  Sub-County Officer instead of a Manager and no linked Manager account.)
 */
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();
const PILOT_PASSWORD = "Pilot2026!";

async function main() {
  const passwordHash = await bcrypt.hash(PILOT_PASSWORD, 10);

  const director = await prisma.user.upsert({
    where: { email: "director@embu.go.ke" },
    update: {},
    create: {
      fullName: "County Director",
      email: "director@embu.go.ke",
      passwordHash,
      role: "DIRECTOR",
      designation: "Director, Co-operative Development",
    },
  });

  const employee = await prisma.user.upsert({
    where: { email: "employee@embu.go.ke" },
    update: {},
    create: {
      fullName: "Test Field Officer",
      email: "employee@embu.go.ke",
      passwordHash,
      role: "FIELD_OFFICER",
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
  console.log(`  Director: director@embu.go.ke`);
  console.log(`  Employee (Field Officer): employee@embu.go.ke`);
  console.log(`  Manager: manager@embu.go.ke`);
  console.log(`  Cooperative: ${cooperative.name} (${cooperative.registrationNumber})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

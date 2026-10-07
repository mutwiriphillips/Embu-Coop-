const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("ChangeMe123!", 10);

  const embu = await prisma.county.findUnique({ where: { code: "014" } });
  if (!embu) {
    throw new Error("Counties not seeded yet — run `node prisma/seed-counties.js` first.");
  }

  const director = await prisma.user.upsert({
    where: { email: "director@embu.go.ke" },
    update: {},
    create: {
      fullName: "County Director",
      email: "director@embu.go.ke",
      passwordHash,
      role: "DIRECTOR",
      countyId: embu.id,
      designation: "Director, Co-operative Development",
      subCounty: "Manyatta",
      ward: "Kithimu",
    },
  });

  const officer = await prisma.user.upsert({
    where: { email: "officer@embu.go.ke" },
    update: {},
    create: {
      fullName: "Sub-County Officer",
      email: "officer@embu.go.ke",
      passwordHash,
      role: "SUBCOUNTY_OFFICER",
      countyId: embu.id,
      designation: "Cooperative Development Officer",
      subCounty: "Runyenjes",
      ward: "Kagaari South",
      reportsToId: director.id,
      permissions: {
        create: [
          { module: "cooperatives", canView: true, canEdit: true },
          { module: "documents", canView: true, canEdit: true },
          { module: "governance", canView: true, canEdit: true },
        ],
      },
    },
  });

  // seed-pilot.js creates this same cooperative as EMB-PILOT-0001. If it (or
  // any cooperative of that name) already exists, don't add a second copy:
  // that is how the registry came to list "Kirimiri" twice.
  const alreadyThere = await prisma.cooperative.findFirst({
    where: { countyId: embu.id, name: { equals: "Kirimiri Coffee Growers Cooperative Society", mode: "insensitive" } },
  });
  if (alreadyThere) {
    console.log(`  Cooperative already present (${alreadyThere.registrationNumber}); not adding a duplicate.`);
  } else await prisma.cooperative.upsert({
    where: { registrationNumber: "EMB-COFFEE-0001" },
    update: {},
    create: {
      name: "Kirimiri Coffee Growers Cooperative Society",
      registrationNumber: "EMB-COFFEE-0001",
      valueChain: "COFFEE",
      countyId: embu.id,
      subCounty: "Runyenjes",
      ward: "Kagaari South",
    },
  });

  console.log("Seed complete:");
  console.log(`  Director: director@embu.go.ke / ChangeMe123!`);
  console.log(`  Sub-county officer: officer@embu.go.ke / ChangeMe123!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

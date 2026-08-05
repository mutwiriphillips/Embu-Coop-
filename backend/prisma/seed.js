const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("ChangeMe123!", 10);

  const director = await prisma.user.upsert({
    where: { email: "director@embu.go.ke" },
    update: {},
    create: {
      fullName: "County Director",
      email: "director@embu.go.ke",
      passwordHash,
      role: "DIRECTOR",
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

  await prisma.cooperative.upsert({
    where: { registrationNumber: "EMB-COFFEE-0001" },
    update: {},
    create: {
      name: "Kirimiri Coffee Growers Cooperative Society",
      registrationNumber: "EMB-COFFEE-0001",
      valueChain: "COFFEE",
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

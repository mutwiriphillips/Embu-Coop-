/**
 * Pilot / test-run seed — exactly what's needed to demo the system with:
 *   - 1 National Admin account (cross-county oversight)
 *   - 1 County Director (Embu — the original pilot county)
 *   - 1 Sub-County Officer (Embu, Runyenjes)
 *   - 1 County employee (Field Officer, Embu)
 *   - 1 Cooperative Manager (Embu)
 *   - 1 Cooperative, in Embu County, with the manager attached
 *   - 1 Member Portal account (National ID PILOT-0001)
 *   - 1 APPROVED Agrovet shop + account (National ID AGRO-0001), with a
 *     small catalogue, and a KES 10,000 input credit for PILOT-0001
 *
 * Safe to re-run against a live database: every record is looked up first
 * and only created if missing. It never deletes or resets anything.
 *
 * Requires the 47 counties to already exist — run seed-counties.js first
 * (this script also runs it for you via ensureCounties()).
 *
 * Run with: node prisma/seed-pilot.js
 */
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const { execSync } = require("child_process");
const { defaultPermissionsForRole } = require("../src/utils/rolePermissions");

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

  // Sub-County Officer — the first-tier reviewer for documents and agrovet
  // applications. Earlier versions of this seed never created one, so this
  // login simply didn't exist.
  await prisma.user.upsert({
    where: { email: "subcounty@embu.go.ke" },
    update: {},
    create: {
      fullName: "Test Sub-County Officer",
      email: "subcounty@embu.go.ke",
      passwordHash,
      role: "SUBCOUNTY_OFFICER",
      countyId: embu.id,
      designation: "Sub-County Co-operative Officer",
      subCounty: "Runyenjes",
      reportsToId: director.id,
      permissions: { create: defaultPermissionsForRole("SUBCOUNTY_OFFICER") },
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

  // A handful of contributions so the credit scoring engine has real inputs
  // to work with immediately, rather than every pilot cooperative starting
  // from an all-zero assessment.
  const sampleMember = await prisma.member.findFirst({ where: { cooperativeId: cooperative.id } });
  if (!sampleMember) {
    const seededMember = await prisma.member.create({
      data: {
        cooperativeId: cooperative.id,
        legalName: "Test Member",
        nationalId: "PILOT-0001",
        gender: "FEMALE",
        shareCapital: 5000,
      },
    });
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - i);
      await prisma.contribution.create({
        data: {
          memberId: seededMember.id,
          cooperativeId: cooperative.id,
          amount: 500,
          type: "MONTHLY_CONTRIBUTION",
          method: "CASH",
          contributionDate: d,
          recordedById: manager.id,
        },
      });
    }

    // Sample produce deliveries + a payout settling some of them, so the
    // Produce/Payouts tabs and the Director's disbursement report have
    // something real to show on first login, not an empty state.
    const deliveries = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - i);
      const delivery = await prisma.produceDelivery.create({
        data: {
          memberId: seededMember.id,
          cooperativeId: cooperative.id,
          produceType: "Coffee Cherries",
          quantity: 120,
          unit: "KG",
          qualityGrade: "AA",
          ratePerUnit: 80,
          totalValue: 120 * 80,
          deliveryDate: d,
          recordedById: manager.id,
        },
      });
      deliveries.push(delivery);
    }

    // Pay out the oldest two deliveries, leave the most recent one unpaid
    // so the "outstanding balance" UI has something to display too.
    const settled = deliveries.slice(1);
    const payout = await prisma.payout.create({
      data: {
        memberId: seededMember.id,
        cooperativeId: cooperative.id,
        amount: settled.reduce((sum, d) => sum + Number(d.totalValue), 0),
        type: "PRODUCE_PAYMENT",
        method: "MPESA",
        periodLabel: "Pilot seed payout",
        payoutDate: now,
        recordedById: manager.id,
      },
    });
    await prisma.produceDelivery.updateMany({
      where: { id: { in: settled.map((d) => d.id) } },
      data: { paid: true, payoutId: payout.id },
    });

    // Member self-service account for the seeded Test Member, so the pilot
    // can demo the Member Portal immediately without registering by hand.
    const existingAccount = await prisma.memberAccount.findUnique({ where: { memberId: seededMember.id } });
    if (!existingAccount) {
      await prisma.memberAccount.create({
        data: {
          memberId: seededMember.id,
          nationalId: seededMember.nationalId,
          phoneNumber: "+254700000001",
          passwordHash,
        },
      });
    }
  }

  // ---------------------------------------------------------------------
  // Agrovet pilot account (Module 9). Written to be safe to run against a
  // database that already holds LIVE data (Embu is live): every step looks
  // first and only creates what's missing — nothing is updated, deleted, or
  // reset. Re-running the seed is always a no-op for anything that exists.
  // ---------------------------------------------------------------------
  const AGROVET_NATIONAL_ID = "AGRO-0001";
  let agrovetAccount = await prisma.agrovetAccount.findUnique({
    where: { nationalId: AGROVET_NATIONAL_ID },
    include: { agrovetShop: true },
  });
  if (!agrovetAccount) {
    const now = new Date();
    const shop = await prisma.agrovetShop.create({
      data: {
        name: "Runyenjes Agrovet Supplies (Pilot)",
        ownerName: "Test Agrovet Owner",
        phoneNumber: "+254700000002",
        physicalAddress: "Runyenjes Market (pilot test shop)",
        countyId: embu.id,
        subCounty: "Runyenjes",
        reimbursementMsisdn: "+254700000002",
        // Seeded straight to APPROVED so the collection flow can be demoed
        // immediately; recorded as reviewed and approved by the seeded Embu
        // Director so the approval trail is still complete.
        status: "APPROVED",
        reviewedById: director.id,
        reviewedAt: now,
        approvedById: director.id,
        approvedAt: now,
        account: {
          create: {
            nationalId: AGROVET_NATIONAL_ID,
            phoneNumber: "+254700000002",
            passwordHash,
          },
        },
        // Illustrative pilot catalogue prices, not a price list.
        products: {
          create: [
            { name: "DAP Fertilizer (50kg bag)", category: "FERTILIZER", unit: "BAG", unitPrice: 2500 },
            { name: "CAN Top-Dressing Fertilizer (50kg bag)", category: "FERTILIZER", unit: "BAG", unitPrice: 2500 },
            { name: "Certified Maize Seed (2kg)", category: "SEEDS", unit: "PIECE", unitPrice: 700 },
            { name: "Farmyard Manure (50kg bag)", category: "MANURE", unit: "BAG", unitPrice: 300 },
            { name: "Jembe (hoe)", category: "TOOLS", unit: "PIECE", unitPrice: 450 },
            { name: "Knapsack Sprayer (16L)", category: "EQUIPMENT", unit: "PIECE", unitPrice: 3500 },
          ],
        },
      },
    });
    console.log(`  Created agrovet pilot shop: ${shop.name}`);
  }

  // A government input credit for the seeded Test Member, so the agrovet can
  // look up PILOT-0001 and record a collection straight away. Only created
  // if that member has no input credit under this programme name yet.
  const PILOT_PROGRAMME = "Embu County Input Subsidy (Pilot)";
  const pilotMember = await prisma.member.findFirst({
    where: { cooperativeId: cooperative.id, nationalId: "PILOT-0001" },
  });
  if (pilotMember) {
    const existingCredit = await prisma.farmerInputCredit.findFirst({
      where: { memberId: pilotMember.id, programName: PILOT_PROGRAMME },
    });
    if (!existingCredit) {
      await prisma.farmerInputCredit.create({
        data: {
          memberId: pilotMember.id,
          programName: PILOT_PROGRAMME,
          totalAmount: 10000,
          remainingAmount: 10000,
          allocatedById: director.id,
          allocatedDate: new Date(),
        },
      });
      console.log("  Allocated a KES 10,000 pilot input credit to PILOT-0001");
    }
  }

  console.log("Pilot seed complete. All accounts share the password:", PILOT_PASSWORD);
  console.log(`  National Admin: admin@cooperatives.go.ke`);
  console.log(`  County Director (Embu): director@embu.go.ke`);
  console.log(`  Sub-County Officer (Embu): subcounty@embu.go.ke`);
  console.log(`  Employee (Field Officer): employee@embu.go.ke`);
  console.log(`  Cooperative Manager: manager@embu.go.ke or EMB-PILOT-0001 (at /cooperative/login)`);
  console.log(`  Cooperative: ${cooperative.name} (${cooperative.registrationNumber}) — Embu County`);
  console.log(`  Member Portal login: National ID "PILOT-0001", password "${PILOT_PASSWORD}"`);
  console.log(`  Agrovet Portal login: National ID "${AGROVET_NATIONAL_ID}", password "${PILOT_PASSWORD}" (at /agrovet/login)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * Diagnostic script for "login doesn't work" on a live deployment.
 *
 * Every schema change on this project (adding Contribution/ProduceDelivery/
 * Payout, then MemberAccount, then Asset/AssetEvent) required
 * `prisma db push --force-reset`, which drops every table — including
 * whatever staff and member accounts were seeded before. If the seed
 * commands weren't re-run immediately after the LAST reset, every login
 * attempt fails with "Invalid credentials" for the boring reason that the
 * account simply doesn't exist, not because anything is actually broken.
 *
 * Run with: node prisma/verify-seed.js
 * (or: npm run verify:seed)
 *
 * This prints exactly what's in the database right now, so you can tell in
 * one glance whether the problem is "no seed data" (re-run the seed) or
 * something else entirely (a CORS/URL misconfiguration — see
 * RENDER_DEPLOYMENT.md's troubleshooting section).
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("=== Database contents check ===\n");

  let countyCount, userCount, users, cooperativeCount, memberAccountCount, memberAccounts;

  try {
    countyCount = await prisma.county.count();
    userCount = await prisma.user.count();
    users = await prisma.user.findMany({
      select: { fullName: true, email: true, role: true, active: true },
      orderBy: { role: "asc" },
    });
    cooperativeCount = await prisma.cooperative.count();
    memberAccountCount = await prisma.memberAccount.count();
    memberAccounts = await prisma.memberAccount.findMany({
      select: { nationalId: true, active: true, member: { select: { legalName: true } } },
    });
  } catch (err) {
    console.error("Could not query the database at all. This usually means:");
    console.error("  - The tables don't exist yet (schema was never pushed), or");
    console.error("  - DATABASE_URL is wrong or the database is unreachable.\n");
    console.error("Run: npx prisma db push --force-reset --accept-data-loss");
    console.error("Then: npm run seed:counties && npm run seed:pilot\n");
    console.error("Raw error:", err.message);
    process.exit(1);
  }

  console.log(`Counties seeded:        ${countyCount} (expect 47)`);
  console.log(`Staff (User) accounts:  ${userCount}`);
  console.log(`Cooperatives:           ${cooperativeCount}`);
  console.log(`Member accounts:        ${memberAccountCount}\n`);

  if (userCount === 0) {
    console.log("❌ NO STAFF ACCOUNTS EXIST. This is why staff logins fail.");
    console.log("   Run: npm run seed:pilot\n");
  } else {
    console.log("Staff accounts on file:");
    for (const u of users) {
      console.log(`  - ${u.email}  [${u.role}]  ${u.active ? "active" : "DEACTIVATED"}  — ${u.fullName}`);
    }
    console.log("");
  }

  if (memberAccountCount === 0) {
    console.log("❌ NO MEMBER (FARMER) ACCOUNTS EXIST. This is why the farmer login fails.");
    console.log("   Run: npm run seed:pilot  (it seeds one member account automatically)\n");
  } else {
    console.log("Member (farmer) accounts on file:");
    for (const m of memberAccounts) {
      console.log(`  - National ID: ${m.nationalId}  ${m.active ? "active" : "DEACTIVATED"}  — ${m.member.legalName}`);
    }
    console.log("");
  }

  if (userCount > 0 && memberAccountCount > 0) {
    console.log("✅ Accounts exist. If login STILL fails from the browser, the problem is");
    console.log("   almost certainly not the database — check, in order:");
    console.log("   1. The password. All seeded accounts share: Pilot2026!");
    console.log("      Staff sign in with EMAIL + password. The farmer signs in with");
    console.log("      NATIONAL ID (not email) + password.");
    console.log("   2. NEXT_PUBLIC_API_BASE_URL on the frontend service — must be the");
    console.log("      backend's REAL Render URL + '/api', not a placeholder.");
    console.log("   3. FRONTEND_ORIGIN on the backend service — must exactly match the");
    console.log("      frontend's REAL Render URL (no trailing slash mismatch).");
    console.log("   4. Open the browser's Network tab on the login attempt and read the");
    console.log("      actual HTTP status/response — 401 means wrong credentials, a CORS");
    console.log("      error or a failed/opaque request means the URLs above are wrong.");
  }

  console.log("\nSeeded login reference (password Pilot2026! for all):");
  console.log("  National Admin:            admin@cooperatives.go.ke");
  console.log("  County Director (Embu):    director@embu.go.ke");
  console.log("  Field Officer:             employee@embu.go.ke");
  console.log("  Cooperative Manager:       manager@embu.go.ke");
  console.log("  Farmer (Member Portal):    National ID \"PILOT-0001\" at /member/login");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

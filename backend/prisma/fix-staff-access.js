/**
 * Live-safe repair for staff accounts created before role permissions were
 * applied automatically. Run on the live database with:
 *
 *   npm run fix:staff-access
 *
 * What it does:
 *   1. Every Sub-County Officer, Field Officer, or Cooperative Manager with
 *      ZERO permission rows gets their role's default permissions (from
 *      src/utils/rolePermissions.js). Accounts that already have ANY
 *      permission rows are left exactly as they are, so nothing a Director
 *      set deliberately is ever overwritten.
 *   2. Lists every Cooperative Manager who isn't linked to a cooperative, and
 *      the cooperatives in their county that have no manager, so a Director
 *      can assign them on the Staff & Access page. It does NOT guess which
 *      cooperative a manager belongs to.
 *
 * It never deletes anything and is safe to run repeatedly.
 */
const { PrismaClient } = require("@prisma/client");
const { defaultPermissionsForRole } = require("../src/utils/rolePermissions");

const prisma = new PrismaClient();
const ROLES_NEEDING_ROWS = ["SUBCOUNTY_OFFICER", "FIELD_OFFICER", "COOPERATIVE_MANAGER"];

async function main() {
  const users = await prisma.user.findMany({
    where: { role: { in: ROLES_NEEDING_ROWS } },
    include: { permissions: true, county: true, managedCoops: true },
  });

  let repaired = 0;
  console.log("=== Staff permissions ===");
  for (const u of users) {
    if (u.permissions.length > 0) continue;
    const rows = defaultPermissionsForRole(u.role);
    for (const row of rows) {
      await prisma.permission.create({ data: { ...row, userId: u.id } });
    }
    repaired++;
    console.log(`  FIXED  ${u.email} [${u.role}] — added ${rows.length} default permissions`);
  }
  console.log(repaired ? `  ${repaired} account(s) repaired.` : "  All staff accounts already had permissions. Nothing changed.");

  console.log("\n=== Cooperative Managers without a cooperative ===");
  const unlinked = users.filter((u) => u.role === "COOPERATIVE_MANAGER" && u.managedCoops.length === 0);
  if (unlinked.length === 0) {
    console.log("  None. Every manager is linked to a cooperative.");
  }
  for (const m of unlinked) {
    const free = await prisma.cooperative.findMany({
      where: { countyId: m.countyId, managerId: null },
      select: { name: true, registrationNumber: true },
    });
    console.log(`  NOT LINKED  ${m.email} (${m.county?.name || "no county"})`);
    console.log(
      free.length
        ? `      Unmanaged cooperatives in that county: ${free.map((c) => `${c.name} (${c.registrationNumber})`).join("; ")}`
        : "      No unmanaged cooperatives in that county. Create or free one up first."
    );
    console.log("      Fix: Staff & Access → this manager → Assign cooperative.");
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });

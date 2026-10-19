/**
 * Break-glass: clears two-step sign-in for one account (e.g. the only National
 * Admin lost their phone and recovery codes). Run from a computer with
 * DATABASE_URL set to the database's External URL:
 *
 *   npm run reset:mfa -- admin@cooperatives.go.ke
 *
 * Their old sessions end; at next sign-in they must set it up again.
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
(async () => {
  const email = process.argv[2];
  if (!email) throw new Error("Usage: npm run reset:mfa -- <email>");
  const prisma = new PrismaClient();
  try {
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u) throw new Error("No account with that email.");
    await prisma.user.update({
      where: { id: u.id },
      data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryHashes: null, mfaLastStep: null, passwordChangedAt: new Date() },
    });
    await prisma.auditLog.create({ data: { userId: u.id, action: "RESET_STAFF_MFA", entityType: "User", entityId: u.id, metadata: { via: "command line" } } });
    console.log(`Two-step sign-in cleared for ${email}.`);
  } finally { await prisma.$disconnect(); }
})().catch((e) => { console.error("Failed:", e.message); process.exit(1); });

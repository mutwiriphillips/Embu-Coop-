/**
 * Loads a backup file into a database.
 *
 *   npm run restore -- path/to/backup.jsonl.gz            (preview only)
 *   npm run restore -- path/to/backup.jsonl.gz --apply    (actually insert)
 *
 * NON-DESTRUCTIVE: only adds rows that are not already there; never updates
 * or deletes. Safe to run twice. The target database must already have the
 * tables (the build's `prisma db push` creates them). Best done on a fresh,
 * empty database BEFORE the backend first starts (the start-up geography sync
 * would otherwise create counties/wards with new ids).
 */
require("dotenv").config();
const fs = require("fs");
const { Prisma, PrismaClient } = require("@prisma/client");
const { restoreBackup } = require("../src/utils/backup");

(async () => {
  const file = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!file || file.startsWith("--")) throw new Error("Usage: npm run restore -- <backup-file> [--apply]");
  if (!fs.existsSync(file)) throw new Error("File not found: " + file);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  let host = "(unknown)";
  try { const u = new URL(process.env.DATABASE_URL); host = `${u.hostname}${u.pathname}`; } catch {}
  console.log(`Target database: ${host}`);

  const prisma = new PrismaClient();
  try {
    const { header, result } = await restoreBackup(prisma, Prisma.dmmf.datamodel, () => fs.createReadStream(file), {
      dryRun: !apply,
      log: (m) => console.log("  " + m),
    });
    console.log(`Backup taken ${header.createdAt}`);
    const rows = Object.entries(result).filter(([, v]) => v.inFile);
    if (!apply) {
      console.log("PREVIEW ONLY: nothing was written. Rows in the file:");
      rows.forEach(([n, v]) => console.log(`  ${n}: ${v.inFile}`));
      console.log("Run again with --apply to load them.");
    } else {
      console.log("Done. Inserted / already present:");
      rows.forEach(([n, v]) => console.log(`  ${n}: ${v.inserted} / ${v.skipped}`));
    }
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error("Restore failed:", e.message);
  process.exit(1);
});

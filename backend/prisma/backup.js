/**
 * Writes a full backup of the database to a file.
 *
 *   npm run backup                 -> backups/embu-coop-YYYY-MM-DD-HHMM.jsonl.gz
 *   npm run backup -- my-file.gz   -> that path
 *
 * Read-only: it never changes the database. Needs DATABASE_URL.
 * Keep the file somewhere safe and private: it holds password hashes,
 * ID/phone numbers and uploaded documents.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Prisma, PrismaClient } = require("@prisma/client");
const { writeBackup } = require("../src/utils/backup");

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const out = path.resolve(process.argv[2] || path.join("backups", `embu-coop-${stamp()}.jsonl.gz`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const prisma = new PrismaClient();
  try {
    const tmp = out + ".part";
    const { models, total } = await writeBackup(prisma, Prisma.dmmf.datamodel, fs.createWriteStream(tmp, { mode: 0o600 }));
    fs.renameSync(tmp, out); // only a complete file gets the real name
    const kb = Math.round(fs.statSync(out).size / 1024);
    console.log(`Backup written: ${out} (${kb} KB, ${total} rows)`);
    Object.entries(models).filter(([, n]) => n).forEach(([n, c]) => console.log(`  ${n}: ${c}`));
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error("Backup failed:", e.message);
  process.exit(1);
});

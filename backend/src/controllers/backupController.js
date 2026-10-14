const { Prisma } = require("@prisma/client");
const prisma = require("../config/db");
const { writeBackup } = require("../utils/backup");
const { recordAudit } = require("../utils/audit");

let running = false;

/**
 * GET /api/admin/backup — National Admin only. Streams a full backup file
 * (see utils/backup.js). One at a time, so repeated clicks can't pile up load.
 */
async function downloadBackup(req, res) {
  if (running) return res.status(429).json({ error: "A backup is already being prepared. Try again in a minute." });
  running = true;
  const now = new Date();
  const name = `embu-coop-${now.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.jsonl.gz`;
  try {
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Cache-Control", "no-store");
    const { total } = await writeBackup(prisma, Prisma.dmmf.datamodel, res, { now });
    // Counts only; never the contents.
    await recordAudit({ userId: req.user.id, action: "DATABASE_BACKUP_DOWNLOADED", entityType: "System", metadata: { rows: total, file: name } });
  } catch (err) {
    console.error("Backup download failed:", err);
    if (!res.headersSent) res.status(500).json({ error: "Backup failed" });
    else res.destroy(err);
  } finally {
    running = false;
  }
}

module.exports = { downloadBackup };

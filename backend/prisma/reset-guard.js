/**
 * Guard for `npm run reset:all`, which runs `prisma db push --force-reset`
 * and DROPS EVERY TABLE. That was the right fix during testing; now that
 * Embu County is live, running it by habit would destroy real farmer and
 * staff records. It now refuses to run unless explicitly unlocked:
 *
 *   ALLOW_DB_RESET=I_UNDERSTAND_THIS_DELETES_ALL_DATA npm run reset:all
 *
 * To add missing pilot/test accounts to a live database WITHOUT deleting
 * anything, run `npm run seed:pilot` instead — it only creates what's missing.
 */
if (process.env.ALLOW_DB_RESET !== "I_UNDERSTAND_THIS_DELETES_ALL_DATA") {
  console.error("\n  REFUSED: reset:all deletes EVERY record in the database (Embu is live).");
  console.error("  To add missing test accounts safely, run:  npm run seed:pilot");
  console.error("  To reset anyway (test databases only):");
  console.error("    ALLOW_DB_RESET=I_UNDERSTAND_THIS_DELETES_ALL_DATA npm run reset:all\n");
  process.exit(1);
}
console.log("ALLOW_DB_RESET confirmed — proceeding with a full database reset.");

const express = require("express");
const { authenticate, requireRole } = require("../middleware/auth");
const { downloadBackup } = require("../controllers/backupController");

const router = express.Router();
router.use(authenticate);

// A backup holds every record, password hashes and uploaded documents, so it
// is limited to the National Admin.
router.get("/backup", requireRole("NATIONAL_ADMIN"), downloadBackup);

module.exports = router;

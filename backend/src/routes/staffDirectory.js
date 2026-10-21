const express = require("express");
const { authenticate, requireRole } = require("../middleware/auth");
const c = require("../controllers/staffDirectoryController");
const sheet = require("../controllers/staffSheetController");

const router = express.Router();
router.use(authenticate);
// Staff information is for the Director and the National Admin only.
const viewers = requireRole("NATIONAL_ADMIN", "DIRECTOR");

router.get("/", viewers, c.list);
router.get("/merit", viewers, c.meritRanking);
router.get("/transfers", viewers, c.listTransfers);
router.post("/transfers/:tid/decision", requireRole("NATIONAL_ADMIN", "DIRECTOR"), c.decide);
router.post("/transfers/:tid/override", requireRole("NATIONAL_ADMIN"), c.override);
router.post("/transfers/:tid/cancel", viewers, c.cancel);
router.get("/sheet", requireRole("NATIONAL_ADMIN", "DIRECTOR"), sheet.download);
router.post("/sheet", requireRole("NATIONAL_ADMIN", "DIRECTOR"), sheet.uploadSheet);
router.post("/import-roster", requireRole("NATIONAL_ADMIN", "DIRECTOR"), c.importRoster);
router.get("/:id", viewers, c.getOne);
router.patch("/:id", requireRole("NATIONAL_ADMIN", "DIRECTOR"), c.edit);
router.put("/:id/status", viewers, c.setStatus);
router.put("/:id/reports-to", viewers, c.setReportsTo);
router.post("/:id/transfers", viewers, c.propose);

module.exports = router;

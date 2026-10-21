const express = require("express");
const { authenticate, requireRole } = require("../middleware/auth");
const c = require("../controllers/staffDirectoryController");

const router = express.Router();
router.use(authenticate);
const viewers = requireRole("NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER");

router.get("/", viewers, c.list);
router.get("/merit", viewers, c.meritRanking);
router.get("/transfers", viewers, c.listTransfers);
router.post("/transfers/:tid/decision", requireRole("NATIONAL_ADMIN", "DIRECTOR"), c.decide);
router.post("/transfers/:tid/cancel", viewers, c.cancel);
router.post("/import-roster", requireRole("NATIONAL_ADMIN", "DIRECTOR"), c.importRoster);
router.get("/:id", viewers, c.getOne);
router.patch("/:id", requireRole("NATIONAL_ADMIN", "DIRECTOR"), c.edit);
router.put("/:id/status", viewers, c.setStatus);
router.post("/:id/transfers", viewers, c.propose);

module.exports = router;

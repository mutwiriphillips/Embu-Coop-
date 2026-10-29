const express = require("express");
const { authenticate, requireRole } = require("../middleware/auth");
const c = require("../controllers/seasonRateController");
const imp = require("../controllers/seasonImportController");

// Season rates directory: average price per payment round, by crop year, factory and society.
const router = express.Router();
router.use(authenticate);
router.get("/", requireRole("NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER", "FIELD_OFFICER"), c.list);
router.get("/template", requireRole("NATIONAL_ADMIN", "DIRECTOR"), imp.template);
router.post("/import", requireRole("NATIONAL_ADMIN", "DIRECTOR"), imp.importFile);
router.put("/bulk", requireRole("NATIONAL_ADMIN", "DIRECTOR"), c.saveBulk);
router.delete("/:cooperativeId", requireRole("NATIONAL_ADMIN", "DIRECTOR"), c.remove);

module.exports = router;

const express = require("express");
const { authenticate, requireRole } = require("../middleware/auth");
const c = require("../controllers/factoryController");

// The factories (mills, processors, buyers) that pay societies for their produce.
const router = express.Router();
router.use(authenticate);
router.get("/", requireRole("NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER", "FIELD_OFFICER"), c.list);
router.post("/", requireRole("NATIONAL_ADMIN", "DIRECTOR"), c.create);
router.patch("/:id", requireRole("NATIONAL_ADMIN", "DIRECTOR"), c.update);
router.delete("/:id", requireRole("NATIONAL_ADMIN", "DIRECTOR"), c.remove);
module.exports = router;

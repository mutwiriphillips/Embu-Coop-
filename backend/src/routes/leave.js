const express = require("express");
const { authenticate, requireRole } = require("../middleware/auth");
const c = require("../controllers/leaveController");

// Leave on the County's leave application form, taken up the chain of command to final approval.
const router = express.Router();
router.use(authenticate);
router.use(requireRole("NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER", "FIELD_OFFICER", "OTHER_STAFF"));

router.get("/", c.list);
router.post("/", c.apply);
router.get("/preview", c.preview);
router.get("/balance", c.myBalance);
router.get("/accounts/:staffId", requireRole("NATIONAL_ADMIN", "DIRECTOR"), c.getAccount);
router.put("/accounts/:staffId", requireRole("NATIONAL_ADMIN", "DIRECTOR"), c.setAccount);
router.get("/:id", c.getOne);
router.post("/:id/act", c.act);
router.post("/:id/skip", c.skip);
router.post("/:id/cancel", c.cancel);

module.exports = router;

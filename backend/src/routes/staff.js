const express = require("express");
const { authenticate, requireRole } = require("../middleware/auth");
const {
  listStaff,
  getStaff,
  createStaff,
  updateStaff,
  deactivateStaff,
  setPermission,
} = require("../controllers/staffController");

const router = express.Router();

router.use(authenticate);

// Only the Director manages staff accounts and permissions (Module 1).
router.get("/", requireRole("DIRECTOR", "SUBCOUNTY_OFFICER"), listStaff);
router.get("/:id", requireRole("DIRECTOR", "SUBCOUNTY_OFFICER"), getStaff);
router.post("/", requireRole("DIRECTOR"), createStaff);
router.patch("/:id", requireRole("DIRECTOR"), updateStaff);
router.delete("/:id", requireRole("DIRECTOR"), deactivateStaff);
router.put("/:id/permissions", requireRole("DIRECTOR"), setPermission);

module.exports = router;

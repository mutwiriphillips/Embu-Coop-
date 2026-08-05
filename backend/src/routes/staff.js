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

// The Director manages staff within their county; a National Admin manages
// staff across all counties.
router.get("/", requireRole("NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER"), listStaff);
router.get("/:id", requireRole("NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER"), getStaff);
router.post("/", requireRole("NATIONAL_ADMIN", "DIRECTOR"), createStaff);
router.patch("/:id", requireRole("NATIONAL_ADMIN", "DIRECTOR"), updateStaff);
router.delete("/:id", requireRole("NATIONAL_ADMIN", "DIRECTOR"), deactivateStaff);
router.put("/:id/permissions", requireRole("NATIONAL_ADMIN", "DIRECTOR"), setPermission);

module.exports = router;

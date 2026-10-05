const express = require("express");
const { authenticate, requireRole } = require("../middleware/auth");
const { listCounties, countySummary, listSubCounties, listWards, countyBreakdown } = require("../controllers/countyController");

const router = express.Router();

// Public: the official county / sub-county / ward names the registration
// dropdowns need before anyone signs in. Names only, no records.
router.get("/", listCounties);
router.get("/sub-counties/:subCountyId/wards", listWards);
router.get("/:countyId/sub-counties", listSubCounties);

// National coverage figures for every county. This used to be public (anyone
// could see each county's cooperative and staff counts without signing in);
// it's now for the National Admin only, since each county sees only its own.
router.get("/summary", authenticate, requireRole("NATIONAL_ADMIN"), countySummary);

// The Director's sub-county / ward drill-down, scoped inside the controller.
router.get("/:countyId/breakdown", authenticate, requireRole("NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER"), countyBreakdown);

module.exports = router;

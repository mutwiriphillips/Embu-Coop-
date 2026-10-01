const express = require("express");
const { authenticate, requireRole, requireAgrovetShopAccess } = require("../middleware/auth");
const shops = require("../controllers/agrovetController");
const reimbursements = require("../controllers/agrovetReimbursementController");

// Mounted at /api/agrovets — staff-only, county-scoped throughout.
const router = express.Router();
router.use(authenticate);

router.get("/", shops.listAgrovets);
// Sub-County Officers (and above) can register a shop for its owner; it still
// needs Director sign-off via /:id/approve before it can trade.
router.post("/", requireRole("NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER"), shops.registerAgrovet);
router.get("/:id", requireAgrovetShopAccess(), shops.getAgrovet);
router.post("/:id/review", requireAgrovetShopAccess(), requireRole("NATIONAL_ADMIN", "SUBCOUNTY_OFFICER", "DIRECTOR"), shops.reviewAgrovet);
router.post("/:id/approve", requireAgrovetShopAccess(), requireRole("NATIONAL_ADMIN", "DIRECTOR"), shops.approveAgrovet);
router.patch("/:id/suspend", requireAgrovetShopAccess(), requireRole("NATIONAL_ADMIN", "DIRECTOR"), shops.suspendAgrovet);

router.get("/:id/collections", requireAgrovetShopAccess(), reimbursements.listShopCollectionsForStaff);
router.get("/:id/reimbursements", requireAgrovetShopAccess(), reimbursements.listReimbursements);
router.post("/:id/reimbursements", requireAgrovetShopAccess(), requireRole("NATIONAL_ADMIN", "DIRECTOR"), reimbursements.createReimbursement);

module.exports = router;

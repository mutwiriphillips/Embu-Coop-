const express = require("express");
const { authenticate, requirePermission, requireCooperativeAccess } = require("../middleware/auth");
const ctrl = require("../controllers/farmerInputCreditController");

// Mounted at /api/cooperatives/:id/input-credits
const router = express.Router({ mergeParams: true });
router.use(authenticate);
router.use(requireCooperativeAccess());

router.get("/", requirePermission("cooperatives", "canView"), ctrl.listCredits);
router.post("/", requirePermission("cooperatives", "canEdit"), ctrl.allocateCredit);

module.exports = router;

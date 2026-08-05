const express = require("express");
const { authenticate, requirePermission } = require("../middleware/auth");
const ctrl = require("../controllers/cooperativeController");

const router = express.Router();
router.use(authenticate);

router.get("/", requirePermission("cooperatives", "canView"), ctrl.listCooperatives);
router.get("/:id", requirePermission("cooperatives", "canView"), ctrl.getCooperative);
router.post("/", requirePermission("cooperatives", "canEdit"), ctrl.createCooperative);
router.patch("/:id", requirePermission("cooperatives", "canEdit"), ctrl.updateCooperative);
router.delete("/:id", requirePermission("cooperatives", "canEdit"), ctrl.deleteCooperative);

// Member roll (nested under a cooperative)
router.get("/:id/members", requirePermission("cooperatives", "canView"), ctrl.listMembers);
router.post("/:id/members", requirePermission("cooperatives", "canEdit"), ctrl.addMember);
router.patch("/:id/members/:memberId", requirePermission("cooperatives", "canEdit"), ctrl.updateMember);
router.delete("/:id/members/:memberId", requirePermission("cooperatives", "canEdit"), ctrl.removeMember);

module.exports = router;

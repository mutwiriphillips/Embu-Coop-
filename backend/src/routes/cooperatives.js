const express = require("express");
const { authenticate, requireRole, requirePermission, requireCooperativeAccess } = require("../middleware/auth");
const ctrl = require("../controllers/cooperativeController");

const router = express.Router();
router.use(authenticate);

// List/create don't have a specific cooperative ID yet, so the ownership
// check doesn't apply — listCooperatives already does its own county
// scoping internally (see scopedCountyId in cooperativeController).
router.get("/", requirePermission("cooperatives", "canView"), ctrl.listCooperatives);
// Registering a cooperative is a county function. Cooperative Managers hold
// "cooperatives: canEdit" so they can run their own society, which used to
// let them create new cooperatives too; requireRole now keeps this to staff.
router.post("/", requireRole("NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER", "FIELD_OFFICER"), requirePermission("cooperatives", "canEdit"), ctrl.createCooperative);

// Every route below references a specific cooperative — enforce ownership.
router.get("/:id", requireCooperativeAccess(), requirePermission("cooperatives", "canView"), ctrl.getCooperative);
router.patch("/:id", requireCooperativeAccess(), requirePermission("cooperatives", "canEdit"), ctrl.updateCooperative);
// Deleting a cooperative removes its whole record history, so only a Director
// (own county) or the National Admin can do it. Previously any manager could
// delete their own cooperative.
router.delete("/:id", requireRole("NATIONAL_ADMIN", "DIRECTOR"), requireCooperativeAccess(), ctrl.deleteCooperative);

// Member roll (nested under a cooperative) — carries National ID and phone
// numbers, so this is exactly the kind of data requireCooperativeAccess
// exists to protect.
router.get("/:id/members", requireCooperativeAccess(), requirePermission("cooperatives", "canView"), ctrl.listMembers);
router.post("/:id/members", requireCooperativeAccess(), requirePermission("cooperatives", "canEdit"), ctrl.addMember);
router.patch("/:id/members/:memberId", requireCooperativeAccess(), requirePermission("cooperatives", "canEdit"), ctrl.updateMember);
router.delete("/:id/members/:memberId", requireCooperativeAccess(), requirePermission("cooperatives", "canEdit"), ctrl.removeMember);

module.exports = router;

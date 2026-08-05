const express = require("express");
const { authenticate, requireRole, requirePermission } = require("../middleware/auth");
const ctrl = require("../controllers/documentController");

// Mounted at /api/cooperatives/:id/documents
const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get("/", requirePermission("documents", "canView"), ctrl.listDocuments);
router.post("/", requirePermission("documents", "canEdit"), ctrl.uploadDocument);

// Tier 1: Sub-county officer review
router.post(
  "/:docId/review",
  requireRole("SUBCOUNTY_OFFICER", "DIRECTOR"),
  ctrl.reviewDocument
);

// Tier 2: Director final sign-off
router.post("/:docId/approve", requireRole("DIRECTOR"), ctrl.approveDocument);

router.delete("/:docId", requireRole("DIRECTOR", "SUBCOUNTY_OFFICER"), ctrl.deleteDocument);

module.exports = router;

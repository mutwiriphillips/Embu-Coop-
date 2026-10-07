const express = require("express");
const { authenticate, requireRole, requirePermission, requireCooperativeAccess } = require("../middleware/auth");
const ctrl = require("../controllers/governanceController");
const { upload } = require("../utils/fileStorage");
const agmFiles = upload.fields([{ name: "notice", maxCount: 1 }, { name: "minutes", maxCount: 1 }]);

// Mounted at /api/cooperatives/:id/governance
const router = express.Router({ mergeParams: true });
router.use(authenticate);
router.use(requireCooperativeAccess());

// Committees
router.get("/committees", requirePermission("governance", "canView"), ctrl.listCommittees);
router.post("/committees", requirePermission("governance", "canEdit"), ctrl.saveCommittee);
router.post(
  "/committees/:committeeId/override",
  requireRole("NATIONAL_ADMIN", "DIRECTOR"),
  ctrl.overrideCommittee
);
router.post(
  "/committees/:committeeId/signatories",
  requirePermission("governance", "canEdit"),
  ctrl.addSignatory
);

// Fill in / correct a committee member's ID, phone and dates; record a retirement
router.patch(
  "/committees/:committeeId/members/:memberId",
  requirePermission("governance", "canEdit"),
  ctrl.updateCommitteeMember
);

// Supervisory Board (Chairman, Honorary Secretary, Member)
router.get("/supervisory-board", requirePermission("governance", "canView"), ctrl.listBoard);
router.post("/supervisory-board", requirePermission("governance", "canEdit"), ctrl.addBoardMember);
router.patch("/supervisory-board/:memberId", requirePermission("governance", "canEdit"), ctrl.updateBoardMember);
router.delete(
  "/supervisory-board/:memberId",
  requireRole("NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER"),
  requirePermission("governance", "canEdit"),
  ctrl.deleteBoardMember
);

// Election candidates
router.get("/candidates", requirePermission("governance", "canView"), ctrl.listCandidates);
router.post("/candidates", requirePermission("governance", "canEdit"), ctrl.applyCandidate);
router.patch(
  "/candidates/:candidateId",
  requirePermission("governance", "canApprove"),
  ctrl.updateCandidateStatus
);

// AGM
router.get("/agms", requirePermission("governance", "canView"), ctrl.listAGMs);
router.post("/agms", requirePermission("governance", "canEdit"), agmFiles, ctrl.recordAGM);
router.post("/agms/:agmId/files", requirePermission("governance", "canEdit"), agmFiles, ctrl.attachAGMFiles);

module.exports = router;

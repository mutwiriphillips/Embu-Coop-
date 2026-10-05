const express = require("express");
const { authenticate, requireRole } = require("../middleware/auth");
const ctrl = require("../controllers/fieldOpsController");
const { upload } = require("../utils/fileStorage");

const router = express.Router();
router.use(authenticate);
// Leave and field visits are county-staff functions; cooperative managers
// (who sign in through the Cooperative Portal) have no access here.
router.use(requireRole("NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER", "FIELD_OFFICER"));

// Leave
router.get("/leave", ctrl.listLeave);
router.post("/leave", ctrl.applyLeave);
router.post("/leave/:id/decision", requireRole("NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER"), ctrl.decideLeave);

// Field visits
router.get("/visits", ctrl.listVisits);
router.post("/visits", requireRole("NATIONAL_ADMIN", "FIELD_OFFICER", "SUBCOUNTY_OFFICER", "DIRECTOR"), ctrl.planVisit);
router.post("/visits/:id/decision", requireRole("NATIONAL_ADMIN", "SUBCOUNTY_OFFICER", "DIRECTOR"), ctrl.decideVisit);
router.post("/visits/:id/report", requireRole("NATIONAL_ADMIN", "FIELD_OFFICER", "SUBCOUNTY_OFFICER", "DIRECTOR"), ctrl.submitVisitReport);
router.post("/visits/:id/photos", upload.array("photos", 5), ctrl.addVisitPhotos);

module.exports = router;

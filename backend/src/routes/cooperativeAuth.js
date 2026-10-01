const express = require("express");
const { authenticate, requireRole } = require("../middleware/auth");
const ctrl = require("../controllers/cooperativeAuthController");

// Mounted at /api/cooperative-auth: the Cooperative Portal's own entry point.
const router = express.Router();
router.post("/login", ctrl.login);
router.get("/lookup", ctrl.lookup);
router.get("/me", authenticate, requireRole("COOPERATIVE_MANAGER"), ctrl.me);

module.exports = router;

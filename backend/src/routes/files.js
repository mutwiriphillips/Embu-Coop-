const express = require("express");
const jwt = require("jsonwebtoken");
const { authenticate, authenticateAgrovet } = require("../middleware/auth");
const ctrl = require("../controllers/fileController");

// Files can be opened by county staff, cooperative managers, and agrovet shop
// owners (each only their own, see fileController.canAccess). The token's type
// decides which sign-in check applies; farmer tokens are refused.
function authenticateStaffOrAgrovet(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  let type = null;
  try { type = token ? jwt.verify(token, process.env.JWT_SECRET).type : null; } catch { /* handled below */ }
  if (type === "agrovet") return authenticateAgrovet(req, res, next);
  if (type === "staff" || type === "cooperative") return authenticate(req, res, next);
  return res.status(401).json({ error: "Sign in to view files" });
}

const router = express.Router();
router.use(authenticateStaffOrAgrovet);
router.get("/", ctrl.list);
router.get("/:id", ctrl.download);

module.exports = router;

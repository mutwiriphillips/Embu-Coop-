const jwt = require("jsonwebtoken");
const prisma = require("../config/db");

/**
 * Verifies the JWT bearer token and attaches the authenticated user
 * (with permissions) to req.user.
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { permissions: true, county: true },
    });

    if (!user || !user.active) {
      return res.status(401).json({ error: "Account not found or deactivated" });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Restricts a route to one or more StaffRole values.
 * Usage: requireRole("DIRECTOR", "SUBCOUNTY_OFFICER")
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient role for this action" });
    }
    next();
  };
}

/**
 * Enforces granular module permissions assigned by the Director (Module 1).
 * The DIRECTOR role always passes — Directors have full access by design.
 */
function requirePermission(module, level = "canView") {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (req.user.role === "NATIONAL_ADMIN" || req.user.role === "DIRECTOR") return next();

    const perm = req.user.permissions.find((p) => p.module === module);
    if (!perm || !perm[level]) {
      return res.status(403).json({ error: `Missing '${level}' permission on module '${module}'` });
    }
    next();
  };
}

module.exports = { authenticate, requireRole, requirePermission };

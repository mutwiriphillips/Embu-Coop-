const bcrypt = require("bcryptjs");
const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { signToken, toPublicUser } = require("./authController");

// The Cooperative Portal's own sign-in. Like the farmer portal, it accepts
// the identifier people actually know: the manager's email OR the
// cooperative's registration number (e.g. EMB-PILOT-0001).
const loginSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
});

const managerInclude = {
  permissions: true,
  county: true,
  managedCoops: {
    select: { id: true, name: true, registrationNumber: true, valueChain: true, county: { select: { id: true, name: true } } },
  },
};

async function findManagerByIdentifier(identifier) {
  if (identifier.includes("@")) {
    return { user: await prisma.user.findUnique({ where: { email: identifier }, include: managerInclude }) };
  }
  const cooperative = await prisma.cooperative.findFirst({
    where: { registrationNumber: { equals: identifier, mode: "insensitive" } },
  });
  if (!cooperative) return { user: null };
  if (!cooperative.managerId) return { user: null, cooperativeWithoutManager: cooperative };
  return { user: await prisma.user.findUnique({ where: { id: cooperative.managerId }, include: managerInclude }) };
}

async function login(req, res) {
  const { identifier, password } = loginSchema.parse(req.body);
  const { user, cooperativeWithoutManager } = await findManagerByIdentifier(identifier);

  if (cooperativeWithoutManager) {
    return res.status(404).json({
      error: `${cooperativeWithoutManager.name} doesn't have a manager account yet. Your County Co-operative Office can create one.`,
      code: "NO_MANAGER_ACCOUNT",
    });
  }
  if (!user || !user.active) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // Password verified; now send county staff to the right door.
  if (user.role !== "COOPERATIVE_MANAGER") {
    return res.status(403).json({
      error: "This is a county staff account. Please use the County Staff sign-in.",
      code: "USE_STAFF_LOGIN",
    });
  }

  const token = signToken(user);
  await recordAudit({ userId: user.id, action: "COOPERATIVE_PORTAL_LOGIN", entityType: "User", entityId: user.id });
  res.json({ token, user: toPublicUser(user) });
}

// GET /api/cooperative-auth/lookup?registrationNumber=EMB-PILOT-0001
// Public, minimal: confirms which cooperative a registration number belongs
// to while the user types, so they can see they've got the right one before
// entering a password. Returns only the name, county, and whether a manager
// account exists; no members, money, or contact details.
async function lookup(req, res) {
  const { registrationNumber } = z.object({ registrationNumber: z.string().trim().min(3) }).parse(req.query);
  const cooperative = await prisma.cooperative.findFirst({
    where: { registrationNumber: { equals: registrationNumber, mode: "insensitive" } },
    include: { county: { select: { name: true } } },
  });
  if (!cooperative) return res.status(404).json({ error: "No cooperative with that registration number" });
  res.json({
    name: cooperative.name,
    registrationNumber: cooperative.registrationNumber,
    county: cooperative.county?.name || null,
    hasManagerAccount: Boolean(cooperative.managerId),
  });
}

async function me(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: managerInclude });
  res.json({ user: toPublicUser(user) });
}

module.exports = { login, lookup, me };

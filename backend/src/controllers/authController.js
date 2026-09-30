const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { defaultPermissionsForRole } = require("../utils/rolePermissions");

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// TEST-RUN ONLY: open signup accepts any email domain and lets a visitor
// self-register as a Field Officer or Cooperative Manager. It is gated by
// ALLOW_OPEN_SIGNUP so it can never be live by accident in production —
// see backend/.env.example and RENDER_DEPLOYMENT.md.
const signupSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["FIELD_OFFICER", "COOPERATIVE_MANAGER"]),
  countyId: z.string().uuid(),
  cooperativeId: z.string().uuid().optional(),
});

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, type: "staff" }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });
}

function toPublicUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

async function login(req, res) {
  const { email, password } = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({
    where: { email },
    include: { permissions: true, county: true },
  });

  if (!user || !user.active) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signToken(user);
  await recordAudit({ userId: user.id, action: "LOGIN", entityType: "User", entityId: user.id });

  res.json({ token, user: toPublicUser(user) });
}

async function me(req, res) {
  res.json({ user: toPublicUser(req.user) });
}

async function signup(req, res) {
  if (process.env.ALLOW_OPEN_SIGNUP !== "true") {
    return res.status(403).json({ error: "Open signup is disabled on this environment" });
  }

  const data = signupSchema.parse(req.body);

  // Cooperative Managers must be tied to a cooperative to see anything useful.
  if (data.role === "COOPERATIVE_MANAGER" && !data.cooperativeId) {
    return res.status(400).json({ error: "cooperativeId is required when signing up as a Cooperative Manager" });
  }

  // Signing up as a cooperative's manager used to silently take the
  // cooperative away from whoever already managed it (including the pilot
  // manager@embu.go.ke account), leaving them locked out with no error. A
  // cooperative that already has a manager can no longer be claimed here.
  if (data.role === "COOPERATIVE_MANAGER") {
    const coop = await prisma.cooperative.findUnique({ where: { id: data.cooperativeId } });
    if (!coop) return res.status(404).json({ error: "Cooperative not found" });
    if (coop.countyId !== data.countyId) {
      return res.status(400).json({ error: "That cooperative is not in the county you selected" });
    }
    if (coop.managerId) {
      return res.status(409).json({ error: "That cooperative already has a manager. Ask your County Director to assign you." });
    }
  }

  const passwordHash = await bcrypt.hash(data.password, 10);

  const user = await prisma.user.create({
    data: {
      fullName: data.fullName,
      email: data.email,
      passwordHash,
      role: data.role,
      countyId: data.countyId,
      permissions: { create: defaultPermissionsForRole(data.role) },
    },
  });

  if (data.role === "COOPERATIVE_MANAGER" && data.cooperativeId) {
    await prisma.cooperative.update({
      where: { id: data.cooperativeId },
      data: { managerId: user.id },
    });
  }

  await recordAudit({ userId: user.id, action: "OPEN_SIGNUP", entityType: "User", entityId: user.id });

  const userWithCounty = await prisma.user.findUnique({ where: { id: user.id }, include: { county: true } });
  const token = signToken(user);
  res.status(201).json({ token, user: toPublicUser(userWithCounty) });
}

module.exports = { login, me, signup, toPublicUser };

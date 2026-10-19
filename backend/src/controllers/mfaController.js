const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { httpError } = require("../utils/geography");
const mfa = require("../utils/mfa");
const { signToken, toPublicUser } = require("./authController");

const MFA_TOKEN_MINUTES = 5;
const codeSchema = z.object({ code: z.string().min(1).max(20) });

const staffOnly = (user) => {
  if (user.role === "COOPERATIVE_MANAGER") throw httpError(403, "Two-step sign-in is for county staff accounts.");
};

/** Short-lived proof that the password step passed. Cannot be used as a session. */
function signMfaToken(user) {
  return jwt.sign({ sub: user.id, type: "mfa" }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: `${MFA_TOKEN_MINUTES}m` });
}

// POST /api/auth/mfa/setup — start enrolment: returns the key and QR code.
async function setup(req, res) {
  staffOnly(req.user);
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (user.mfaEnabled) throw httpError(409, "Two-step sign-in is already on for this account.");
  const secret = mfa.generateSecret();
  await prisma.user.update({ where: { id: user.id }, data: { mfaSecret: mfa.encryptSecret(secret) } });
  const uri = mfa.otpauthUri(user.email, secret);
  res.json({ secret: mfa.groupSecret(secret), otpauthUri: uri, qr: mfa.qrShape(uri) });
}

// POST /api/auth/mfa/enable { code } — finish enrolment with a code from the app.
async function enable(req, res) {
  staffOnly(req.user);
  const { code } = codeSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (user.mfaEnabled) throw httpError(409, "Two-step sign-in is already on for this account.");
  if (!user.mfaSecret) throw httpError(400, "Start set-up first to get a key.");
  const step = mfa.verifyTotp(mfa.decryptSecret(user.mfaSecret), code);
  if (step === null) throw httpError(400, "That code is not right. Check the time on your phone and try the next code.");

  const { codes, hashes } = mfa.newRecoveryCodes();
  const updated = await prisma.user.update({
    where: { id: user.id },
    // Ends every older session, so a stolen password alone can't carry on.
    data: { mfaEnabled: true, mfaLastStep: step, mfaRecoveryHashes: hashes, passwordChangedAt: new Date() },
    include: { permissions: true, county: true },
  });
  await recordAudit({ userId: user.id, action: "MFA_ENABLED", entityType: "User", entityId: user.id });
  res.json({ token: signToken(updated), user: toPublicUser(updated), recoveryCodes: codes });
}

// POST /api/auth/mfa/verify { mfaToken, code | recoveryCode } — second step of sign-in.
const verifySchema = z.object({ mfaToken: z.string().min(1), code: z.string().max(20).optional(), recoveryCode: z.string().max(30).optional() });
async function verifyLogin(req, res) {
  const body = verifySchema.parse(req.body);
  let payload;
  try { payload = jwt.verify(body.mfaToken, process.env.JWT_SECRET, { algorithms: ["HS256"] }); }
  catch { return res.status(401).json({ error: "Your sign-in took too long. Please start again.", code: "MFA_EXPIRED" }); }
  if (payload.type !== "mfa") return res.status(401).json({ error: "Invalid sign-in step." });

  const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { permissions: true, county: true } });
  if (!user || !user.active || !user.mfaEnabled || !user.mfaSecret) return res.status(401).json({ error: "Invalid credentials" });

  const fail = () => res.status(401).json({ error: "That code is not right." });
  if (body.recoveryCode) {
    const remaining = mfa.useRecoveryCode(user.mfaRecoveryHashes, body.recoveryCode);
    if (!remaining) return fail();
    user.mfaRecoveryHashes = remaining;
    await prisma.user.update({ where: { id: user.id }, data: { mfaRecoveryHashes: remaining } });
    await recordAudit({ userId: user.id, action: "MFA_RECOVERY_CODE_USED", entityType: "User", entityId: user.id, metadata: { remaining: remaining.length } });
  } else if (body.code) {
    const step = mfa.verifyTotp(mfa.decryptSecret(user.mfaSecret), body.code, { lastStep: user.mfaLastStep });
    if (step === null) return fail();
    await prisma.user.update({ where: { id: user.id }, data: { mfaLastStep: step } });
  } else {
    return fail();
  }
  await recordAudit({ userId: user.id, action: "LOGIN", entityType: "User", entityId: user.id, metadata: { mfa: true } });
  res.json({ token: signToken(user), user: toPublicUser(user) });
}

// POST /api/auth/mfa/disable { password, code } — not allowed where it is required.
const confirmSchema = z.object({ password: z.string().min(1), code: z.string().min(1).max(20) });
async function confirmed(req) {
  const { password, code } = confirmSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user.mfaEnabled) throw httpError(400, "Two-step sign-in is not on for this account.");
  if (!(await bcrypt.compare(password, user.passwordHash))) throw httpError(400, "Your password is not correct.");
  const step = mfa.verifyTotp(mfa.decryptSecret(user.mfaSecret), code, { lastStep: user.mfaLastStep });
  if (step === null) throw httpError(400, "That code is not right.");
  return { user, step };
}
async function disable(req, res) {
  staffOnly(req.user);
  if (mfa.requiredRoles().includes(req.user.role)) throw httpError(403, "Two-step sign-in is required for your role and cannot be turned off.");
  const { user } = await confirmed(req);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryHashes: null, mfaLastStep: null, passwordChangedAt: new Date() },
    include: { permissions: true, county: true },
  });
  await recordAudit({ userId: user.id, action: "MFA_DISABLED", entityType: "User", entityId: user.id });
  res.json({ ok: true, token: signToken(updated), user: toPublicUser(updated) });
}

// POST /api/auth/mfa/recovery-codes { password, code } — replace the recovery codes.
async function regenerateRecoveryCodes(req, res) {
  staffOnly(req.user);
  const { user, step } = await confirmed(req);
  const { codes, hashes } = mfa.newRecoveryCodes();
  await prisma.user.update({ where: { id: user.id }, data: { mfaRecoveryHashes: hashes, mfaLastStep: step } });
  await recordAudit({ userId: user.id, action: "MFA_RECOVERY_CODES_REGENERATED", entityType: "User", entityId: user.id });
  res.json({ recoveryCodes: codes });
}

module.exports = { setup, enable, verifyLogin, disable, regenerateRecoveryCodes, signMfaToken };

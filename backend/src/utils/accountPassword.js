/**
 * Password handling shared by the farmer (MemberAccount) and agrovet
 * (AgrovetAccount) portals: forced change after a default-password login,
 * self-service change, and staff-assisted reset with a one-time temporary
 * password. There is no SMS/email provider yet, so there is no self-service
 * "forgot password": a forgotten password is reset by staff (see reset*).
 */
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const prisma = require("../config/db");
const { recordAudit } = require("./audit");
const { checkNewPassword, isKnownDefault, forceDefaultChange } = require("./passwordPolicy");

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Readable one-time password, e.g. "Kxmq-7Tbn-4Rwp" (no look-alike characters). */
function temporaryPassword() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [];
  for (let i = 0; i < 9; i++) chars.push(pick(letters));
  for (let i = 0; i < 3; i++) chars.push(pick(digits));
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}

/** A login with the published test password forces a change before anything else works. */
async function flagDefaultPassword(model, account, password) {
  if (!forceDefaultChange() && isKnownDefault(password) && account.mustChangePassword) {
    await prisma[model].update({ where: { id: account.id }, data: { mustChangePassword: false } });
    account.mustChangePassword = false;
  }
  if (forceDefaultChange() && isKnownDefault(password) && !account.mustChangePassword) {
    await prisma[model].update({ where: { id: account.id }, data: { mustChangePassword: true } });
    account.mustChangePassword = true;
  }
}

/** Changes the signed-in account's own password. Returns the updated account. */
async function changeOwnPassword(model, account, { currentPassword, newPassword }, auditAction) {
  if (!currentPassword || !newPassword) throw httpError(400, "Enter your current and new password.");
  if (!(await bcrypt.compare(currentPassword, account.passwordHash))) throw httpError(400, "Your current password is not correct.");
  const problem = checkNewPassword(newPassword, { email: account.email, current: currentPassword });
  if (problem) throw httpError(400, problem);
  const updated = await prisma[model].update({
    where: { id: account.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: false, passwordChangedAt: new Date() },
  });
  await recordAudit({ action: auditAction, entityType: model === "memberAccount" ? "MemberAccount" : "AgrovetAccount", entityId: account.id });
  return updated;
}

/** Staff-assisted reset: sets a random temporary password, shown once. */
async function resetToTemporary(model, accountId, actorUserId, auditAction) {
  const temp = temporaryPassword();
  await prisma[model].update({
    where: { id: accountId },
    data: { passwordHash: await bcrypt.hash(temp, 12), mustChangePassword: true, passwordChangedAt: new Date() },
  });
  // The audit entry records who reset whom, never the password.
  await recordAudit({ userId: actorUserId, action: auditAction, entityType: model === "memberAccount" ? "MemberAccount" : "AgrovetAccount", entityId: accountId });
  return temp;
}

module.exports = { temporaryPassword, flagDefaultPassword, changeOwnPassword, resetToTemporary, httpError };

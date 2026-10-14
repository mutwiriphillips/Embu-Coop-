/**
 * Password rules for staff and cooperative-manager accounts, and the list of
 * passwords that are published in the project's own documentation and so must
 * never stay in use.
 */
const KNOWN_DEFAULTS = ["pilot2026!"];
const COMMON = ["password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "welcome123", "admin12345", "kenya2026", "embu2026"];

const isKnownDefault = (password) => KNOWN_DEFAULTS.includes(String(password || "").toLowerCase());

/** Returns a message describing the first problem, or null if acceptable. */
function checkNewPassword(password, { email, current } = {}) {
  const p = String(password || "");
  if (p.length < 10) return "Use at least 10 characters.";
  if (p.length > 128) return "Use at most 128 characters.";
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return "Include both letters and numbers.";
  if (isKnownDefault(p)) return "That is the published test password. Choose your own.";
  if (COMMON.includes(p.toLowerCase())) return "That password is too common.";
  if (email) {
    const local = String(email).split("@")[0].toLowerCase();
    if (local.length >= 4 && p.toLowerCase().includes(local)) return "Don't include your email name in the password.";
  }
  if (current && p === current) return "Choose a password different from the current one.";
  return null;
}

/** Whether tokens issued at `iatSeconds` pre-date the last password change. */
const issuedBeforeChange = (iatSeconds, changedAt) => Boolean(changedAt) && Number(iatSeconds) < Math.floor(new Date(changedAt).getTime() / 1000);

/** FORCE_DEFAULT_PASSWORD_CHANGE=false switches the forced change off. */
const forceDefaultChange = () => process.env.FORCE_DEFAULT_PASSWORD_CHANGE !== "false";

module.exports = { isKnownDefault, checkNewPassword, issuedBeforeChange, forceDefaultChange };

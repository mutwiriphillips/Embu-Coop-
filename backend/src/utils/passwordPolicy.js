/**
 * Password rules for staff and cooperative-manager accounts, and the list of
 * passwords that are published in the project's own documentation and so must
 * never stay in use.
 */
const KNOWN_DEFAULTS = ["pilot2026!"];
const COMMON = ["password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "welcome123", "admin12345", "kenya2026", "embu2026"];

const isKnownDefault = (password) => KNOWN_DEFAULTS.includes(String(password || "").toLowerCase());

/**
 * One master switch for the hardening that is held back during the pilot:
 * SECURITY_HARDENING=true turns on (a) the forced change of the published test
 * password, (b) two-step sign-in for National Admin and Director, and (c) the
 * strict password rules. Left unset or false, the pilot password keeps working.
 * FORCE_DEFAULT_PASSWORD_CHANGE and MFA_ENFORCEMENT, when set to "true" or
 * "false", override the master switch for their own feature.
 */
const hardening = () => process.env.SECURITY_HARDENING === "true";
const flag = (name) => (process.env[name] === "true" ? true : process.env[name] === "false" ? false : hardening());

/** Returns a message describing the first problem, or null if acceptable. */
function checkNewPassword(password, { email, current } = {}) {
  const p = String(password || "");
  if (!hardening()) {
    // Pilot rules: just a sensible minimum. The published test password is allowed.
    if (p.length < 8) return "Use at least 8 characters.";
    if (p.length > 128) return "Use at most 128 characters.";
    if (current && p === current) return "Choose a password different from the current one.";
    return null;
  }
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

/** Whether signing in with the published test password forces a change (off during the pilot). */
const forceDefaultChange = () => flag("FORCE_DEFAULT_PASSWORD_CHANGE");
/** Whether the MFA requirement for National Admin / Director is on (off during the pilot). */
const mfaEnforced = () => flag("MFA_ENFORCEMENT");

module.exports = { isKnownDefault, checkNewPassword, issuedBeforeChange, forceDefaultChange, mfaEnforced, hardening };

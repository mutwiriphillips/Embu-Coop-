/**
 * Two-step sign-in with an authenticator app (RFC 6238 time-based codes:
 * SHA-1, 6 digits, 30-second steps; works with Google Authenticator, Microsoft
 * Authenticator, Authy, FreeOTP and others). No outside service is involved.
 */
const crypto = require("crypto");
const qrcode = require("qrcode-generator");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const ISSUER = "Embu Co-operatives";

// ---- base32 ------------------------------------------------------------
function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const ch of String(str).toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    value = (value << 5) | ALPHABET.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// ---- TOTP --------------------------------------------------------------
const generateSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(secretB32, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1000000).padStart(6, "0");
}

const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * Returns the time step the code belongs to, or null if it is wrong, or was
 * already used (a code is good once: lastStep is the newest step accepted).
 * One step either side of now is allowed for clock drift.
 */
function verifyTotp(secretB32, code, { lastStep = null, now = Date.now() } = {}) {
  const c = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const t = currentStep(now);
  for (const step of [t - 1, t, t + 1]) {
    const expected = hotp(secretB32, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c)) && (lastStep === null || lastStep === undefined || step > lastStep)) return step;
  }
  return null;
}

// ---- secret storage ----------------------------------------------------
function key() {
  const base = process.env.MFA_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!base) throw new Error("JWT_SECRET (or MFA_ENCRYPTION_KEY) is not set");
  return crypto.createHash("sha256").update("embu-mfa-v1|" + base).digest();
}
function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}
function decryptSecret(stored) {
  const [v, iv, tag, ct] = String(stored || "").split(":");
  if (v !== "v1") throw new Error("Unreadable MFA secret");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

// ---- recovery codes ----------------------------------------------------
const normalizeRecovery = (c) => String(c || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
const hashRecovery = (c) => crypto.createHmac("sha256", key()).update(normalizeRecovery(c)).digest("hex");
function newRecoveryCodes(n = 8) {
  const codes = Array.from({ length: n }, () => {
    const raw = base32Encode(crypto.randomBytes(7)).slice(0, 10);
    return raw.slice(0, 5) + "-" + raw.slice(5);
  });
  return { codes, hashes: codes.map(hashRecovery) };
}
/** Returns the remaining hashes if `code` matches one (and removes it), else null. */
function useRecoveryCode(hashes, code) {
  const h = hashRecovery(code);
  if (normalizeRecovery(code).length !== 10) return null;
  const list = Array.isArray(hashes) ? hashes : [];
  const i = list.findIndex((x) => x.length === h.length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(h)));
  if (i < 0) return null;
  return list.filter((_, j) => j !== i);
}

// ---- enrolment helpers ---------------------------------------------------
const otpauthUri = (email, secret) =>
  `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;

// The QR code as plain geometry (a size and one SVG path), so the browser draws
// it itself and no markup from the server is ever inserted into the page.
function qrShape(text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
  return { size: n, path };
}

const groupSecret = (s) => s.match(/.{1,4}/g).join(" ");

/** Roles that must use two-step sign-in (MFA_REQUIRED_ROLES, default National Admin + Director). */
function requiredRoles() {
  if (!require("./passwordPolicy").mfaEnforced()) return [];
  return (process.env.MFA_REQUIRED_ROLES || "NATIONAL_ADMIN,DIRECTOR").split(",").map((r) => r.trim()).filter(Boolean);
}
const mfaSetupRequired = (user) => Boolean(user) && !user.mfaEnabled && user.role !== "COOPERATIVE_MANAGER" && requiredRoles().includes(user.role);

module.exports = {
  base32Encode, base32Decode, generateSecret, hotp, verifyTotp, currentStep,
  encryptSecret, decryptSecret, newRecoveryCodes, useRecoveryCode, otpauthUri, qrShape, groupSecret,
  requiredRoles, mfaSetupRequired,
};

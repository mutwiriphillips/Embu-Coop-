const { z } = require("zod");

/**
 * Shared field validators for the governance records (committee and
 * supervisory board). Kept deliberately practical: they catch typos without
 * rejecting real people.
 */

// Kenyan mobile and landline numbers, typed any of the usual ways:
//   0712 345 678   0112345678   +254 712 345 678   254712345678   712345678
// are all stored in one form, +254XXXXXXXXX, so they can be searched and
// compared reliably later.
function normalizeKenyanPhone(input) {
  const digits = String(input ?? "").replace(/[\s\-().]/g, "");
  let national = null;
  if (/^\+254\d{9}$/.test(digits)) national = digits.slice(4);
  else if (/^254\d{9}$/.test(digits)) national = digits.slice(3);
  else if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  else if (/^\d{9}$/.test(digits)) national = digits;
  if (!national || !/^[1-9]/.test(national)) return null; // 9 digits after the country code; mobiles (7xx, 1xx) and landlines both pass
  return `+254${national}`;
}

const phoneSchema = z
  .string({ required_error: "Phone number is required" })
  .trim()
  .min(1, "Phone number is required")
  .transform((v, ctx) => {
    const n = normalizeKenyanPhone(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid Kenyan phone number, e.g. 0712 345 678 or +254 712 345 678" });
      return z.NEVER;
    }
    return n;
  });

// National ID (7-8 digits for most citizens, 6 for some older cards). A few
// officials hold a passport or alien ID instead, so letters are allowed;
// spaces and punctuation are not.
const nationalIdSchema = z
  .string({ required_error: "ID number is required" })
  .trim()
  .min(1, "ID number is required")
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z0-9]{5,15}$/.test(v), "ID number must be 5 to 15 letters or digits, with no spaces or symbols");

// Dates sent from a form arrive as "2026-10-07" (or "" when left blank).
// zod's own date coercion turns a missing value into the vague "Invalid date",
// so these name the field, and reject years that are plainly typos (0202).
const blankToUndefined = (v) => (v === "" || v === null ? undefined : v);

function dateField(label, { required }) {
  return z.preprocess(
    blankToUndefined,
    z
      .any()
      .superRefine((v, ctx) => {
        if (v === undefined) {
          if (required) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is required` });
          return;
        }
        const d = new Date(v);
        if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1900 || d.getUTCFullYear() > 2100) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is not a valid date` });
        }
      })
      .transform((v) => (v === undefined ? undefined : new Date(v)))
  );
}
const requiredDate = (label) => dateField(label, { required: true });
const optionalDate = (label) => dateField(label, { required: false });
// For PATCH: undefined = leave alone, null or "" = clear it, a date = set it.
const clearableDate = (label) =>
  z.preprocess((v) => (v === "" ? null : v), z.union([z.null(), dateField(label, { required: true })]).optional());

module.exports = { normalizeKenyanPhone, phoneSchema, nationalIdSchema, requiredDate, optionalDate, clearableDate, blankToUndefined };

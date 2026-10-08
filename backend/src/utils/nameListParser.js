const { normalizeKenyanPhone } = require("./validators");

/**
 * Turns the lines of a typed name list into candidate records. This only
 * PROPOSES: every row is shown to a person for checking and correction before
 * anything is saved, and each guess that could be wrong carries a warning.
 *
 * Rather than relying on a fixed column order, each line is searched for the
 * things that have a recognisable shape (phone, ID, date, gender, position)
 * and whatever text is left over is taken as the name. That copes with the
 * many ways societies lay out their registers.
 */

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

const PHONE_RE = /(?<![\d])(?:\+?254|0)[\s.\-]?[17]\d{2}[\s.\-]?\d{3}[\s.\-]?\d{3}(?![\d])/;
const ID_RE = /(?<![\d])\d{7,8}(?![\d])/;
const DATE_NUM_RE = /(?<![\d])(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?![\d])/;
const DATE_ISO_RE = /(?<![\d])(\d{4})-(\d{2})-(\d{2})(?![\d])/;
const DATE_TXT_RE = /(?<![\d])(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,9})\.?,?[\s\-]+(\d{4})(?![\d])/;

const HEADER_WORDS = new Set(["name", "names", "member", "id", "no", "no.", "number", "phone", "tel", "telephone", "mobile", "contact", "gender", "sex",
  "position", "office", "designation", "role", "title", "date", "appointed", "appointment", "signature", "sign", "remarks", "s/n", "sn", "#", "of", "national", "full"]);

function iso(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || y > 2100) return null;
  return dt.toISOString().slice(0, 10);
}

// Day-first, as written in Kenya (05/03/2026 = 5 March 2026).
function findDate(text) {
  let m = text.match(DATE_ISO_RE);
  if (m) return { value: iso(+m[1], +m[2], +m[3]), raw: m[0] };
  m = text.match(DATE_NUM_RE);
  if (m) return { value: iso(+m[3], +m[2], +m[1]), raw: m[0] };
  m = text.match(DATE_TXT_RE);
  if (m && MONTHS[m[2].toLowerCase()]) return { value: iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]), raw: m[0] };
  return null;
}

const MGMT_ROLES = [
  [/vice[\s\-]*chair\w*/i, "VICE_CHAIRPERSON"],
  [/chair\s*(?:person|man|woman)?/i, "CHAIRPERSON"],
  [/secretary/i, "SECRETARY"],
  [/treasurer/i, "TREASURER"],
  [/executive\s+manager|general\s+manager|\bmanager\b/i, "EXECUTIVE_MANAGER"],
  [/(?:board|committee)?\s*\bmembers?\b|\bdirector\b/i, "BOARD_MEMBER"],
];
const BOARD_ROLES = [
  [/hon(?:orary|\.)?\s*sec\w*|honorary\s+secretary/i, "HONORARY_SECRETARY"],
  [/chair\s*(?:person|man|woman)?/i, "CHAIRMAN"],
  [/secretary/i, "HONORARY_SECRETARY"],
  [/\bmembers?\b/i, "MEMBER"],
];

function findRole(text, kind) {
  const table = kind === "BOARD" ? BOARD_ROLES : MGMT_ROLES;
  for (const [re, role] of table) {
    const m = text.match(re);
    if (m) return { role, raw: m[0] };
  }
  return null;
}

// A cell that is exactly M / F / Male / Female (table layouts).
function genderFromCells(cells) {
  for (let i = 0; i < cells.length; i++) {
    if (/^(male|m)$/i.test(cells[i])) return { value: "MALE", index: i };
    if (/^(female|f)$/i.test(cells[i])) return { value: "FEMALE", index: i };
  }
  return null;
}

// Free-text layouts. A lone M or F is only trusted as the last thing on the
// line, so a middle initial ("John F Kamau") is not mistaken for a gender.
function genderFromText(text) {
  let m = text.match(/\b(female|male)\b/i);
  if (m) return { value: m[1].toLowerCase() === "male" ? "MALE" : "FEMALE", re: new RegExp("\\b" + m[1] + "\\b", "i") };
  m = text.match(/\s([MF])\s*$/);
  if (m) return { value: m[1] === "M" ? "MALE" : "FEMALE", re: /\s[MF]\s*$/ };
  return null;
}

function titleCase(name) {
  const letters = name.replace(/[^A-Za-z]/g, "");
  if (!letters) return name;
  const allUpper = letters === letters.toUpperCase();
  const allLower = letters === letters.toLowerCase();
  if (!allUpper && !allLower) return name;
  return name.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

function isHeader(cells) {
  const words = cells.join(" ").toLowerCase().split(/[\s\t|]+/).filter(Boolean);
  if (words.length < 2) return false;
  const hits = words.filter((w) => HEADER_WORDS.has(w.replace(/[:.,]+$/, ""))).length;
  return hits >= 2 && hits >= words.length * 0.5;
}

function cleanName(text) {
  return text
    .replace(/\b(?:mr|mrs|miss|ms|dr|hon|eng|prof|rev)\b\.?/gi, " ")
    .replace(/\b(?:id|tel|phone|mobile|contact|cell|no|gender|sex|sn|s\/n)\b\.?/gi, " ")
    .replace(/[|,;:]+/g, " ")
    .replace(/(^|\s)[\-–—]+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {{page:number,text:string}[]} lines
 * @param {"MEMBERS"|"COMMITTEE"|"BOARD"} kind
 * @returns {{rows: object[], skipped: {page:number,text:string,reason:string}[]}}
 */
function parseNameList(lines, kind) {
  const rows = [];
  const skipped = [];

  for (const { page, text: line } of lines) {
    let cells = line.split("\t").map((c) => c.trim()).filter(Boolean);
    const headerCheck = cells;

    let rest = "";
    const flat = () => rest.replace(/\s*\t\s*/g, " ");
    rest = cells.join(" \t ");
    if (isHeader(headerCheck)) { skipped.push({ page, text: flat(), reason: "Column headings" }); continue; }

    // gender, table layout: take the exact cell out first
    let gender = null;
    if (kind !== "BOARD") {
      const gc = genderFromCells(cells);
      if (gc) { gender = gc.value; cells = cells.filter((_, i) => i !== gc.index); rest = cells.join(" \t "); }
    }

    // phone
    let phone = null;
    const pm = flat().match(PHONE_RE);
    if (pm) {
      phone = normalizeKenyanPhone(pm[0]);
      rest = rest.replace(pm[0], " ");
      if (!phone) phone = null;
    }
    // date
    const dm = findDate(flat());
    if (dm) rest = rest.replace(dm.raw, " ");
    // id
    const im = flat().match(ID_RE);
    if (im) rest = rest.replace(im[0], " ");
    // position
    let role = null;
    if (kind !== "MEMBERS") {
      const rm = findRole(flat(), kind);
      if (rm) { role = rm.role; rest = rest.replace(rm.raw, " "); }
    }
    // gender, free-text layout (not asked of the Supervisory Board)
    if (kind !== "BOARD" && !gender) {
      const gt = genderFromText(flat());
      if (gt) { gender = gt.value; rest = rest.replace(gt.re, " "); }
    }
    // serial number at the start
    rest = rest.replace(/^\s*\d{1,4}\s*[.)\-:]?\s*(?=\t|\s+[A-Za-z])/, " ");
    rest = rest.replace(/(^|\t)\s*\d{1,4}\s*(?=\t)/, "$1 ");

    const name = cleanName(rest.replace(/\t/g, " ").replace(/\d+/g, " "));
    const words = name.split(" ").filter((w) => /[A-Za-z]/.test(w));

    const hasSignal = kind === "MEMBERS" ? (im || pm || gender) : (im || pm || role);
    if (!hasSignal) { skipped.push({ page, text: flat(), reason: kind === "MEMBERS" ? "No ID, phone or gender on this line" : "No position, ID or phone on this line" }); continue; }
    if (words.length < 2) { skipped.push({ page, text: flat(), reason: "No full name found on this line" }); continue; }

    const row = {
      fullName: titleCase(name),
      nationalId: im ? im[0] : "",
      phoneNumber: phone || "",
      ...(kind !== "BOARD" ? { gender: gender || "" } : {}),
      ...(kind !== "MEMBERS" ? { role: role || "", appointmentDate: dm?.value || "" } : {}),
      sourceLine: flat(),
      page,
      warnings: [],
    };
    if (!row.nationalId) row.warnings.push("No 7-8 digit ID found");
    if (!row.phoneNumber && kind !== "MEMBERS") row.warnings.push("No phone found");
    if (pm && !phone) row.warnings.push("Phone could not be read");
    if (kind !== "BOARD" && !row.gender) row.warnings.push("Gender not found");
    if (kind !== "MEMBERS" && !row.role) row.warnings.push("Position not found");
    if (kind !== "MEMBERS" && !row.appointmentDate) row.warnings.push(dm ? "Date could not be read" : "No date found");
    rows.push(row);
  }

  // Same ID twice in the file: keep the first, flag the repeats.
  const seen = new Map();
  rows.forEach((r, i) => {
    if (!r.nationalId) return;
    if (seen.has(r.nationalId)) { r.duplicateOfRow = seen.get(r.nationalId) + 1; r.warnings.push(`Same ID as row ${seen.get(r.nationalId) + 1}`); }
    else seen.set(r.nationalId, i);
  });

  return { rows, skipped };
}

module.exports = { parseNameList, findDate, titleCase };

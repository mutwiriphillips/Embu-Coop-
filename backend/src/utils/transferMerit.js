/**
 * Transfer merit: a transparent score out of 100 that helps rank who is best
 * placed for a move up (sub-county office -> county office -> Ministry).
 * It is an aid to the decision-maker, never the decision.
 *
 *   Years of service     up to 30   1.5 points per year, capped at 20 years
 *   Qualifications       up to 25   highest level held (+5 for a professional body, capped)
 *   Job group (grade)    up to 25   position on the job-group ladder
 *   Appraisal rating     up to 20   0-20, entered by the person proposing the transfer
 *
 * The first three come from the staff record; the last is entered by hand
 * because appraisals are not stored in this system. Without it the staff
 * member is still ranked, on the 80 automatic points.
 */
const JOB_GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R", "S"];

const QUAL_LEVELS = [
  { re: /\b(ph\.?d|doctorate)\b/i, points: 25, label: "Doctorate" },
  { re: /\bmasters?\b|\bm\.?sc\b|\bmba\b|\bm\.?a\b/i, points: 20, label: "Masters" },
  { re: /\bbachelor|\bdegree\b|\bb\.?sc\b|\bbcom\b|\bb\.?a\b|\bb\.?ed\b/i, points: 15, label: "Degree" },
  { re: /\bdiploma\b/i, points: 10, label: "Diploma" },
  { re: /\bcertificate\b|\bkace\b|\bkcse\b/i, points: 5, label: "Certificate" },
];
const PROFESSIONAL = /\bcpa\b|\bacca\b|\bcisa\b|\bcs\b\s*\(|\bcertified\b/i;

function qualificationPoints(text) {
  const t = String(text || "");
  if (!t.trim()) return { points: 0, label: "None recorded" };
  const level = QUAL_LEVELS.find((l) => l.re.test(t));
  let points = level ? level.points : 5;
  let label = level ? level.label : "Other";
  if (PROFESSIONAL.test(t)) { points = Math.min(25, points + 5); label += " + professional"; }
  return { points, label };
}

function gradePoints(jobGroup) {
  const g = String(jobGroup || "").trim().toUpperCase();
  const i = JOB_GROUPS.indexOf(g);
  if (i < 0) return { points: 0, label: "Not recorded" };
  return { points: Math.round((i / (JOB_GROUPS.length - 1)) * 25 * 10) / 10, label: `Group ${g}` };
}

function computeMerit(staff, { appraisal = null, now = new Date() } = {}) {
  const years = staff.yearEmployed ? Math.max(0, now.getUTCFullYear() - Number(staff.yearEmployed)) : 0;
  const service = { points: Math.min(years, 20) * 1.5, label: staff.yearEmployed ? `${years} year${years === 1 ? "" : "s"}` : "Not recorded" };
  const qual = qualificationPoints(staff.qualifications);
  const grade = gradePoints(staff.jobGroup);
  const rated = appraisal !== null && appraisal !== undefined && appraisal !== "";
  const app = { points: rated ? Math.max(0, Math.min(20, Number(appraisal))) : 0, label: rated ? "Entered by proposer" : "Not rated yet" };
  const automatic = service.points + qual.points + grade.points;
  const total = Math.round(automatic + app.points);
  return {
    total,
    automatic: Math.round(automatic),
    outOf: 100,
    parts: { service: { ...service, max: 30 }, qualifications: { ...qual, max: 25 }, grade: { ...grade, max: 25 }, appraisal: { ...app, max: 20 } },
  };
}

/** The only moves the system supports: up one level. */
const NEXT_LEVEL = { SUB_COUNTY_OFFICE: "COUNTY_OFFICE", COUNTY_OFFICE: "MINISTRY" };

module.exports = { computeMerit, qualificationPoints, gradePoints, JOB_GROUPS, NEXT_LEVEL };

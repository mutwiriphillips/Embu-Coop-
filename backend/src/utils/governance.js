/**
 * Governance logic per Engineering Scope §7 (Module 5).
 *
 * ELECTED_ROLES are counted toward the 1/3 gender rotation rule.
 * EXECUTIVE_MANAGER is a non-elected role and is explicitly excluded.
 */
const ELECTED_MANAGEMENT_ROLES = [
  "CHAIRPERSON",
  "VICE_CHAIRPERSON",
  "SECRETARY",
  "TREASURER",
  "BOARD_MEMBER",
];

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Is this person still in office? Someone with no retirement date, or a
 * retirement date still ahead of us, is serving. Anyone whose retirement date
 * has passed has left: they no longer count toward the 1/3 rule and an
 * old term of theirs no longer makes the committee look "expired".
 */
function isServing(member, now = new Date()) {
  if (!member.retirementDate) return true;
  return new Date(member.retirementDate).getTime() > now.getTime();
}

/**
 * Checks the 1/3 gender rotation rule against a proposed/current set of
 * committee members. No single gender may hold more than 2/3 of elected seats.
 *
 * @param {Array<{gender: 'MALE'|'FEMALE', role: string}>} members
 * @returns {{ compliant: boolean, maleCount: number, femaleCount: number, totalElectedSeats: number, reason?: string }}
 */
function checkOneThirdRule(members, now = new Date()) {
  const elected = members.filter((m) => ELECTED_MANAGEMENT_ROLES.includes(m.role) && isServing(m, now));
  const totalElectedSeats = elected.length;

  if (totalElectedSeats === 0) {
    return { compliant: true, maleCount: 0, femaleCount: 0, totalElectedSeats: 0 };
  }

  const maleCount = elected.filter((m) => m.gender === "MALE").length;
  const femaleCount = elected.filter((m) => m.gender === "FEMALE").length;

  const maxAllowed = Math.floor((2 / 3) * totalElectedSeats + 1e-9);
  const compliant = maleCount <= maxAllowed && femaleCount <= maxAllowed;

  return {
    compliant,
    maleCount,
    femaleCount,
    totalElectedSeats,
    reason: compliant
      ? undefined
      : `A single gender holds more than 2/3 of the ${totalElectedSeats} elected seats (max allowed: ${maxAllowed}).`,
  };
}

/**
 * Derives a committee member's lifecycle status relative to today.
 * Mirrors Engineering Scope §7.1 / §7.3.
 */
function deriveElectionLifecycleStatus(reelectionDueDate, now = new Date()) {
  const due = new Date(reelectionDueDate).getTime();
  const nowMs = now.getTime();

  if (nowMs > due) return "TERM_EXPIRED";
  if (due - nowMs <= NINETY_DAYS_MS) return "TERM_EXPIRING";
  return "UPCOMING";
}

/**
 * Computes reelection_due_date from an election_date and term length (years).
 */
function computeReelectionDueDate(electionDate, termLengthYears = 3) {
  const d = new Date(electionDate);
  d.setFullYear(d.getFullYear() + termLengthYears);
  return d;
}

/**
 * Rolls up a committee's overall status from its members' individual
 * lifecycle status plus the 1/3 rule outcome. Term-expiry takes precedence
 * for operational urgency; compliance is reported separately by callers.
 */
function deriveCommitteeStatus(members, now = new Date()) {
  const serving = members.filter((m) => isServing(m, now));
  // Everyone has retired: nobody holds a mandate, which is as serious as an
  // expired term.
  if (members.length > 0 && serving.length === 0) return "TERM_EXPIRED";
  const statuses = serving.map((m) => deriveElectionLifecycleStatus(m.reelectionDueDate, now));
  if (statuses.includes("TERM_EXPIRED")) return "TERM_EXPIRED";
  if (statuses.includes("TERM_EXPIRING")) return "TERM_EXPIRING";

  const rule = checkOneThirdRule(serving, now);
  return rule.compliant ? "COMPLIANT" : "NON_COMPLIANT";
}

/**
 * Several submissions of the same kind of committee can exist (each save adds
 * a new one). Only the most recent per type is the committee in force, so only
 * that one is shown as current and scored. Older ones are kept as history.
 */
function latestPerType(committees) {
  const byType = new Map();
  for (const c of committees) {
    const best = byType.get(c.committeeType);
    if (!best || new Date(c.createdAt).getTime() > new Date(best.createdAt).getTime()) byType.set(c.committeeType, c);
  }
  return committees.filter((c) => byType.get(c.committeeType) === c);
}

// Term expiry depends on today's date, so the status stored when a committee
// was saved goes stale. Recompute it on every read, and mark which committee
// of each type is the one in force (older ones are kept as history).
function withLiveStatus(committees, now = new Date()) {
  const current = new Set(latestPerType(committees));
  return committees.map((c) => ({ ...c, status: deriveCommitteeStatus(c.members, now), current: current.has(c) }));
}

// --- Supervisory Board ---------------------------------------------------
// Co-operative Societies Rules 2004, rule 28(1): three members, each elected
// for three years, one retiring annually.
const BOARD_TERM_YEARS = 3;
const BOARD_POSITIONS = ["CHAIRMAN", "HONORARY_SECRETARY", "MEMBER"];
const BOARD_POSITION_LABELS = { CHAIRMAN: "Chairman", HONORARY_SECRETARY: "Honorary Secretary", MEMBER: "Member" };

// SERVING | TERM_EXPIRING (within 90 days) | TERM_EXPIRED (3 years since
// appointment, no retirement recorded: re-election is due) | RETIRED
function boardMemberStatus(member, now = new Date()) {
  if (!isServing(member, now)) return "RETIRED";
  const due = computeReelectionDueDate(member.appointmentDate, BOARD_TERM_YEARS);
  const life = deriveElectionLifecycleStatus(due, now);
  return life === "UPCOMING" ? "SERVING" : life;
}

module.exports = {
  isServing,
  latestPerType,
  withLiveStatus,
  BOARD_TERM_YEARS,
  BOARD_POSITIONS,
  BOARD_POSITION_LABELS,
  boardMemberStatus,
  ELECTED_MANAGEMENT_ROLES,
  checkOneThirdRule,
  deriveElectionLifecycleStatus,
  computeReelectionDueDate,
  deriveCommitteeStatus,
};

const { httpError } = require("./geography");

/**
 * Reporting lines for county and cooperative staff.
 *
 * Lower number = more senior. A person must report to someone MORE senior
 * than themselves, so the chain always runs upward to the County Director.
 * The one exception is OTHER_STAFF (positions such as Accountant, Clerk or
 * Store-keeper), who may also report to another OTHER_STAFF member, e.g. a
 * clerk to the accountant.
 */
const RANK = {
  NATIONAL_ADMIN: 0,
  DIRECTOR: 1,
  SUBCOUNTY_OFFICER: 2,
  FIELD_OFFICER: 3,
  COOPERATIVE_MANAGER: 3,
  OTHER_STAFF: 4,
};

const ROLE_LABELS = {
  NATIONAL_ADMIN: "National Admin",
  DIRECTOR: "County Director",
  SUBCOUNTY_OFFICER: "Sub-County Officer",
  FIELD_OFFICER: "Field Officer",
  COOPERATIVE_MANAGER: "Cooperative Manager",
  OTHER_STAFF: "Other",
};

function mayReportTo(subordinateRole, supervisorRole) {
  if (!(subordinateRole in RANK) || !(supervisorRole in RANK)) return false;
  if (subordinateRole === "OTHER_STAFF" && supervisorRole === "OTHER_STAFF") return true;
  return RANK[supervisorRole] < RANK[subordinateRole];
}

/**
 * Throws a clear 4xx unless `supervisorId` is a valid line manager for the
 * person described by `subordinate` ({ id?, role, countyId }).
 *  - must exist and be active
 *  - must be in the same county (a National Admin has no county, so nobody
 *    reports to one through this screen)
 *  - must be more senior (see mayReportTo)
 *  - must not be the person themselves or someone who reports (directly or
 *    through others) to them, which would make a loop
 */
async function assertValidSupervisor(prisma, supervisorId, subordinate) {
  const sup = await prisma.user.findUnique({ where: { id: supervisorId } });
  if (!sup) throw httpError(400, "The person chosen as 'reports to' was not found");
  if (!sup.active) throw httpError(400, `${sup.fullName} is deactivated and can't be a line manager. Choose someone active.`);
  if (subordinate.id && sup.id === subordinate.id) throw httpError(400, "Nobody can report to themselves");
  if (sup.countyId !== subordinate.countyId) {
    throw httpError(400, `${sup.fullName} is not in this county. Choose a line manager from the same county.`);
  }
  if (!mayReportTo(subordinate.role, sup.role)) {
    throw httpError(
      400,
      `A ${ROLE_LABELS[subordinate.role]} can't report to a ${ROLE_LABELS[sup.role]}. Choose someone more senior in the same county${subordinate.role === "OTHER_STAFF" ? "" : " (the chain runs up to the County Director)"}.`
    );
  }
  if (subordinate.id) {
    let cursor = sup;
    for (let i = 0; i < 50 && cursor; i++) {
      if (cursor.id === subordinate.id) throw httpError(400, "That would create a reporting loop");
      cursor = cursor.reportsToId ? await prisma.user.findUnique({ where: { id: cursor.reportsToId } }) : null;
    }
  }
  return sup;
}

module.exports = { RANK, ROLE_LABELS, mayReportTo, assertValidSupervisor };

/**
 * Default module permissions for each staff role.
 *
 * requirePermission() lets NATIONAL_ADMIN and DIRECTOR through unconditionally,
 * but every other role needs an explicit Permission row per module or it gets
 * a 403 on nearly every page. Accounts created from the Staff & Access page
 * used to get NO rows at all, so a Sub-County Officer or Cooperative Manager
 * could log in and then be blocked everywhere. Every account-creation path
 * (Staff & Access, open signup, the pilot seed, and the backfill script) now
 * uses this one table, so they can't drift apart again.
 *
 * Director-only actions (approving documents, overriding governance,
 * approving agrovet shops, reimbursing shops, managing staff) stay protected
 * separately by requireRole(), so these defaults never grant sign-off powers.
 */
const DEFAULT_PERMISSIONS = {
  // County oversight below the Director: reviews documents and works with
  // cooperatives across their area, so view + edit on all three modules.
  SUBCOUNTY_OFFICER: [
    { module: "cooperatives", canView: true, canEdit: true },
    { module: "documents", canView: true, canEdit: true },
    { module: "governance", canView: true, canEdit: true },
  ],
  // Field staff: read cooperatives and governance, upload/handle documents.
  FIELD_OFFICER: [
    { module: "cooperatives", canView: true, canEdit: false },
    { module: "documents", canView: true, canEdit: true },
    { module: "governance", canView: true, canEdit: false },
  ],
  // Runs one cooperative day to day (access is further limited to the
  // cooperative they manage by requireCooperativeAccess).
  COOPERATIVE_MANAGER: [
    { module: "cooperatives", canView: true, canEdit: true },
    { module: "documents", canView: true, canEdit: true },
    { module: "governance", canView: true, canEdit: true },
  ],
  // Bypass requirePermission entirely; rows would be ignored.
  DIRECTOR: [],
  NATIONAL_ADMIN: [],
};

function defaultPermissionsForRole(role) {
  return (DEFAULT_PERMISSIONS[role] || []).map((p) => ({ ...p }));
}

module.exports = { DEFAULT_PERMISSIONS, defaultPermissionsForRole };

// Which sign-in door the current staff-app session came through. A
// Cooperative Manager and county staff share the same workspace screens, but
// each must be sent back to THEIR OWN sign-in page on sign-out or when a
// session expires, never the other's.
const KEY = "embu_portal";

export function setSessionPortal(portal) {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, portal);
}

export function sessionLoginPath() {
  if (typeof window === "undefined") return "/login";
  return window.localStorage.getItem(KEY) === "cooperative" ? "/cooperative/login" : "/login";
}

// Where a Cooperative Manager lands after signing in: straight into their
// cooperative if they run exactly one, otherwise the (already scoped) list.
export function cooperativeHome(user) {
  const coops = user?.managedCoops || [];
  return coops.length === 1 ? `/cooperatives/${coops[0].id}` : "/cooperatives";
}

/**
 * Turns an axios error into a message that actually tells the user what
 * went wrong — critically, distinguishing "the server rejected your
 * credentials" from "the browser never reached the server at all" (wrong
 * API URL, CORS misconfiguration, backend down). Without this distinction,
 * both cases look identical to the user, and a connectivity problem gets
 * misread as a wrong password every time — see RENDER_DEPLOYMENT.md's
 * troubleshooting section for the deployment checks this points to.
 */
export function describeAuthError(err, fallback) {
  if (err?.response) {
    // The server responded — this is a real answer (401, 400, etc). A 404
    // here specifically means the request reached A server but not OUR
    // routes — almost always a stale/misconfigured API base URL rather
    // than anything wrong with the credentials themselves.
    if (err.response.status === 404) {
      return "The login service wasn't found at the configured address. This is a deployment configuration issue, not a wrong password — please contact your system administrator.";
    }
    return err.response.data?.error || fallback;
  }
  if (err?.request) {
    // A request went out but no response ever came back.
    return "Could not reach the server. This isn't a wrong password — it usually means the app's API address is misconfigured. Please contact your system administrator.";
  }
  return err?.message || fallback;
}

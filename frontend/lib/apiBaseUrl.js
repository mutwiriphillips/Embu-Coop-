/**
 * Every backend route lives under /api/... (see backend/src/index.js) — if
 * NEXT_PUBLIC_API_BASE_URL is set to the bare backend URL without that
 * suffix, every request lands one path segment too shallow and falls
 * through to the backend's catch-all 404 handler, which returns exactly
 * {"error": "Not found"}. That's a real, easy-to-make deployment mistake
 * (it happened on this project's own Render setup), so rather than relying
 * on the env var always being typed exactly right, this normalizes it:
 * trailing slashes are stripped, and "/api" is appended if it isn't already
 * there. This makes the app work correctly whether the configured value is
 * "https://backend.onrender.com", ".../api", or ".../api/".
 */
export function resolveApiBaseUrl(rawValue) {
  const fallback = "http://localhost:4000/api";
  if (!rawValue) return fallback;

  const trimmed = rawValue.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

/** @type {import('next').NextConfig} */

// Where the browser is allowed to talk to. The API address is read at build
// time from NEXT_PUBLIC_API_BASE_URL (same value the app uses).
const apiOrigin = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000").origin; } catch { return ""; }
})();
const dev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // Next.js writes small inline scripts into every page, so 'unsafe-inline' is
  // required here. Everything else (no outside scripts, no framing, no plugins,
  // forms only to ourselves) is locked down.
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // The landing page still loads three pictures from Wikimedia; host them
  // ourselves and drop these two entries before the .go.ke launch.
  "img-src 'self' data: blob: https://commons.wikimedia.org https://upload.wikimedia.org",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin}${dev ? " ws:" : ""}`,
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework/version.
  poweredByHeader: false,
  // The image optimiser endpoint has had remote-code and denial-of-service
  // advisories and this app doesn't use next/image, so switch it off.
  images: { unoptimized: true },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Pages that show personal data must not be cached by shared caches.
      { source: "/((?!_next/static|_next/image|favicon.ico).*)", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

module.exports = nextConfig;

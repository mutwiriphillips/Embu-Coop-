# Smoke checklist: moving to embu-cooperatives.go.ke

Tick every box in order. Anything marked **YOU** can only be done by you (registrar, DNS, Render, GitHub); I could not reach those from here. Keep the old Render URLs working until the end, so you can roll back by changing two settings.

Write down: Backend URL `__________` Frontend URL `https://embu-cooperatives.go.ke` (suggested API address: `https://api.embu-cooperatives.go.ke`)

## A. Before you touch DNS
- [ ] **YOU** Confirm who administers `.go.ke` names for the county (the Kenya ICT Authority / government registrar process) and that `embu-cooperatives.go.ke` is registered to the county, with at least two named contacts.
- [ ] Take a backup: National Admin Dashboard → *Download backup*. Store it encrypted, off Render. Check the file is more than a few KB.
- [ ] Render database is on a **paid plan** with backups, and its access list is restricted.
- [ ] Backend env on Render: `ALLOW_OPEN_SIGNUP=false`, `NODE_ENV=production`, `JWT_SECRET` 32+ characters, `TRUST_PROXY_HOPS=1`, `SECURITY_HARDENING` = `true` **at full launch** (`false` while the pilot passwords are still in use).
- [ ] **Full launch only** (after `SECURITY_HARDENING=true`): every National Admin and Director has enrolled two-step sign-in and holds their recovery codes; another National Admin can reset them. Every account has replaced `Pilot2026!` (sign-in forces it); `PILOT-0001` and `AGRO-0001` are deactivated.
- [ ] The build command no longer contains `--accept-data-loss` (and, if you did the baseline, uses `prisma migrate deploy`).
- [ ] `coat-of-arms.svg` and `county-map.svg` are in `frontend/public/images/`, and you have the right to use all five photographs.

## B. Attach the domain on Render (**YOU**)
- [ ] Frontend service → Settings → Custom Domains → add `embu-cooperatives.go.ke` (and `www.` if wanted). Backend service → add `api.embu-cooperatives.go.ke`.
- [ ] At the DNS host, add exactly the records Render shows (a CNAME for sub-domains; A/ALIAS for the apex). Remove any conflicting A/AAAA records.
- [ ] Wait for Render to show each domain **Verified** and its certificate **Issued**. Do not continue until both show a certificate.
- [ ] `https://embu-cooperatives.go.ke` opens with a valid padlock and no warning; `http://` redirects to `https://`.
- [ ] Optional DNS hardening: a CAA record naming the certificate issuer; DNSSEC if your registrar supports it.

## C. Switch the settings (this order matters)
- [ ] Backend → Environment: `FRONTEND_ORIGIN` = `https://embu-cooperatives.go.ke` (exact, no trailing slash). Redeploy backend.
- [ ] Frontend → Environment: `NEXT_PUBLIC_API_BASE_URL` = `https://api.embu-cooperatives.go.ke/api`. **Rebuild** the frontend (this value is baked in at build time; a restart is not enough).
- [ ] `https://api.embu-cooperatives.go.ke/api/health` returns `{"status":"ok",...}`.
- [ ] Only the new site origin is allowed by CORS: in a browser console on any other site, a request to the API is blocked.

## D. Security headers and TLS (open the site, DevTools → Network → first request)
- [ ] `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` and `Content-Security-Policy` are present.
- [ ] The CSP `connect-src` lists the new API address and no other site; DevTools Console shows **no** "Refused to…" messages on the landing page, each login page and the dashboard.
- [ ] Optional: run the site through an SSL/TLS test (e.g. SSL Labs) and expect grade A or better.
- [ ] The site cannot be placed in an `<iframe>` on another page.

## E. Functional smoke (use real accounts, not published ones)
- [ ] Landing page: all five photographs load on a phone and a laptop; no broken-image text; coat of arms and map load.
- [ ] Staff login → code step → dashboard. Wrong code is refused; a recovery code works once; the same code a second time does not.
- [ ] Sign-in rate limit: 9 wrong passwords for one email in a row get a "too many attempts" message.
- [ ] Farmer login, cooperative-manager login, agrovet login each reach their own portal and **cannot** open another portal's pages.
- [ ] Staff-issued temporary password for a test farmer forces a change; old password stops working.
- [ ] Cooperative page loads members, contributions and a document download (confirms files and API work on the new domain).
- [ ] Sign out, then press Back: no protected page is shown from cache.
- [ ] A browser that opened the **old** Render address still works (or is redirected); decide how long to keep it.

## F. Operations
- [ ] Nightly backup workflow: it connects to the database directly (`BACKUP_DATABASE_URL`), so the domain change does not affect it; run it manually once and confirm a file is produced; test a restore into a throw-away database (never the live one).
- [ ] GitHub repository **private**; secret scanning and push protection on; the three history-check commands in SECURITY_ASSESSMENT.md section 3 return nothing.
- [ ] Uptime check on `/api/health` and an alert to a named person.
- [ ] A `security.txt` with a reporting contact is published at `/.well-known/security.txt`.

## G. Compliance items (not technical, but needed before real farmer data)
- [ ] ODPC registration, a named data protection officer, a DPIA, and a decision on hosting location and cross-border transfer.
- [ ] Breach-response procedure (72-hour notification) and a retention schedule agreed.
- [ ] `/privacy` page reviewed by counsel.
- [ ] Independent penetration test booked; findings fixed and re-tested.

## H. Rollback (if something fails after section C)
1. Backend `FRONTEND_ORIGIN` back to the old Render frontend URL; redeploy.
2. Frontend `NEXT_PUBLIC_API_BASE_URL` back to the old backend URL; rebuild.
3. Keep the custom domains attached but unused until fixed. No data changes are involved, so nothing needs restoring.

## I. Full-launch security switch (when pilot passwords are retired)
- [ ] Backend → Environment: `SECURITY_HARDENING` = `true`; redeploy.
- [ ] Sign in with `Pilot2026!` as a staff account: you are sent to *Change password* and the published password is refused as the new one.
- [ ] National Admin and Director are then sent to *Security*: scan the QR, enter the code, save the 8 recovery codes. A later sign-in asks for a code.
- [ ] Farmer (`PILOT-0001`) and agrovet (`AGRO-0001`) logins are forced to change too; then deactivate both test accounts.
- [ ] Rollback if someone is locked out: set `SECURITY_HARDENING=false`, or run `npm run reset:mfa -- <email>` for one person.

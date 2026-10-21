# Security Assessment: National Cooperative Management & Governance System

> **Status (decision of 21 Oct 2026): hardening on hold for the pilot.** `SECURITY_HARDENING=false`: the published pilot password keeps working for all accounts; the forced password change (findings 1 and 16), two-step sign-in (15) and strict password rules are built and tested but **switched off**. Findings 1, 15 and 16 therefore remain **open in practice** until `SECURITY_HARDENING=true` is set at full launch. Risk while on hold: anyone who has read the repository or docs can sign in to the seeded accounts, including National Admin (who can download a full backup). Mitigations that stay on: keep the repository private, keep the site URL unpublished, and do not load real farmer data until the switch is on. Everything else in this document (headers, rate limits, session handling, open sign-up off, Next 15, no data-loss deploys) is unaffected.


Assessed 14 October 2026 · Pilot: `embu-coop-frontend-bs4b.onrender.com` · Target: `embu-cooperatives.go.ke`

## 1. Scope, method and limits (read first)

**Done:** a read-through of the whole code base (auth, access control, uploads, input handling, config, dependencies), a dependency vulnerability audit (`npm audit`), a scan of the project files for secrets and default passwords, a passive look at the public login pages, and automated tests of every fix (see section 6).

**Not done, and why this is not a guarantee:**
- No one can honestly certify "no possibility of a threat". This is a code and configuration review, not a penetration test.
- My tools could not reach the live site from the command line, so I could not read the live response headers or probe the live API. I confirmed the headers by building the app and inspecting them locally.
- I cannot see your Render dashboard (environment variables, database settings, which accounts exist) or your GitHub repository (visibility, history). Items that depend on those are marked **YOU CHECK**.
- I did not attack the live pilot (no password guessing, fuzzing or load).

Before go-live on the `.go.ke` domain, have an independent party run an authorised penetration test.

## 2. Findings

Severity is the risk if left alone. "Fixed in code" means the change is in this version and takes effect when you deploy it.

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **Critical** | The seeded National Admin (`admin@cooperatives.go.ke`) and other pilot accounts use the password `Pilot2026!`, which is written in the README, deployment guide and checklist. The app had **no way to change a password at all**. Anyone who has read the docs could sign in as National Admin on a seeded database and, with the new backup feature, download every record. | **Fixed in code**: change-password page, forced change on first sign-in with the published password, admin password reset, sessions ended on change. **YOU:** deploy, sign in as each account and choose a new password (see 5). |
| 2 | **High** | Open self-signup was **on** (`ALLOW_OPEN_SIGNUP=true`). Any visitor could create a Field Officer account in any county and read cooperatives, committee members' IDs and phone numbers, and documents. The login page advertises it ("Test run: create an account"). | **Fixed in config** (`render.yaml` now `false`). **YOU:** set `ALLOW_OPEN_SIGNUP` to `false` in the Render dashboard now, and review Staff & Access for accounts you did not create. |
| 3 | **High** | Rate limiting did not work behind Render's proxy (every visitor shared one counter, so it neither stopped an attacker nor protected users, and 300 requests could lock everyone out). No sign-in brute-force protection. | **Fixed**: proxy trusted, 8 failed attempts per address+account per 15 minutes, 40 per address, limits on sign-up and password change. |
| 4 | **High** | Next.js 14.2.35 (the last 14.x release) has published advisories that are fixed only in Next 15.5.24+ / 16. The two critical ones concern Windows hosting and the image optimiser. | **Fixed**: upgraded to Next 15.5.28 + React 19 (PostCSS pinned to a patched release). `npm audit --omit=dev` reports 0 vulnerabilities. Browser-tested (sign-in, forced password change, two-step sign-in, landing page, CSP) with no errors. Re-run `npm audit` before each release. |
| 5 | Medium | A farmer account could be claimed by anyone who knew the member's National ID (not a secret) before the member registered, and the error messages revealed who is a member. | **Fixed**: the phone number must also match the cooperative's record; wrong ID and wrong phone give the identical answer. Members with no phone on file cannot self-register until the manager adds it. |
| 6 | Medium | Backend packages with advisories (express, body-parser, qs, morgan, proxy-addr: IP spoofing). | **Fixed** (updated). Residual: `pdfjs-dist` 3.x advisory (script execution when *opening* a malicious PDF in a browser viewer). Our use is server-side text extraction with eval disabled, so it is low; upgrade later. `canvas`/`tar` (install-time only) are no longer installed (`--omit=optional`). |
| 7 | Medium | The website sent no security headers (could be framed by another site, no Content-Security-Policy, no HSTS). | **Fixed**: CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS, no-store for pages. Verified in a browser with no violations. |
| 8 | Medium | Unexpected server errors returned internal error text. | **Fixed**: generic message in production. |
| 9 | Medium | Sign-in tokens: algorithm not pinned; weak signing secret not rejected; tokens survived a password change. | **Fixed**: HS256 only, the server refuses to start in production with a secret under 32 characters, a password change/reset ends all older sessions. |
| 10 | Medium | Tokens are stored in the browser's `localStorage`, so a script-injection flaw would expose them. | **Accepted for now.** No unsafe HTML rendering exists in the code and the CSP blocks outside scripts, but it still allows inline scripts (Next requirement). **Recommended:** HttpOnly cookies with CSRF protection. |
| 11 | Medium | Database: free Render Postgres expires after 30 days with no recovery; external database access is open to any IP by default. The build used `prisma db push --accept-data-loss`, which would silently drop data on a destructive change. | **Partly fixed**: `--accept-data-loss` is removed, so a destructive change now fails the build instead of deleting. **YOU:** paid database plan with backups; restrict the database's allowed IPs (see 5); generate and commit the baseline migration on a machine with internet (steps in RENDER_DEPLOYMENT.md; Prisma's engine could not be downloaded here, so I did not hand-write unverifiable SQL). Backup tooling is built. |
| 12 | Low | Public pages list cooperative names and let anyone test whether a registration number exists (needed for the portals). | **Accepted**; covered by the rate limits. |
| 13 | Low | The coat of arms and county map on the landing page load from Wikimedia. | **Reduced**: the five photographs are now served from the site itself. **Open:** add `coat-of-arms.svg` and `county-map.svg` to `frontend/public/images/`, then remove the two Wikimedia entries from the CSP in `next.config.js`. |
| 14 | Low | `docker-compose.yml` published the dev database (weak password) on all network interfaces. | **Fixed**: bound to localhost. |
| 15 | Gap | No multi-factor authentication. For National Admin and Director accounts this is the single most valuable missing control. | **Fixed**: authenticator-app (TOTP) sign-in is required for National Admin and Director (`MFA_REQUIRED_ROLES`), optional for others. Secrets are encrypted, codes cannot be replayed, 8 one-time recovery codes, admin reset (`Reset 2-step`) and a break-glass command (`npm run reset:mfa -- <email>`). Cooperative managers are not required to use it. **YOU:** each admin/director enrols at next sign-in; store recovery codes safely. |
| 16 | Gap | Members and agrovet accounts had no password change or reset. The seeded `PILOT-0001` and `AGRO-0001` use the published password. | **Fixed in code**: both portals have Change password; signing in with the published password forces a change; registration requires a 10+ character password; staff (cooperative manager, field officer, sub-county officer, director, national admin within their area; agrovets by sub-county officer, director, national admin) can issue a one-time temporary password that must be changed at first use. **Not built:** self-service "forgot password", which needs an SMS or email provider. **YOU:** still deactivate `PILOT-0001` and `AGRO-0001` before real use. |

### What is already sound
Prisma is used for every query (no raw SQL found, so no SQL injection path); every request body is validated; passwords are bcrypt-hashed; the four sign-in types (staff, cooperative, farmer, agrovet) cannot be swapped for each other; county and sub-county scoping is checked on the server for each record; uploads are identified by file contents, size-capped and stored in the database, and downloads are access-checked, `no-store` and `nosniff`; the audit log records actions without storing ID or phone numbers; CORS allows a single origin; no secrets are present in the code.

## 3. Secrets and GitHub

- `.env` and `.env.local` are in `.gitignore`. The only env files in the project are `backend/.env.example` and `frontend/.env.example`, which hold placeholders (`replace-with-a-long-random-secret`) and the local Docker defaults, not production values.
- `render.yaml` contains no secrets: `JWT_SECRET` is generated by Render and `DATABASE_URL` comes from the database. Real values exist only in the Render dashboard.
- My scan of the project found no private keys, tokens or connection strings with real credentials.
- **What I cannot see: your git history.** This working copy is not a git repository. Run these in your clone:
  ```
  git ls-files | grep -iE '(^|/)\.env($|\.)' | grep -v '\.example$'    # expect: nothing
  git log --all --full-history --oneline -- '*.env' '**/.env'          # expect: nothing
  npx gitleaks detect --source . --log-opts="--all"                    # expect: no leaks
  ```
- **YOU CHECK on GitHub:** the repository is **Private** (the docs publish test credentials and the admin email); turn on *Secret scanning* and *Push protection* (Settings → Code security); require two-factor sign-in for everyone with access.
- If any of those commands ever shows a secret, or the repository was ever public: treat the secret as exposed. Rotate `JWT_SECRET` (everyone signs in again), reset the database password in Render, and change every account password.
- The zip files shared in this chat contain no `.env` file or secrets.

## 4. Data protection (Kenya Data Protection Act, 2019): points to confirm
These are for you and counsel to verify; I am not giving legal advice.
- Registration of the controller/processor with the ODPC, and a data protection officer.
- A Data Protection Impact Assessment: the system holds National IDs, phone numbers and member financial data at scale.
- Where the data is hosted. Render's regions are outside Kenya; check the cross-border transfer rules and whether any processing falls under the localisation requirement in the Data Protection (General) Regulations, 2021, and what the State Department / ICT Authority require for a `.go.ke` system.
- A breach procedure that meets the 72-hour notification duty, a retention schedule, and a process for access/correction/deletion requests.
- The system's own privacy page (`/privacy`) should be reviewed against the above.

## 5. Actions, in order

**Do today (live pilot)**
1. Render → backend service → Environment: set `ALLOW_OPEN_SIGNUP` = `false`. Redeploy.
2. Deploy this version. Sign in to each seeded staff account; the app will force a new password. Use a password manager.
3. Staff & Access: check there are no accounts you do not recognise; deactivate extras.
4. Deactivate/delete the test farmer (`PILOT-0001`) and agrovet (`AGRO-0001`) accounts.
5. GitHub: confirm the repo is private; enable secret scanning and push protection; run the three commands in section 3.
6. Render database: upgrade to a paid plan (backups); under *Access control*, restrict inbound IPs if you do not need outside access. (The nightly GitHub backup needs outside access: weigh it, or take backups from the Dashboard button instead.)

**Before `embu-cooperatives.go.ke` goes live**
7. ~~Multi-factor authentication~~ done. Enrol every admin and director, and keep recovery codes offline.
8. ~~Upgrade Next.js~~ done.
9. Reviewed migrations (partly done): `--accept-data-loss` is REMOVED from the deploy (destructive changes now fail the build). Generating the baseline migration needs Prisma engines, which could not be downloaded here; steps are in RENDER_DEPLOYMENT.md.
10. Self-host the coat of arms and county map (photographs are already local); confirm you hold the rights to the five photographs; add a `security.txt` with a contact for reporting problems.
11. Independent penetration test; fix findings; keep the report.
12. Complete the section 4 items.

## 6. Verification performed
- 43 automated checks of the first round of changes, 53 for two-step sign-in (including the RFC 6238 test vectors) and 49 for farmer/agrovet passwords (forced change, session revocation, reset scope by county and role, no password in logs) (forced change, session revocation, reset rules, lock-out per visitor, member claim, token tampering, error masking, headers).
- Existing suites still pass: governance 52, credit 47, staff 58, registration 13, suspension 17, import 43, geography 54, integration 142, backup 13 and 75.
- A real browser run: sign in with the published password → forced to the change page → weak and published passwords refused → new password accepted → app usable, no CSP violations.
- Real browser runs on Next 15 / React 19: forced password change (staff, farmer, agrovet), two-step set-up, code login, recovery-code login, staff issuing temporary passwords, and layout at phone and laptop widths, with no CSP violations or page errors.
- **Not verified here:** anything on your live Render service, the live database, GitHub settings, DNS/TLS for the new domain, and a real authenticator app scanning the QR code (the code generator was checked against the RFC test vectors instead).

## Addendum: Staff Directory
New personal data (names, phones, emails, P/No, and a restricted Remarks field that may hold disability information). The whole module and the Excel sheet are limited to the Director (own county) and National Admin; the sheet download is sent `no-store` and audited (row counts only). Uploads are validated in full before anything is written, accept only .xlsx up to 2 MB, and never contain passwords. Audit logs never store phone/ID/remarks values. The downloaded file itself is outside the system's control: keep it private and delete copies. The source spreadsheet contains plaintext system passwords for some staff: these were not imported; remove or rotate them and do not circulate that file.

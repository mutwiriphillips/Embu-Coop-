# Deploying the Pilot Test Run on Render

This gets you a live, shareable instance with **1 cooperative, 1 employee (Field
Officer), 1 Cooperative Manager**, plus a Director account, and open self-signup
so testers can create their own accounts with any email address.

## 1. Push to GitHub

```bash
cd embu-coop-system
git init
git add .
git commit -m "Pilot deployment scaffold"
git branch -M main
git remote add origin https://github.com/<your-org>/embu-coop-system.git
git push -u origin main
```

## 2. Deploy the Blueprint

1. In the [Render Dashboard](https://dashboard.render.com), click **New +** → **Blueprint**.
2. Connect the GitHub repo you just pushed.
3. Render detects `render.yaml` at the repo root and proposes three resources:
   - `embu-coop-db` — free PostgreSQL instance
   - `embu-coop-backend` — Node/Express API
   - `embu-coop-frontend` — Next.js app
4. Click **Apply**. First deploy takes ~5–10 minutes (installs deps, then
   `npx prisma db push` creates the tables directly from `schema.prisma`).

> **Why `db push` and not `migrate deploy`?** This repo doesn't have a
> `prisma/migrations/` folder — generating one requires running
> `prisma migrate dev` against a real database once, which wasn't possible
> in the environment this scaffold was built in. `db push` syncs the schema
> straight to the database with no migration history, which is the right
> tool for a pilot. Before treating this as a long-lived production system,
> run `npx prisma migrate dev --name init` against a real dev database once
> to generate proper migration files, commit them, and switch the build
> command back to `migrate deploy` for safer, reviewable schema changes.

## 3. Fix the cross-service URLs

Render assigns each service a URL like `https://embu-coop-backend-xxxx.onrender.com`
(the `xxxx` suffix only appears if the plain name was taken). After the first
deploy:

1. Copy the **actual** backend URL from its Render page.
2. On `embu-coop-frontend` → **Environment**, set
   `NEXT_PUBLIC_API_BASE_URL` to `https://<actual-backend-url>/api`.
3. Copy the **actual** frontend URL.
4. On `embu-coop-backend` → **Environment**, set `FRONTEND_ORIGIN` to the
   actual frontend URL (needed for CORS).
5. Both services will auto-redeploy after the env var change.

## 4. Seed the counties, then the pilot accounts

> **⚠ EMBU IS LIVE. Do not run `npm run reset:all` on the production
> database.** It runs `prisma db push --force-reset`, which drops every
> table, including real farmer, cooperative, and staff records. It is now
> guarded and refuses to run unless you type an explicit unlock phrase
> (see `prisma/reset-guard.js`). Only ever unlock it on a throwaway test
> database.

**To add the pilot/test accounts, including the agrovet account, to the
live database, run this. It is safe on live data:**

```bash
npm run seed:pilot
```

It looks up every record first and only creates what's missing. It never
updates, deletes, or resets anything, so running it twice changes nothing
the second time.

**Schema changes on a live database:** the Render build runs
`prisma db push` (no `--accept-data-loss`). Additive changes (new tables, new
optional columns, new columns with a default) apply without touching rows.
If a change would drop or rewrite data, Prisma refuses and the **build fails
instead of silently deleting**; the old version keeps running. Then: take a
backup, and apply that change deliberately (see below).

**Moving to reviewed migrations before go-live (one-time, needs internet on your laptop):**
Prisma's migration engine could not be downloaded in the environment this was built in,
so the baseline SQL was NOT generated here (hand-writing it would be unverified).
Do this once on a machine with normal internet access:
```bash
cd backend && npm install
mkdir -p prisma/migrations/0_baseline
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/0_baseline/migration.sql
printf 'provider = "postgresql"\n' > prisma/migrations/migration_lock.toml
# Tell the LIVE database the baseline is already applied (does not run the SQL):
DATABASE_URL="<live external url>" npx prisma migrate resolve --applied 0_baseline
```
Commit `prisma/migrations/`, then change the Render build command to
`npm install --omit=optional && npx prisma generate && npx prisma migrate deploy`.
From then on, schema changes are made with `npx prisma migrate dev --name what_changed`
locally, reviewed in the pull request as plain SQL, and applied by `migrate deploy`.

**Fresh, empty test database only:**
```bash
ALLOW_DB_RESET=I_UNDERSTAND_THIS_DELETES_ALL_DATA npm run reset:all
```

You should see (on a database that doesn't have them yet):
```
Pilot seed complete. All accounts share the password: Pilot2026!
  National Admin: admin@cooperatives.go.ke
  County Director (Embu): director@embu.go.ke
  Sub-County Officer (Embu): subcounty@embu.go.ke
  Employee (Field Officer): employee@embu.go.ke
  Manager: manager@embu.go.ke
  Cooperative: Kirimiri Coffee Growers Cooperative Society (EMB-PILOT-0001) — Embu County
  Member Portal login: National ID "PILOT-0001", password "Pilot2026!"
  Agrovet Portal login: National ID "AGRO-0001", password "Pilot2026!" (at /agrovet/login)
```

### Repairing staff accounts created before this fix

Staff created on the Staff & Access page used to get no module permissions,
and managers weren't linked to a cooperative. So a Sub-County Officer or
Cooperative Manager could log in, then hit "Missing 'canView' permission"
or "You do not manage this cooperative" on every page. New accounts are
fixed automatically. For accounts already on the live database, run once:

```bash
npm run fix:staff-access
```

It adds role-default permissions only to accounts that have none, never
changes permissions a Director set, and lists any manager who isn't linked
to a cooperative (assign them on Staff & Access). Safe to re-run.

### Cooperative Portal and agrovet registration (this release)

- **Cooperative Managers now sign in at `/cooperative/login`**, with their
  email or their cooperative's registration number. They get their own token
  type (`cooperative`), which the server only accepts for manager accounts;
  staff tokens no longer work for managers, and cooperative tokens never
  work for staff. If a manager types into the staff login out of habit, the
  page hands them over to the Cooperative Portal automatically.
- **Managers who were signed in before this deploy will be signed out once**
  (their old session used the staff token type) and simply sign in again.
- **Sub-County Officers can register agrovet shops** on the Agrovet Shops
  page. These go straight to the Director for sign-off; nothing trades until
  approved.
- **Schema:** this release adds one nullable column (`AgrovetShop.registeredById`).
  The normal Render build's `prisma db push` adds it without touching
  existing data. Do **not** use `reset:all`.

### Mwea Sub-County, Embu (this release)

**Nothing to run.** No database schema change. On start-up the backend adds
Mwea as Embu's fifth sub-county and moves **Mwea Ward** and **Makima Ward** into
it from Mbeere South. Any cooperative, staff member or agrovet shop already
recorded in those two wards moves with them. In the backend Logs, look for
lines beginning `[geography]`:

```
[geography] added 1 sub-counties and 0 wards
[geography] ward Mwea: Mbeere South -> Mwea
[geography] ward Makima: Mbeere South -> Mwea
[geography] Cooperative <name> (<reg no>) (ward Mwea): sub-county Mbeere South -> Mwea
[geography] review: Sub-County Officer <name> covers Mbeere South; Mwea is now its own sub-county
```

The last kind of line means a Mbeere South officer no longer sees Mwea's and
Makima's cooperatives. If they should still cover them, the Director
reassigns them on **Staff & Access** (or creates a Mwea officer). After a
restart the lines don't appear again, because there is nothing left to change.
Optional: `npm run geo:sync` in the Shell also links any old text-only record
typed as "Mbeere South / Mwea" or "Mbeere South / Makima" to Mwea.

### Sub-counties, wards and file uploads (previous release)

**After deploying, run once in the backend Shell:**

```bash
npm run geo:sync
```

It loads all sub-counties (290 constituencies plus Mwea, Embu) and 1,450 wards, then links existing
cooperatives, staff, and agrovet shops to them by matching the text they
already have. It changes no existing text and never overwrites a link
someone chose, and it lists anything it couldn't match so a Director can pick
from the dropdowns. Safe to run again at any time. (Counties also load their
own sub-counties and wards the first time anyone opens the dropdowns, so
nothing breaks if this is skipped, but the old records stay unlinked.)

**What changes for people:**
- Every form that records a location now uses **County → Sub-County → Ward**
  dropdowns. A Sub-County Officer **must** have a sub-county; they then see
  only that sub-county. Officers created before this release see their whole
  county until a Director assigns one (Staff & Access flags them in red with
  an "Assign" dropdown).
- The **Dashboard** has a drill-down: sub-county → ward → that ward's
  cooperatives.
- **Real uploads:** documents (PDF or a photo of the paper), AGM notices and
  minutes, agrovet shop photo and business permit, asset photos, and
  field-visit photos. Files are stored **in PostgreSQL**, because Render's
  web-service disk is wiped on every deploy. Limits: 10 MB per document,
  5 MB per photo. File types are checked from the file's content, not its
  name.
- **Database size:** uploads grow the database. Check the Postgres plan's
  storage on the Render dashboard as usage builds, and upgrade the plan before
  it fills.
- Documents recorded **before** this release have no file (the old screen
  never stored one). They're marked "No file stored"; re-upload any that
  matter.
- **Access tightened:** leave requests and field visits are now scoped to each
  county (and sub-county); the national county summary needs a National Admin
  sign-in; nobody approves their own leave or visit plan.

**Four ward names to confirm** (two independent sources disagree on the
name): Tana River / Bura "Bura" (or "Hirimani"), Mandera / Lafey "Libehia"
(or "Sala"), Laikipia West "Kinamba" (or "Githiga"), West Pokot / Kacheliba
"Kapckok" (or "Kapchok"). None are in the current eight pipeline counties.
They're listed in `backend/src/data/kenyaGeography.js` → `DISPUTED_WARDS`.

### All pilot / test logins (password `Pilot2026!` for every one)

| Role | Sign in at | Username field | Value |
|---|---|---|---|
| National Admin | `/login` | Email | `admin@cooperatives.go.ke` |
| County Director (Embu) | `/login` | Email | `director@embu.go.ke` |
| Sub-County Officer (Embu) | `/login` | Email | `subcounty@embu.go.ke` |
| Field Officer | `/login` | Email | `employee@embu.go.ke` |
| Cooperative Manager | `/cooperative/login` | Email **or** registration number | `manager@embu.go.ke` or `EMB-PILOT-0001` |
| Farmer (Member Portal) | `/member/login` | National ID | `PILOT-0001` |
| Agrovet shop owner | `/agrovet/login` | National ID | `AGRO-0001` |

Cooperative seeded: **Kirimiri Coffee Growers Cooperative Society** (`EMB-PILOT-0001`), Embu County.

The agrovet account belongs to **Runyenjes Agrovet Supplies (Pilot)**, an
already-APPROVED Embu shop with a six-item catalogue (DAP, CAN, maize seed,
manure, jembe, knapsack sprayer; illustrative prices). The farmer
`PILOT-0001` also has a **KES 10,000 input credit** ("Embu County Input
Subsidy (Pilot)"). Together these let you demo the whole agrovet flow
straight away: the agrovet looks up `PILOT-0001`, records a collection, the
farmer sees it in their Input Credits tab, and the Director reimburses the
shop from the Agrovet Shops page.

**Test accounts on a live system:** these accounts share a publicly
documented password. Before real farmers and shops rely on Embu, either
change these passwords or deactivate the accounts once demos are done.

**The farmer login is separate from staff, and uses a different field.** The
seeded farmer account signs in at `/member/login` with **National ID
`PILOT-0001`** and the same password (`Pilot2026!`) — not an email address.
This is a different table (`MemberAccount`) from staff (`User`), on a
completely separate auth system by design (see the README's Module 7
section) — seeding one does not seed the other, which is why `seed:pilot`
explicitly creates both.

### "Login doesn't work" — diagnose it in one command

Before changing anything, run this in the Shell tab:

```bash
npm run verify:seed
```

It queries the live database directly and tells you exactly what exists —
how many staff accounts, how many farmer accounts, and by name. This
immediately separates the two possible causes:

1. **The output says accounts are `0`** → the accounts don't exist yet.
   Run `npm run seed:pilot` (safe on live data) and try again. Do **not**
   run `reset:all` on the live Embu database.
2. **The output lists real accounts, but login still fails from the
   browser** → the database is fine and the problem is almost always one of:
   - **Wrong field for the farmer or agrovet.** The Member Portal and the
     Agrovet Portal both ask for a National ID, not an email: `PILOT-0001`
     and `AGRO-0001` respectively.
   - **`NEXT_PUBLIC_API_BASE_URL`** on `embu-coop-frontend` isn't the
     backend's actual Render URL (see Step 3 above) — if this is stale after
     a redeploy, every request from the browser silently goes nowhere useful.
     As of this update, the frontend tolerates a missing `/api` suffix or a
     trailing slash on this value automatically — but it still needs to
     point at the *correct backend URL*.
   - **`FRONTEND_ORIGIN`** on `embu-coop-backend` doesn't exactly match the
     frontend's actual Render URL — a mismatch here causes a CORS rejection
     that often shows up in the browser as a generic "Network Error" with no
     useful message on screen.
   - Open the browser's DevTools → Network tab, retry the login, and click
     the failed request — the real HTTP status and response body (401 vs. a
     CORS error vs. no response at all) tells you which of the two URL
     settings above is the one to fix.

### Seeing "Not found" specifically?

That exact message is the backend's own catch-all 404 handler responding —
which means the browser successfully reached your backend server, just at a
URL that doesn't match any real route. Every route lives under `/api/...`,
so this happens when `NEXT_PUBLIC_API_BASE_URL` points at the bare backend
root without that suffix. The frontend now normalizes this automatically
(`frontend/lib/apiBaseUrl.js` appends `/api` if it's missing and strips a
trailing slash), so redeploying the frontend after this update should
resolve it even if the env var itself is still set slightly wrong — but
it's worth correcting the env var to the full `.../api` form regardless, so
it's unambiguous on inspection later.

### Already deployed and hit `P2021: table does not exist`?

That means the tables were never created. On a brand-new, empty database
only, you can use the guarded `reset:all` (see above). On any database that
already holds real data, run `npx prisma db push` (which creates missing
tables without dropping existing ones), then `npm run seed:pilot`.

## 5. Open self-signup for other testers

`ALLOW_OPEN_SIGNUP=true` is already set in `render.yaml` for this pilot. Anyone
with the frontend URL can go to `/signup` and register as a Field Officer or
Cooperative Manager with **any email address**, picking any of the 47 counties
— no domain restriction, no admin approval. National Admin and County
Director accounts can never be created through self-signup, only by an
existing Director or National Admin. This is intentional for a fast test run.

**Before this goes anywhere near real County data:** set `ALLOW_OPEN_SIGNUP`
back to `false` in the backend's environment variables. Open signup with no
email verification is fine for a two-week pilot with disposable test data; it
is not an access-control model for production.

## 6. Known limitations of this pilot build

- **Free-tier Render services spin down after 15 minutes idle** and take
  ~30–60 seconds to wake on the next request — expect a slow first load
  after inactivity. Fine for a pilot; upgrade to a paid plan before a real
  demo day.
- **Free Postgres on Render expires after 30 days.** Export/back up data
  before then, or upgrade the database plan.
- **Document uploads are stubbed** — the DMS approval workflow (pending →
  reviewed → approved) is fully functional, but it doesn't yet accept a real
  PDF file; it records a placeholder storage key. Real file upload to object
  storage is a follow-on task, not required to test the approval workflow
  itself.
- **No password reset / email verification** — expected for a pilot; needed
  before production.


## Schema note: governance fields, Supervisory Board, Registration Certificate

The build's `prisma db push` applies these additive changes automatically: nullable
`nationalId`, `phoneNumber`, `appointmentDate`, `retirementDate` on `CommitteeMember`;
new `SupervisoryBoardMember` table and `SupervisoryPosition` enum; new
`REGISTRATION_CERTIFICATE` value on `DocumentType`. No existing rows are modified.
Existing committee members simply show blank ID/phone/dates until edited in the app.

## Switching the 1/3 gender rule on later

The rule is **not enforced** while `ENFORCE_GENDER_RULE` is `false` (the default). Committees are
still scored and labelled Non-compliant; they just are not blocked. To start enforcing: in the
Render dashboard open the backend service > Environment, set `ENFORCE_GENDER_RULE` to `true`, and
save (the service restarts). Committees already saved are not changed; the next submission is checked.

## Schema note: "Other" staff role

Adds one value, `OTHER_STAFF`, to the `StaffRole` enum. Additive: no existing account changes.

## PDF name-list import

Adds the `pdfjs-dist` dependency (pure JavaScript; installed by the normal `npm install` in the build).
No schema change and no new environment variable. A canvas warning from the library is silenced at load time.

## Backups and recovery (read this before real data goes in)

**Where the data lives.** Everything (records and uploaded documents) is in the Render Postgres database `embu-coop-db`. The web services hold only code and settings, so suspending or replacing a web service loses nothing as long as the new one uses the same `DATABASE_URL`.

**The database is the single point of failure.** Render's *free* Postgres expires after 30 days and is deleted with no recovery. For real data, upgrade `embu-coop-db` to a paid plan (daily backups and point-in-time recovery) and still keep your own copies below.

### Three ways to keep your own copy
1. **In the app (no setup).** National Admin: Dashboard -> *Database backup* -> *Download backup*. Saves one `.jsonl.gz` file. Do this weekly and before any change to Render.
2. **Nightly automatic copy.** `.github/workflows/nightly-backup.yml` takes an encrypted `pg_dump` every night and keeps it 30 days as a private GitHub artifact. Needs the repo to be **private** and two secrets (`BACKUP_DATABASE_URL` = the database's *External* connection string, `BACKUP_PASSPHRASE`). Run it once manually from the Actions tab to confirm it works. Download the latest file to your own storage monthly.
3. **From a computer.** In `backend/`, with `DATABASE_URL` set to the External URL: `npm run backup`.

Backups contain personal data and password hashes. Never email them or put them in a shared folder.

### If only a web service was suspended
Create the new service from the same code and set the **same** `DATABASE_URL` (Internal URL if same region), the same `JWT_SECRET` (otherwise everyone logs in again), `FRONTEND_ORIGIN`, `ALLOW_OPEN_SIGNUP`, `ENFORCE_GENDER_RULE`. Point the frontend's `NEXT_PUBLIC_API_BASE_URL` at the new backend URL. Do not run `reset:all`. If you used the Blueprint, make sure it did not create a second empty database.

### If the database is lost
1. Create a new Postgres database on Render.
2. On a computer with the code: set `DATABASE_URL` to the new database's External URL and run `npx prisma db push` (creates the empty tables).
3. **Before the backend starts for the first time**, load the backup:
   - app backup file: `npm run restore -- file.jsonl.gz` (a preview), then `npm run restore -- file.jsonl.gz --apply`;
   - nightly file: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in file.dump.enc -out file.dump`, then `pg_restore --no-owner --no-acl -d "$DATABASE_URL" file.dump`.
4. Point the backend's `DATABASE_URL` at the new database, redeploy, log in and spot-check a cooperative, its members and a document.

`restore` only adds missing rows; it never updates or deletes, so re-running it is safe. Loading before the first start matters because the start-up geography sync would otherwise create counties/wards with different ids.

Not covered: anything entered after the last backup. That is why the nightly copy exists.

## Security hardening (read with SECURITY_ASSESSMENT.md)

- **Pilot vs full launch.** `SECURITY_HARDENING` (default `false`) is the master switch. While `false`, the published password `Pilot2026!` keeps working and the three items below that say "at full launch" are OFF. Set it to `true` before real farmer data goes in.
- **Passwords (at full launch).** Any sign-in with the published test password `Pilot2026!` forces an immediate password change (`FORCE_DEFAULT_PASSWORD_CHANGE`, follows the master switch unless set to `true`/`false`). Passwords need 10+ characters with letters and numbers (8+ in pilot mode). A Director or National Admin can issue a temporary password from *Staff & Access → Reset password*; the person must replace it at next sign-in.
- **Two-step sign-in (MFA, at full launch).** National Admin and Director must use an authenticator app (`MFA_REQUIRED_ROLES`, default `NATIONAL_ADMIN,DIRECTOR`). At their next sign-in they are taken to *Security* to scan a QR code and save 8 recovery codes. Lost phone and codes: another National Admin uses *Staff & Access → Reset 2-step*, or run `npm run reset:mfa -- <email>` in the Render shell. `MFA_ENFORCEMENT` follows the master switch unless set to `true`/`false` (set `false` as an emergency switch). Anyone who enrols while it is off keeps two-step sign-in until they turn it off in *Security*. Optional `MFA_ENCRYPTION_KEY` (32+ random characters) encrypts the stored secrets with its own key; if you set it, never lose it, or everyone must re-enrol.
- **Farmers and agrovets.** Both portals have *Change password*. A sign-in with `Pilot2026!` forces a change. A forgotten password is reset by staff: *Cooperative → Members → Reset password* (cooperative manager, field officer, sub-county officer, director, national admin within their area) or *Agrovets → Reset password* (sub-county officer, director, national admin). A one-time temporary password is shown; read it to the person in person. There is **no** self-service "forgot password" yet: that needs an SMS or email provider.
- **Open sign-up must stay off.** `ALLOW_OPEN_SIGNUP` = `false` on the backend service. Check it in the Render dashboard, not only in `render.yaml`.
- **Proxy setting.** `TRUST_PROXY_HOPS` = `1` on Render (default). Without it the sign-in limits cannot tell visitors apart.
- **Signing secret.** In production the server refuses to start unless `JWT_SECRET` is at least 32 characters (Render's generated value is).
- **Build.** The backend build uses `npm install --omit=optional` (drops install-time packages with advisories that the app does not need).
- The repository must be **private**; enable GitHub secret scanning and push protection.

## Slow or empty county list (free tier)
- First suspect: the free backend was asleep (about a minute to wake). The site now wakes it from the landing page, retries the county request four times with a "waking the server" message, and remembers the list in the browser. Optional: enable `.github/workflows/keep-awake.yml` (set the repository variable `BACKEND_HEALTH_URL`) to ping the backend every 10 minutes. Free hours are about 750 per workspace, so keep only the backend awake.
- Start-up and the first county request used to insert counties and ~1,500 wards one row at a time. They are now batched, and the county list is cached in memory for 10 minutes.
- If it is still slow, open the backend's Render logs: a line `[counties] slow county load: N ms` means the database itself is slow (free Postgres is small and far away); check that the backend and database are in the **same region** and that `DATABASE_URL` is the *Internal* URL.

## Staff Directory (after deploying this version)
1. The new tables/columns are additive; the normal `prisma db push` on deploy creates them (no data-loss flag needed). The backend now also depends on `exceljs` (installed by `npm install` on deploy).
2. Sign in as Director or National Admin -> **Staff Directory** -> **Load staff roster** once (the free tier has no shell). From then on use **Download staff sheet / Upload staff sheet** to edit in Excel.

## Cooperatives list (after deploying this version)
1. The change is additive (societies may now have no registration number; `societyType` already exists). The normal `prisma db push` is enough.
2. Sign in as Director or National Admin -> **Cooperatives** -> **Load Embu county list** once (or **Upload cooperatives sheet** with the County's spreadsheet). Loading again is safe.

## If the nightly backup fails
Open the failed run in GitHub -> Actions -> "Nightly database backup" and look at the red step. The workflow now says in plain words which of these it is:
- **Database host does not exist / did not answer:** a Render FREE database expires after 30 days. Check the database still exists and is Available in Render; copy its **External** connection string into the `BACKUP_DATABASE_URL` secret.
- **Password authentication failed:** the password changed; update the secret.
- **SSL / access control refused:** Render -> database -> Access control must allow external connections.
- **Internal address:** the secret must be the External URL (host ends in `.render.com`).
- **Server version mismatch** (older workflow): fixed, the workflow now installs the newest PostgreSQL client.
GitHub also disables scheduled workflows in a repository after 60 days without activity if it is public; keep the repo private and re-enable the workflow from the Actions tab if it shows as disabled.

## Schema note: factories and average price

Adds two tables (`Factory`, `CooperativeFactory`). The change is additive only: no existing column or row is touched, and no shell is needed because the normal start command already runs `prisma db push`. Nothing needs seeding; add factories under **Factories** or via the Factory column of the cooperatives sheet. The nightly backup picks the new tables up automatically.

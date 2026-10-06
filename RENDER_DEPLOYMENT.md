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

**Schema changes on a live database:** the Render build command already runs
`prisma db push --accept-data-loss` on every deploy. For additive changes
(new tables, new optional fields), such as the Asset and Agrovet modules,
that applies them without touching existing rows. Before deploying a change
that *removes* or *renames* a column, take a database backup first, because
that is the case where `--accept-data-loss` genuinely drops data.

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

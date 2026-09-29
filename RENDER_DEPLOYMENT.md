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

**Every schema change to this project requires `db push --force-reset`, which
drops every table — including whatever accounts were already seeded.** If
you've deployed an update since the last time you seeded (new modules,
schema changes), the database is empty again and every login will fail with
"Invalid credentials" for the boring reason that the account doesn't exist
yet — not because anything is broken. The single command below does the
reset and both seed steps together, so this can't be forgotten as two
separate steps again:

```bash
npm run reset:all
```

That's equivalent to running these three in order, which still works if you
prefer to see each step individually:
```bash
npx prisma db push --force-reset --accept-data-loss
npm run seed:counties
npm run seed:pilot
```

You should see:
```
Seeded 47 counties.
Pilot seed complete. All accounts share the password: Pilot2026!
  National Admin: admin@cooperatives.go.ke
  County Director (Embu): director@embu.go.ke
  Employee (Field Officer): employee@embu.go.ke
  Manager: manager@embu.go.ke
  Cooperative: Kirimiri Coffee Growers Cooperative Society (EMB-PILOT-0001) — Embu County
```

| Role | Email | Purpose |
|---|---|---|
| National Admin | `admin@cooperatives.go.ke` | Cross-county oversight, national dashboard, staff/cooperatives in any county |
| County Director (Embu) | `director@embu.go.ke` | Admin oversight within Embu County only |
| Field Officer (employee) | `employee@embu.go.ke` | Plans visits, submits reports, uploads documents (Embu) |
| Cooperative Manager | `manager@embu.go.ke` | Manages the one seeded cooperative's members/documents/committee |

Cooperative seeded: **Kirimiri Coffee Growers Cooperative Society** (`EMB-PILOT-0001`), Embu County.

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

1. **The output says accounts are `0`** → the database is empty (the most
   common cause, per the warning above). Run `npm run reset:all` and try
   again.
2. **The output lists real accounts, but login still fails from the
   browser** → the database is fine and the problem is almost always one of:
   - **Wrong field for the farmer.** The Member Portal login asks for
     National ID, not email — `PILOT-0001`, not
     `farmer@...`.
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

That means the build ran before this fix (with `migrate deploy` and no
migration files). Run `npm run reset:all` (see above) to create the tables
and seed them in one step.

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

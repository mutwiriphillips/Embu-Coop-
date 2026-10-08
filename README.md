# National Cooperative Management & Governance System — Republic of Kenya

A secure, enterprise-grade, centralized platform for the State Department for
Co-operatives to manage cooperative societies across all **47 counties of
Kenya** — coffee, tea, dairy, sugarcane, cotton, fisheries, livestock, SACCOs,
housing, and transport cooperatives, among others.

Originally scoped as a pilot for Embu County's Co-operative Development
Section (see `/docs`), then generalized to a national, multi-county platform.

## Stack

- **Frontend:** React.js + Next.js (App Router), Tailwind CSS (official Kenyan colour palette)
- **Backend:** Node.js + Express, RESTful JSON API
- **Database:** PostgreSQL via Prisma ORM
- **Auth:** JWT-based auth with Role-Based Access Control (RBAC), county-scoped
- **File storage:** Cloud object storage (S3-compatible) with pre-signed URLs for PDFs

## Roles

- **National Admin** — cross-county oversight (State Department for Co-operatives)
- **County Director** — full access within their own county only
- **Sub-County Officer** — reviews documents, views cooperatives in their county
- **Field Officer** — plans visits, submits reports
- **Cooperative Manager** — manages their own cooperative's members/documents/committee

County scoping is enforced **server-side** — a County Director's requests are
always filtered to their own county's data regardless of what the client sends.

## Modules

1. **County Staff & Access Management (RBAC)** — staff accounts, roles, granular module permissions
2. **Field Operations & Leave Tracking** — leave requests, weekly visit planner, post-visit reports
3. **Cooperative Registry & Member Database** — cooperative profiles (16 value chains), member roll, share capital
4. **Secure Document Management System (DMS)** — encrypted PDF repository, 3-tier approval workflow
5. **Governance, Election & AGM Tracking** — committee terms, 1/3 gender rotation rule, AGM archive
6. **Financial Ledger & Credit Readiness** — contribution ledger, produce delivery tracking
   (coffee, milk, tea, etc.), payout/disbursement ledger, and a transparent credit-scoring
   engine cooperatives can use to demonstrate creditworthiness to third-party lenders.
   **This platform never disburses loans — it is a trust layer, not a lender.**
7. **Member Self-Service Portal** — a genuinely separate `MEMBER` auth tier (not a staff
   account) at `/member`. Registration is verified by matching a submitted National ID
   against the cooperative's own `Member` records — see the Module 7 section below for
   the honest scope boundary on what "verified" means here.
8. **Asset & Livestock Generalization** — one `Asset` model covers Livestock, Poultry,
   Housing, and Transport SACCO vehicles: a dairy cow, a boda boda, and a housing unit
   are all "something a member owns, with a status and a lifecycle of events." Feeds a
   7th, conditional credit-scoring factor.
9. **Agrovet Input Supply & Government Reimbursement** — a genuinely THIRD, fully
   isolated auth tier (`AgrovetAccount`, alongside staff and members) for registered
   agrovet shops. A farmer draws down a government-sourced input credit as goods at any
   approved shop; the shop is reimbursed in a batch afterward. See Module 9 below.

## Project Structure

```
embu-coop-system/
├── docs/                        # Source proposal & scope documents (PDF)
├── backend/                     # Node.js/Express API + Prisma schema
│   ├── prisma/schema.prisma     # Full data model (County + all 5 modules)
│   ├── prisma/seed-counties.js  # All 47 official Kenyan counties (factual reference data)
│   ├── prisma/seed-pilot.js     # 1 National Admin, 1 County Director, 1 employee, 1 manager, 1 cooperative
│   └── src/
│       ├── config/              # DB connection
│       ├── middleware/          # JWT auth, RBAC (county-scoped), error handling
│       ├── controllers/         # Business logic per module
│       ├── routes/              # Express routers per module
│       └── utils/                # Governance/compliance logic, JWT helpers
└── frontend/                    # Next.js app
    ├── app/                      # Pages: landing, login, signup, dashboard, cooperatives, staff, field-ops, leave
    ├── components/               # Sidebar, ProtectedRoute
    ├── context/                  # Auth context
    └── lib/                      # API client
```

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+ (or use the included `docker-compose.yml`)

### 1. Database

```bash
docker compose up -d db
```

### 2. Backend

```bash
cd backend
cp .env.example .env      # fill in DATABASE_URL, JWT_SECRET
npm install
npx prisma generate
ALLOW_DB_RESET=I_UNDERSTAND_THIS_DELETES_ALL_DATA npm run reset:all   # EMPTY local DB only — wipes everything
npm run dev                # http://localhost:4000
```

`reset:all` drops every table and is guarded (see `prisma/reset-guard.js`).
**Never run it on the live Embu database.** To add missing pilot accounts to
any database, including a live one, run `npm run seed:pilot`. It only
creates what's missing. `npm run verify:seed` reports exactly which staff,
farmer, and agrovet accounts exist.

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev                # http://localhost:3000
```

All pilot accounts share the password `Pilot2026!`:
- **National Admin:** admin@cooperatives.go.ke
- **County Director (Embu):** director@embu.go.ke
- **Sub-County Officer (Embu):** subcounty@embu.go.ke
- **Field Officer:** employee@embu.go.ke
- **Cooperative Manager (`/cooperative/login`):** manager@embu.go.ke, or registration number `EMB-PILOT-0001`
- **Farmer (Member Portal, `/member/login`):** National ID `PILOT-0001`
- **Agrovet shop owner (`/agrovet/login`):** National ID `AGRO-0001`

### Pilot / Test Run on Render

See [`RENDER_DEPLOYMENT.md`](./RENDER_DEPLOYMENT.md) for a full guide to
deploying this on Render with open self-signup enabled for testers, and
[`SMOKE_TEST_CHECKLIST.md`](./SMOKE_TEST_CHECKLIST.md) for a structured
walkthrough to run against the live deployment after every deploy — unit
tests and local builds prove the code is correct, but nothing exercises the
real Postgres database and real HTTP round-trips until this checklist does.

## Governance Logic (Module 5) — implemented rules

- Default committee term length: 3 years (configurable per value chain)
- `Term Expiring` flag: 90 days before `reelection_due_date`
- `Term Expired — Action Required` flag: day after `reelection_due_date` with no new election
- **1/3 gender rotation rule:** no single gender may hold more than 2/3 of elected
  committee seats (Chairperson, Vice Chairperson, Secretary, Treasurer, 4 board
  members). Non-elected Executive Manager is excluded. Enforcement is currently
  **suspended** (`ENFORCE_GENDER_RULE=false`): a committee that fails the rule is saved and shown as
  Non-compliant but not blocked. Setting `ENFORCE_GENDER_RULE=true` restores blocking, where a
  violation blocks submission unless the Director overrides with a logged justification. Retired members
  (retirement date reached) are excluded from the rule and from term status.
- **Committee member records** carry national ID, phone (stored as `+254XXXXXXXXX`),
  date of appointment and date of retirement. ID and phone are never written to audit logs.
- **Supervisory Board** (Co-operative Societies Rules 2004, rule 28): three seats —
  Chairman, Honorary Secretary, Member — 3-year term. Seat history is kept; a seat can
  have only one serving holder and one person cannot serve two seats. Overlap with the
  management committee is flagged as a warning (rule 28(4)), not blocked.
- Each committee save adds a new committee; only the newest of each type is "current"
  and scored. Cooperative Registry: Director/National Admin can delete a cooperative only
  when it has no members, documents or other records.
- **Staff positions.** Besides the five fixed roles, a Director or National Admin can create an
  **Other** account for any position (accountant, clerk, store keeper...). The position title and a
  reporting line are required; a person must report to someone more senior in the same county
  (no loops, no inactive line managers). Only Directors and the National Admin can list, open, edit,
  grant access to, view the activity of, deactivate or reactivate these accounts. They start view-only.
  Roles are fixed at creation and a Director can no longer edit Director/National Admin accounts or move staff between counties.
- Committee members have a single **Date appointed**; the election date is kept on the record
  (defaulting to it) and starts the 3-year term.
- **Import names from a typed PDF** (members, management committee, Supervisory Board). The PDF's text
  layer is read (`pdfjs-dist`), each line is searched for phone, ID, date, gender and position, and the
  rest is taken as the name. The result is only a *proposal*: it opens in an editable review table,
  flags anything uncertain, and nothing is saved until it is confirmed. Members are added in one
  all-or-nothing call (`POST /cooperatives/:id/members/bulk`); committee rows go through the normal
  committee form and board rows through the normal seat endpoint, so every existing rule still applies.
  The original PDF is then filed under Documents as a supporting file. Scanned pages and photos have no
  text layer and are not read (no OCR); the user is told so. Audit logs record counts only.
- **Registration Certificate** is a document type uploaded and reviewed like any other.

## Member Self-Service Portal (Module 7)

A completely separate identity tier from staff — `MemberAccount`, not `User`.
The two are architecturally isolated:

- **Separate JWTs.** Staff tokens carry `type: "staff"`, member tokens carry
  `type: "member"`. Each auth middleware (`authenticate` vs
  `authenticateMember` in `backend/src/middleware/auth.js`) rejects the
  other's token outright — verified with real crafted JWTs during testing,
  not assumed.
- **Separate frontend auth context, separate token storage.** `MemberAuthContext`
  and `lib/memberApi.js` never share a localStorage key with the staff
  `AuthContext`/`lib/api.js` — a staff member and a farmer could, in
  principle, be logged into both in the same browser without collision.
- **Self-scoped API.** Every `/api/member/*` route derives the member's
  identity entirely from their JWT — no route ever accepts a memberId or
  cooperativeId from the client, so one member can never query another's
  data by guessing an ID.

### Registration & "verification" — an honest scope boundary

Registration (`POST /api/member-auth/register`) matches a submitted National
ID + selected cooperative against an existing `Member` record that staff
already created via the Cooperative Registry. **This is not a government ID
check** — there is no integration with IPRS, eCitizen, or any external
registry. It verifies against the cooperative's own membership records,
which is the only ground truth this platform actually has access to. That's
a deliberate, documented boundary so the trial run behaves exactly like the
real thing would, without pretending to a capability (government ID
verification) that would need a separate formal agreement to build.

### Digital contributions — simulated, clearly labeled

`POST /api/member/contributions/initiate` lets a member record a
contribution themselves, as if an M-Pesa STK Push had already completed.
There is no real Safaricom Daraja integration wired up (needs a shortcode,
passkey, and a public callback URL this environment doesn't have) — the
response and the UI both say "simulated" so this is never mistaken for a
real payment. The `Contribution.method` and `externalRef` fields already
exist for exactly this integration; wiring real Daraja later means adding an
STK Push request plus a public webhook route, not restructuring the ledger.

### What members can and can't do

- View their own contribution, produce delivery, and payout history
- Make a (simulated) digital contribution
- View their cooperative's meeting record and current credit standing
- **Cannot** self-report produce deliveries — those stay staff-recorded
  (Cooperative Manager or Field Officer at drop-off) so the credit-scoring
  signal stays trustworthy, not self-reported

`backend/src/utils/creditScore.js` computes a 0–100 composite score across six
weighted factors — contribution consistency (20%), **produce consistency
(20%)**, governance compliance (20%, reuses the Module 5 rules above),
document compliance (15%), membership stability (15%), and share capital
trajectory (10%) — mapped to a band (AA/A/B/C/D). The full per-factor
breakdown is returned so nothing is a black box to a reviewing lender.

Produce consistency is scored independently from contribution consistency —
a cooperative can't hide declining farmer output behind healthy cash
collection, or vice versa. Both matter to a lender for different reasons.

Run the test suite directly (plain `assert`, no framework needed):
```bash
cd backend && npm run test:credit-score
```
36 unit tests cover each factor in isolation plus end-to-end scenarios (a
strong cooperative scoring AA/A, a weak one scoring D, and a check that
produce activity measurably moves the score independent of contributions).

**Scope boundary, enforced in code, not just policy:** only county staff
(National Admin / Director / Sub-County Officer) can trigger an assessment —
a Cooperative Manager can never self-certify their own cooperative's score.
Every response carries an explicit disclaimer that this is a referral signal
for a third-party lender, not a loan offer, pre-approval, or guarantee — this
platform does not disburse funds.

## Produce, Payouts & the Disbursement Trickle-Down Report

Two new ledgers, alongside the Module 6 Contribution ledger:

- **`ProduceDelivery`** — what a member physically delivers (coffee cherries,
  milk, tea leaf, etc.), with quantity, unit, quality grade, and an optional
  rate/total value. Feeds directly into the produce-consistency credit factor.
- **`Payout`** — money the cooperative pays OUT to a member, optionally
  settling specific unpaid produce deliveries. This is the other half of the
  ledger: Contribution/ProduceDelivery track what flows IN, Payout tracks
  what flows back OUT to the farmer.

The Director's **Farmer Disbursements** dashboard (`/disbursements` in the
frontend, `GET /api/reports/disbursements` in the API) is a trickle-down
report: National (all counties, National Admin only) → County → Cooperative
→ individual farmer compensation amounts, filterable by date range.

**Ownership scoping, enforced in code:** `requireCooperativeAccess`
(`backend/src/middleware/auth.js`) ensures a Cooperative Manager can only
ever touch their *own* cooperative's data — not any cooperative they happen
to guess an ID for — and county staff are always scoped to their own county.
As of this pass, this is applied to **every** cooperative-scoped route:
contributions, produce, payouts, credit-assessment, documents, governance,
and the cooperative/member-roll routes themselves. A companion
`requireStaffAccess` middleware applies the same county-matching principle
to staff management, so a Director can no longer view, edit, deactivate, or
change permissions on a staff account in another county by guessing its ID.

Both middlewares were verified with a targeted test stub that simulates real
distinguishing data (a Director in "County A" against cooperatives/staff in
both "County A" and "County B") — same-county access passes through to the
controller, cross-county access is rejected with 403, nonexistent IDs return
404. This is a materially stronger test than "does it 401 with no token,"
which is all a blanket stub can prove.

While auditing this, also found and fixed several `requireRole(...)` lists
across Documents, Governance, and Field Operations that predated the
national rollout and had never been updated to include `NATIONAL_ADMIN` —
meaning a National Admin account could previously view staff/cooperative
data everywhere via `requirePermission`'s bypass, but could not review
documents, approve documents, override governance compliance, or decide
leave/visit requests, despite the role's intended cross-county oversight.

## Asset & Livestock Generalization (Module 8)

One model — `Asset` — covers every value chain where a member's holding is a
discrete tracked thing rather than consumable produce: **Livestock, Poultry,
Housing, and Transport** SACCOs. A dairy cow, a boda boda, and a housing
unit are structurally the same fact pattern: something a member owns, with a
status (`ACTIVE`/`TRANSFERRED`/`SOLD`/`DECEASED`/`WRITTEN_OFF`) and a full
lifecycle event history (`AssetEvent`: acquired, transferred, sold, deceased,
written off, a valuation update, or a routine health check). This is the same
"shape, not chain" reduction already applied to `ProduceDelivery` for the 9
consumable-produce chains — see `learnings-and-workflow` for the original
3-shape breakdown this completes.

Recording a closing lifecycle event (sold/deceased/transferred/written-off)
automatically updates the asset's own `status` — "how many assets are
actually active right now" never depends on staff remembering to flip a
separate field. A `VALUATION_UPDATE` event refreshes `currentValue`.
Acquisition itself is logged as the first `AssetEvent` automatically, so
every asset's history is complete from day one, not just from whenever
someone got around to it.

**Staff-recorded, not self-reported** — same integrity reasoning as Produce:
a member can view their own assets and full event history at
`/api/member/assets`, but cannot create or modify them. Only a Cooperative
Manager or Field Officer for that specific cooperative can.

**Credit scoring integration — conditional, not universal.** Asset Stability
is a 7th scoring factor (12% weight) built from three signals: coverage
(what fraction of members have an active asset on record), survival (active
assets as a share of every asset ever recorded — high attrition is a real
risk signal), and recency (what fraction of active assets have any event
logged in the trailing 12 months). It only applies to the four asset-tracked
value chains — for every other cooperative, the factor is **absent from the
weights entirely**, not scored as zero, with the remaining six weights
proportionally renormalized to still sum to exactly 1.0. The breakdown
always carries an explicit `applicable: false` entry rather than silently
omitting the factor, so a lender reading the report can see the boundary,
not just its absence.

This was verified two ways: 47 unit tests (11 new for this module, in
`backend/src/utils/creditScore.test.js`) prove the renormalization math is
exactly correct, including that a coffee cooperative and an identical-data
livestock cooperative with no herd score identically on every *shared*
factor — applicability never leaks into the other six factors' own scores.
Separately, the same targeted-stub access-control method described above
was re-run specifically against the new `/assets` routes, confirming
same-county pass-through, cross-county 403, and nonexistent-ID 404 all hold
for this module too.

An exportable per-member **asset statement** (`GET
/cooperatives/:id/assets/statement?memberId=`) lists every asset and its
full event history with a running current-value total — the same kind of
document a farmer or their cooperative would hand to a lender alongside the
credit-readiness report itself.

## Agrovet Input Supply & Government Reimbursement (Module 9)

A genuinely **third auth tier** — agrovet shop owners are neither staff nor
farmers, so `AgrovetAccount` gets its own JWT `type: "agrovet"` claim and its
own `authenticateAgrovet` middleware, structurally isolated from both
`authenticate` (staff) and `authenticateMember` the same way those two are
isolated from each other. A shop's login can never reach a staff or farmer
endpoint, and vice versa — proven with the same crafted-JWT method used
throughout this project, now three-way instead of two.

**The flow, deliberately modelled on the existing produce-to-payout
pattern:**

1. **`FarmerInputCredit`** — county staff record that a government
   programme (named freely, e.g. "NARIGP Fertilizer Subsidy 2026" — not a
   fixed enum, since real programmes vary and new ones appear over time)
   has allocated a farmer a specific input credit.
2. **`InputCollection`** — the point-of-sale event. A farmer visits any
   *approved* agrovet shop, and the shop itself (via its own portal login,
   never the farmer, never staff) records what was physically handed over,
   itemised against its own product catalog (`InputProduct`). This is the
   "ProduceDelivery" of this module: recorded by the party with first-hand
   knowledge that goods actually changed hands.
3. **`AgrovetReimbursement`** — once county staff have verified the
   underlying government disbursement is genuine, a Director batch-settles
   a shop's pending collections in one transaction — the "Payout" of this
   module. Money only ever reaches the shop, never the farmer directly,
   since the farmer already received the value as goods.

**Shop registration follows the same two-tier approval Document Management
already uses** — `PENDING` → `REVIEWED` (Sub-County Officer) → `APPROVED`
(Director) — reusing that pattern rather than inventing a new one. A shop
can log in and see its own status while still pending; only catalog and
collection-recording routes are gated behind full approval, via a separate
`requireApprovedShop()` middleware rather than baking the gate into
authentication itself.

**Two real bugs were caught and fixed during this module's build, not
after:**

- `authenticate()` (the original staff middleware) only excluded `"member"`
  by name rather than positively requiring `"staff"` — an incomplete
  deny-list that happened to still work by accident (an agrovet token's
  `sub` simply never matched a real staff `User` id), not because it was
  actually checked for. Fixed to a positive `payload.type !== "staff"`
  check, so a new tier's token can never again silently fall through this
  check by omission the way the old deny-list could.
- The first draft of collection recording read the credit's remaining
  balance, checked it in application code, then wrote the decrement as a
  separate step — a classic race condition where two near-simultaneous
  collections against the same credit could each pass the check and
  jointly overdraw it. Rewritten as one atomic conditional `updateMany`
  (`WHERE remainingAmount >= totalValue`) so the check and the decrement
  happen in a single database statement; concurrent requests can no longer
  interleave their way past it.

Verified with live crafted-JWT tests: three-way tier isolation (staff ↔
member ↔ agrovet, each rejected on the other two's routes), county-scoped
shop approval (own-county pass-through, cross-county 403, nonexistent
404), and the staff role hierarchy (a Sub-County Officer can review a shop
but not approve it or process a reimbursement — confirmed by a `409`
business-logic response proving they genuinely reached the controller,
not a `403` that would just as easily mean they were blocked by accident).

**Honest gaps:** no real cooperative has used this module in production —
it is built and tested, not field-proven, the same standing caveat every
other module in this project carries at this stage. `prisma validate`
could not be run for this module's schema changes, since its engine
binaries live outside this sandbox's network allowlist; verification
instead relied on a manual, bidirectional pairing check of all 16 new
relations (every `@relation` has a matching reverse field, on both models
it connects) plus the live wiring and access-control tests described above.

## Geography, Area Scoping & File Uploads (Module 10)

**County → Sub-County → Ward.** `SubCounty` (290 IEBC constituencies, codes
1–290, plus gazetted national-government sub-counties that aren't
constituencies, codes 291+) and `Ward` (1,450, IEBC ward codes) are reference
tables loaded from
`backend/src/data/kenyaGeography.js`. The data came from the kenya-regions
dataset and was cross-checked against an independent IEBC compilation:
identical totals, identical constituencies in every county, and 23 ward
spelling variants kept as aliases. Four genuine name disagreements are listed
in `DISPUTED_WARDS`. Cooperatives, staff, and agrovet shops carry
`subCountyId` / `wardId` links **and** keep their text `subCounty` / `ward`
fields, which the server fills in from the chosen dropdowns, so existing
screens keep working. `resolveLocation()` rejects a ward from another
sub-county or a sub-county from another county.

After deploying, run `npm run geo:sync` once (see `RENDER_DEPLOYMENT.md`):
it loads the reference data and links existing records, changing nothing else.

**Mwea Sub-County, Embu (code 291).** Embu's sub-counties are Manyatta,
Runyenjes, Mbeere North, Mbeere South and **Mwea**. Mwea is a gazetted
national-government sub-county (HQ Karaba) covering the Karaba, Riakanau and
Makima areas, so it holds **Mwea Ward** and **Makima Ward**, which previously sat
under Mbeere South; Mbeere South keeps Mbeti South, Mavuria and Kiambere. Embu
still has 20 wards. Sources are cited in `ADMIN_SUB_COUNTIES` in
`kenyaGeography.js`. Kirinyaga's Mwea Constituency (code 100) is separate and
unchanged. `FORMER_PARENT` lets older text such as "Mbeere South / Mwea" still
resolve, to its new sub-county.

**Self-correcting on deploy.** `utils/geographySync.js` runs once in the
background when the server starts: it adds any missing sub-county or ward,
re-points any ward that moved, and moves any cooperative, staff member or
agrovet shop whose ward is now in a different sub-county. It never deletes or
renames, and when nothing needs changing it only reads. Sub-County Officers
are never reassigned automatically; the log names any whose sub-county gave
wards to a new one, so the Director can decide. `GEO_AUTO_SYNC=false` turns
the start-up run off.

**Who sees what** (`areaScope()` in `utils/geography.js`, applied in every
list and every access check): National Admin → everything; Director and
Field Officer → their county; Sub-County Officer → their sub-county.
`GET /api/counties/:id/breakdown` drives the Director drill-down.

**Uploads.** `StoredFile` keeps the file bytes in PostgreSQL, because Render's
disk doesn't survive deploys. Type is sniffed from the content (PDF, JPEG,
PNG, WEBP), not trusted from the filename or browser. Every file records what
it belongs to, and `GET /api/files/:id` releases it only to people who may see
that record: the cooperative's manager or the county staff covering its area,
or the agrovet shop itself. Anyone else gets a 404, so file ids can't be
probed.

**Leaks closed in this module:** leave and field visits were visible and
decidable across all counties; `/api/counties/summary` was public; visits
could be planned for and reported on anywhere; documents never stored a file.

Tested with 84 end-to-end HTTP checks plus the previous 52-check suite as a
regression (all passing), and schema-validated with Prisma's own validator.

## Open Items From Scope (to confirm with County before Phase 2)

See `docs/Embu_Coop_Engineering_Scope.pdf`, Section 6 — sub-county/ward list,
cooperative manager login model, PDF size/retention policy, offline entry
requirement, notification requirements, and hosting ownership are stubbed with
sensible defaults in this scaffold and should be finalized during Phase 1.

## License / Ownership

Per the original commercial proposal, full IP and source code transfer to Embu
County Government upon final payment milestone (M4) for the pilot engagement.
Terms for a national rollout across all 47 counties would need a separate
agreement with the State Department for Co-operatives.

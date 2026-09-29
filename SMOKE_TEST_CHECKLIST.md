# Live Smoke Test Checklist

Run this against the **actual deployed Render URLs**, not localhost. Everything
in this project has been verified locally (unit tests, wiring checks, crafted-
JWT access-control tests, production builds) — none of it has been exercised
against the real live Postgres database and real HTTP round-trips until this
checklist is run. That's the entire point of it.

**Re-run this after every future deploy**, not just once — a schema change
means `db push --force-reset`, which wipes the database and makes every item
below fail again until reseeded (see `RENDER_DEPLOYMENT.md`).

Fill in your real URLs once, here, then use them for every step:

- Backend URL: `_______________________________`
- Frontend URL: `_______________________________`

All seeded accounts share the password `Pilot2026!` unless noted.

---

## Phase 0 — Connectivity (2 minutes)

- [ ] `<backend-url>/api/health` loads directly in a browser tab and returns `{"status":"ok",...}`
- [ ] `<frontend-url>/` loads and shows the landing page (tea-highlands hero image renders, not a broken image icon)
- [ ] `<frontend-url>/privacy` loads and shows the policy page
- [ ] On a phone (or DevTools device emulation), the landing page header does **not** overflow or overlap, and "Register as a Farmer" is visible without scrolling past a wall of branding

## Phase 1 — Staff login, one per role (10 minutes)

For each row: log in, confirm the dashboard loads, confirm the sidebar only shows what that role should see, then sign out.

| Role | Email | Expect on the dashboard | Expect in the sidebar |
|---|---|---|---|
| National Admin | `admin@cooperatives.go.ke` | National coverage table (47 counties, mostly empty except Embu) | "Staff & Access" visible, county selector present |
| County Director | `director@embu.go.ke` | Embu-only dashboard, no county selector | "Staff & Access" visible, scoped to Embu |
| Field Officer | `employee@embu.go.ke` | Embu cooperatives, read-mostly | No "Staff & Access" link |
| Cooperative Manager | `manager@embu.go.ke` | Their one managed cooperative | No "Staff & Access" link |

- [ ] All four logged in successfully
- [ ] National Admin's county selector, when set to a county other than Embu, shows an empty/zero state (not an error) — this is expected, not a bug
- [ ] Sidebar differences above all held as described

## Phase 2 — Cooperative Registry & Members (5 minutes)

Using the Director or National Admin login:

- [ ] `/cooperatives` lists **Kirimiri Coffee Growers Cooperative Society** (`EMB-PILOT-0001`)
- [ ] Opening it shows the Coffee value chain and Embu County
- [ ] Members tab lists **Test Member** (national ID `PILOT-0001`)
- [ ] Create a brand-new cooperative (any name, any value chain) to confirm write access works, not just the seeded read path
- [ ] Add a member to that new cooperative with a fresh, made-up National ID

## Phase 3 — Financial Ledger (10 minutes)

On the seeded cooperative (Manager or Director login):

- [ ] Contributions tab shows 6 months of seeded `MONTHLY_CONTRIBUTION` entries for Test Member
- [ ] Record one new contribution — confirm it appears immediately without a page refresh being required
- [ ] Produce tab shows 3 seeded Coffee Cherries deliveries, 2 marked Paid and 1 Pending
- [ ] Record one new produce delivery
- [ ] Payouts tab shows the one seeded payout, and the produce delivery it settled is marked Paid
- [ ] Record a new payout against the still-unpaid seeded delivery; confirm that delivery flips to Paid

## Phase 4 — Credit Scoring Engine (5 minutes)

- [ ] Credit Score tab: click "Run New Assessment"
- [ ] A score, band (AA–D), and 6-factor breakdown render (Asset Stability should show "Not applicable" — Coffee isn't an asset-tracked value chain, this is correct, not a bug)
- [ ] Run it a second time; confirm a history row appears
- [ ] The disclaimer text ("this platform does not disburse funds") is visible somewhere on the tab

## Phase 5 — Director's Disbursement Report (5 minutes)

As Director or National Admin:

- [ ] `/disbursements` loads
- [ ] The seeded cooperative appears with a non-zero total
- [ ] Clicking the row expands to show Test Member's individual payout total
- [ ] Changing the date range filter changes the totals shown (confirms the filter isn't decorative)

## Phase 6 — Documents & Governance (10 minutes)

- [ ] Upload a document (any file) as Manager — appears with status `PENDING`
- [ ] Review it as Director/Sub-County role — moves to `REVIEWED` or is rejected
- [ ] Approve it as Director — moves to `APPROVED`
- [ ] Governance tab: save a committee composition that **violates** the 1/3 rule (e.g., 4 men, 0 women in elected seats) — confirm it's **blocked** with an explicit error, not silently accepted
- [ ] Save a compliant composition — confirm it succeeds
- [ ] As Director, override a blocked composition with a justification — confirm the override is logged (visible on the committee, e.g., "Director override logged")

## Phase 7 — Field Operations (5 minutes)

- [ ] Apply for leave as Field Officer
- [ ] Approve or reject it as Director
- [ ] Plan a field visit against the seeded cooperative
- [ ] Authorize the visit as Director/Sub-County
- [ ] Submit a post-visit report

## Phase 8 — Farmer / Member Portal (10 minutes)

- [ ] `/member/login` with National ID `PILOT-0001` and password `Pilot2026!` logs in successfully
- [ ] Overview tab shows non-zero totals matching what Phase 3 recorded
- [ ] Cooperative's credit band from Phase 4 is visible here too
- [ ] Contributions tab: make a (simulated) digital contribution — confirm it's clearly labeled as simulated, not implying a real M-Pesa charge happened
- [ ] Produce tab is **read-only** — confirm there is no way to add a delivery as a farmer
- [ ] Sign out, then register a brand-new farmer via `/member/register` against the new cooperative/member created in Phase 2
- [ ] Confirm registration with a National ID that does **not** match any real Member record is rejected with a clear message, not a silent failure or a 500 error

## Phase 9 — Access-Control Boundaries (10 minutes — the most important phase)

This is what all the crafted-JWT testing earlier in the build proved *should*
work. This phase proves it actually does, against the real deployment.

- [ ] Log in as the Cooperative Manager for the seeded cooperative. Try to
      navigate directly to the URL for the *new* cooperative created in Phase 2
      (copy its ID from the address bar while logged in as Director, then
      paste that URL while logged in as Manager) — expect a 403/blocked page,
      not the other cooperative's data
- [ ] Log in as National Admin, create a Director account for a *different*
      county (e.g., Nairobi) via Staff & Access, then confirm that new
      Director, once logged in, cannot see Embu's cooperative
- [ ] As the original Embu Director, try to view/edit that new Nairobi
      Director's staff record by URL — expect a 403, not success
- [ ] Confirm a staff login (any role) cannot reach `/member/dashboard`, and a
      farmer login cannot reach `/dashboard` or any `/staff`, `/cooperatives`,
      etc. page

## Phase 10 — Signed-in State & Sessions

- [ ] Refresh the page mid-session — confirm you're still logged in (not
      bounced to `/login`)
- [ ] Sign out — confirm you land on the login page and a direct visit to
      `/dashboard` redirects you back to login rather than showing stale data

---

## If something fails

- **A specific action 403s when it shouldn't** → note the exact role, the
  exact action, and the exact URL. This is the highest-priority class of bug
  to report back, since it's a security boundary, not a cosmetic issue.
- **A page won't load at all / blank screen** → check the browser Console
  tab for a JS error and the Network tab for the failing request, same as
  the login troubleshooting already covered in `RENDER_DEPLOYMENT.md`.
- **Data doesn't match what's described above** → the database may have been
  reset without reseeding since this checklist was written — run
  `npm run verify:seed` in the backend Shell to confirm.

## After a clean run

Note the date and who ran it — this is worth keeping as a record, since
"we tested this on the live deployment on `<date>`" is a real answer to give
the Governor's office, not an assumption.

**Last run:** `_______________` **By:** `_______________` **Result:** ☐ Clean ☐ Issues found (listed above)

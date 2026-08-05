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
npx prisma db push        # creates tables from schema.prisma (see note in RENDER_DEPLOYMENT.md)
npm run seed:counties     # seeds all 47 counties — required before anything else
npm run seed:pilot        # seeds 1 National Admin, 1 County Director (Embu), 1 employee, 1 manager, 1 cooperative
npm run dev                # http://localhost:4000
```

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
- **Field Officer:** employee@embu.go.ke
- **Cooperative Manager:** manager@embu.go.ke

### Pilot / Test Run on Render

See [`RENDER_DEPLOYMENT.md`](./RENDER_DEPLOYMENT.md) for a full guide to
deploying this on Render with open self-signup enabled for testers.

## Governance Logic (Module 5) — implemented rules

- Default committee term length: 3 years (configurable per value chain)
- `Term Expiring` flag: 90 days before `reelection_due_date`
- `Term Expired — Action Required` flag: day after `reelection_due_date` with no new election
- **1/3 gender rotation rule:** no single gender may hold more than 2/3 of elected
  committee seats (Chairperson, Vice Chairperson, Secretary, Treasurer, 4 board
  members). Non-elected Executive Manager is excluded. Violations block submission
  unless the Director overrides with a logged justification.

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

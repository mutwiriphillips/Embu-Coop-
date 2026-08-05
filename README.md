# Embu County Cooperative Management & Governance System

A secure, enterprise-grade, centralized platform for the Co-operative Development
Section of Embu County Government to manage ~200 cooperatives across the Coffee,
Dairy, Miraa, and Irrigation value chains.

Built from the Technical & Commercial Proposal and Engineering Scope documents
(see `/docs`).

## Stack

- **Frontend:** React.js + Next.js (App Router), Tailwind CSS
- **Backend:** Node.js + Express, RESTful JSON API
- **Database:** PostgreSQL via Prisma ORM
- **Auth:** JWT-based auth with Role-Based Access Control (RBAC)
- **File storage:** Cloud object storage (S3-compatible) with pre-signed URLs for PDFs

## Modules

1. **County Staff & Access Management (RBAC)** — staff accounts, roles, granular module permissions
2. **Field Operations & Leave Tracking** — leave requests, weekly visit planner, post-visit reports
3. **Cooperative Registry & Member Database** — cooperative profiles, member roll, share capital
4. **Secure Document Management System (DMS)** — encrypted PDF repository, 3-tier approval workflow
5. **Governance, Election & AGM Tracking** — committee terms, 1/3 gender rotation rule, AGM archive

## Project Structure

```
embu-coop-system/
├── docs/                        # Source proposal & scope documents (PDF)
├── backend/                     # Node.js/Express API + Prisma schema
│   ├── prisma/schema.prisma     # Full data model (all 5 modules)
│   └── src/
│       ├── config/              # DB connection
│       ├── middleware/          # JWT auth, RBAC, error handling
│       ├── controllers/         # Business logic per module
│       ├── routes/              # Express routers per module
│       └── utils/                # Governance/compliance logic, JWT helpers
└── frontend/                    # Next.js app
    ├── app/                      # Pages (App Router)
    ├── components/               # Reusable UI components
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
npx prisma migrate dev --name init
npx prisma db seed
npm run dev                # http://localhost:4000
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev                # http://localhost:3000
```

Default seeded login (change immediately in production):
- **Email:** director@embu.go.ke
- **Password:** ChangeMe123!

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

Per the proposal, full IP and source code transfer to Embu County Government upon
final payment milestone (M4).

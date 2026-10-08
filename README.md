# GasMan Transport Management System (demo + production foundation)

One unified system for LPG bowzer transport: operations, tracking, fleet & drivers, fuel & expenses, finance & sales, inventory & procurement, tyres, HR & payroll — separated by **roles and permissions**, not by separate tools. Built by MK TechSol for GasMan Private Limited. **All demo data is synthetic.**

## Quick start (development)
```bash
npm install
cp .env.example apps/api/.env          # set DATABASE_URL (PostgreSQL 16) and JWT_ACCESS_SECRET
npm run db:migrate && npm run db:seed  # schema + deterministic demo data
npm run dev                            # API :4000, web :5173
```
Log in with the role buttons on the login page (password `GasMan@Demo2026`). Credentials and what to try: `docs/05-demo-credentials.md`.

## Commands
| | |
|---|---|
| `npm test -w @gasman/api` | 65 API tests (needs a PostgreSQL test database; see `apps/api/tests/globalSetup.ts`) |
| `node e2e/demo-flow.mjs` | 39-step browser walk-through (Playwright, 8 roles, phone viewport) |
| `npm run db:demo-reset` | re-seed the demo (refuses unless `APP_ENV` is local/test/demo; `--yes` on a demo server) |
| `npm run db:seed-load` | scale fixture for performance tests (never run on production) |
| `npm run bench` | latency benchmark (`scripts/bench.mjs`) |
| `npm run docs:permissions` | regenerate `docs/09-permissions.md` from code |

## Documentation
`docs/00-discovery` · `01-vps-audit` · `02-market-research` · `03-domain-model` (ERD, ledger, stock) · `04-deployment` · `05-demo-credentials` · `06-demo-test-plan` · `07-client-feedback-log` · `08-old-system-gap-analysis` · `09-permissions` · `10-performance` · `11-assumptions-limitations` · `docs/adr/`

## Layout
`packages/shared` (roles, permissions, trip state machine) · `apps/api` (Express, PostgreSQL, SQL migrations, services, seed) · `apps/web` (React/Vite/Tailwind) · `deploy/` (Docker, nginx, backup, VPS audit) · `e2e/` · `scripts/`.

## Security in one paragraph
Server-side RBAC on every route; finance data never in shared caches; JWT + rotating refresh tokens; bcrypt; rate limits and lockout; helmet; zod validation on every input; audit log of logins, postings and master-data changes; destructive demo commands refuse production. No secrets in the repository (`.env.example` has placeholders).

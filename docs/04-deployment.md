# 04 — Deployment

Target: VPS `taktak-vps` (alias from the brief). **Status: not deployed yet** — the sandbox that built this cannot reach the server. `deploy/vps-audit.sh` is a read-only script; run it on the VPS, send back the output, and we will fill `01-vps-audit.md` and choose ports.

## Topology
```
browser ──HTTPS──► host nginx (existing) ──► 127.0.0.1:8480  web container (nginx + static app)
                                                │  /api/*
                                                └──► api container :4000 ──► db container (PostgreSQL 16, private network)
```
* Everything runs in an isolated Docker Compose project (`docker-compose.yml`, project `gasman-tms`); no host package changes, no host ports except `127.0.0.1:8480`.
* The existing nginx keeps TLS; add a server block from `deploy/nginx-host-site.conf` (subdomain of your choice, e.g. `tms-demo.…`).

## Steps
1. `deploy/vps-audit.sh` on the VPS → send output (OS, ports in use, Docker, nginx, disk, RAM).
2. Copy `.env.example` → `.env` and set: `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET` (≥ 32 random chars), `CORS_ORIGINS` (the https origin), `WEB_PORT` if 8480 is taken, `APP_ENV=demo`.
3. `docker compose up -d --build` — the API applies migrations `001…009` on start.
4. Seed the demo once: `docker compose exec -T api node dist/seed/cli.js reset --yes` (only works when `APP_ENV=demo`).
5. Add the nginx server block, `nginx -t`, reload, obtain a certificate (certbot) for the subdomain.
6. Smoke test: log in as each role from `05-demo-credentials.md`; run `e2e/demo-flow.mjs` against the public URL.

## Operations
* **Reset the demo:** `deploy/reset-demo.sh` (or the sidebar button for Super Admin). Takes ~20 s.
* **Backup:** `deploy/backup.sh` (compressed `pg_dump`, keeps 14). Cron it nightly. Restore into an empty DB: `gunzip -c file.sql.gz | psql …`.
* **Logs:** `docker compose logs -f api` (JSON, pino). Health: `GET /health`.
* **Update:** `git pull && docker compose up -d --build`; migrations are idempotent and run in order, each in its own transaction.
* **Rollback:** restore the pre-update backup and check out the previous tag; migrations are additive.

## Safety rails
* `APP_ENV=production` disables every destructive demo command; database names containing "prod" are refused by the seed CLI.
* Secrets only in `.env` on the server (never committed; `.env.example` has placeholders). Cookies are `Secure` when `COOKIE_SECURE=true`.
* Rate limits on login and API; accounts lock for 10 minutes after 5 wrong passwords.
* Change the shared demo password and remove the quick-fill role buttons from the login page before any non-demo use.

## Scaling notes (see `10-performance.md`)
One API process handled ~220 requests/s with 60 concurrent users on an 80k-trip / 500k-ledger-line database. For hundreds to thousands of users: run several API replicas behind nginx, add PgBouncer, and keep the GPS simulator on a single replica (`SIM_ENABLED=true` on one node only; it uses an advisory lock regardless). Real GPS arrives through `POST /tracking/positions` (batched, idempotent by `clientEventId`).

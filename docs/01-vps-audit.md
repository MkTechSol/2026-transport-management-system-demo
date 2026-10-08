# 01 — VPS audit (taktak-vps) — performed by MK TechSol on 2026-10-08, read-only

| Item | Finding | Consequence for GasMan TMS |
|---|---|---|
| OS / kernel | Ubuntu 22.04.5, 5.15 | fine |
| CPU / RAM | **2 vCPU, 7.8 GiB RAM** (4.3 GiB cache, 4.2 GiB available), **swap 1.2 / 2.0 GiB used** | shared, already under some memory pressure → cap our containers (compose `mem_limit`), no extra services |
| Disk | 97 GB, 30 % used (68 GB free) | plenty |
| Docker | 29.4.3 + Compose v5.1.3; ~35 containers in 7 compose projects (backend, erp-stage, hrmis, mk_portfolio, mktrack_v2_backend, taktak, waos) | add our own isolated project `gasman-tms`; touch nothing else |
| Reverse proxy | host **nginx 1.18**, ~28 sites in `sites-enabled`, 80/443 owned by it | add one new server block; reload only after `nginx -t` |
| **Existing GasMan site** | `gasmanlpg` nginx site, `gasmanlpg.mk-teknology.com`, `/var/www/gasmanlpg` | **do not reuse that name or directory** — use a new subdomain, e.g. `gasman-tms.mk-teknology.com` |
| Ports in use (127.0.0.1) | 3001 3080 3081 3100 3300 3306 3307 3400 4000 4300 4500 4600 4700 4810 5000 5433 6379 6380 6700 8000 8001 8008 9443 65529 … | **8480 is free** (our web port). 4000 is taken (taktak-fcm) — our API port is internal to the compose network, so no clash |
| PostgreSQL | none on host (host has MySQL 8, Redis); several Postgres containers | ours runs in its own container, volume `gasman-tms_gasman_pg`, no host port |
| TLS | certbot cron present; no cert list was captured | issue a cert for the new subdomain with certbot (nginx plugin) |
| Backups / cron | per-app cron jobs (mk_portfolio, salesdesk) | add `deploy/backup.sh` nightly for our DB only |
| Firewall / monitoring | not reported / inactive | out of scope; nothing opened by us (we bind 127.0.0.1 only) |

## Decisions
* Project name `gasman-tms`, web on `127.0.0.1:8480`, DB and API private to the compose network.
* New DNS record needed: `gasman-tms.mk-teknology.com` → `187.77.154.84`.
* Memory caps: db 384 MB, api 384 MB, web 64 MB (set in `docker-compose.yml`). GPS simulator stays on (single API replica).
* No changes to existing containers, nginx sites, or volumes.

# 01 — VPS audit (`taktak-vps`)

## Status: **NOT PERFORMED — no access from the build environment**
The build ran in an isolated cloud sandbox: it has no `ssh` client, no key and no `taktak-vps` host entry. Rather than guess, **nothing about the server's current state is claimed here**, and **nothing was changed on it**.

## What to do (2 minutes, read-only)
```bash
ssh taktak-vps 'bash -s' < deploy/vps-audit.sh > vps-audit-output.txt
```
`deploy/vps-audit.sh` is read-only (no writes, no restarts, no secrets printed). It inventories: OS, CPU/RAM/disk, Docker containers & compose projects, listening ports, nginx vhosts/server_names, TLS certs, Node/PM2, systemd services, databases, app directories, firewall, cron/backups, monitoring.

Send the output back (or attach it to the next message) and this document will be completed with: existing live projects, conventions in use (Docker vs PM2 vs systemd), free ports, the sub-domain to use, and whether a Postgres instance already exists.

## Provisional deployment design (works regardless of findings)
- Fully isolated stack: own Docker Compose project `gasman-tms` (own Postgres volume, own network).
- Only one port exposed, **bound to 127.0.0.1** (`WEB_PORT`, default 8480 — change if taken).
- Existing host nginx terminates TLS and proxies a new sub-domain to that port (`deploy/nginx-host-site.conf`) — no change to other vhosts.
- If the server uses PM2/systemd instead of Docker, the API bundle (`apps/api/dist`) runs with `node dist/server.js` and the web `dist/` is served by nginx; see `04-deployment.md`.

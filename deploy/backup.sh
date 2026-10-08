#!/usr/bin/env bash
# Nightly logical backup of the demo database (keep 14 days). Add to cron: 15 2 * * * /opt/gasman-tms/deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
docker compose exec -T db pg_dump -U gasman gasman_tms | gzip > "backups/gasman_tms_$(date +%F).sql.gz"
find backups -name 'gasman_tms_*.sql.gz' -mtime +14 -delete

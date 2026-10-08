#!/usr/bin/env bash
# Restores the seeded demo data inside the running api container. Safe by design: the CLI refuses unless APP_ENV=demo and --yes is passed.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T api node dist/seed/cli.js reset --yes

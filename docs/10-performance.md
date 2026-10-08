# 10 — Performance

## Method
`npm run db:seed-load` into a scratch database, then `node scripts/bench.mjs` against an API pointed at it (single machine, API + PostgreSQL + load generator sharing 1 vCPU-class box, so numbers are conservative).

Fixture: **80,000 trips**, 2,000 users, 1,500 drivers, 400 vehicles, **250,000 vouchers / 500,000 ledger lines**, plus the full demo data set.

## Results (sequential, p50 / p95 ms)
| Endpoint | p50 | p95 |
|---|---|---|
| Dashboard (cached 4 s; cold ≈ 350) | 4 | 343 |
| Trips list (page of 20) | 35 | 48 |
| Trips search | 47 | 68 |
| Vehicles list / Drivers list | 11 / 12 | 17 / 22 |
| Vouchers list, filtered by type + dates | 18 / 8 | 22 / 10 |
| Customer ledger / bowzer ledger | 59 / 29 | 71 / 36 |
| Receivable aging / invoices list | 5 / 7 | 9 / 11 |
| Inventory items / stock navigation matrix | 8 / 10 | 9 / 14 |
| Exceptions Center (13 live rules) | 24 | 67 |
| Trial balance / balance sheet / P&L / bowzer P&L (full-year scans of 500k lines) | 206 / 181 / 144 / 289 | 261 / 210 / 201 / 350 |
| Data-integrity check (full cross-checks) | 731 | 820 |

**Concurrency:** 60 virtual users, realistic mix, 15 s → **224 requests/s, p50 269 ms, p95 438 ms, 0 errors** on one Node process.

## What made the difference (found by profiling, then fixed)
1. Correlated `NOT EXISTS … IS NOT DISTINCT FROM` for "current document" defeated indexes → plain equality that uses `(vehicle_id, doc_type)` / `(driver_id, doc_type)` indexes (drivers list 503 → 12 ms).
2. List queries ran per-row lookups before paging → page the base table first, then look up only the visible rows.
3. Ledger aggregates for dashboards/credit checks → `account_balances` / `party_balances` maintained inside the posting transaction (exceptions 678 → 24 ms).
4. Trip search across five joined tables → semi-joins on small tables + trigram indexes (428 → 47 ms).
5. Dashboard scanned every trip → bounded to open trips and the recent window, with a partial index.

## Limits and next steps
* Reports that scan a whole fiscal year are 150–300 ms at 500k lines; at tens of millions add monthly summary tables (design is ready: balances are already per-account).
* GPS ingestion is batched and idempotent; a high-volume fleet should move positions to a partitioned table or TimescaleDB (documented, not needed for the demo).
* Frontend is code-split per page (largest chunk: charts, 111 kB gzip, loaded only on dashboards/reports).

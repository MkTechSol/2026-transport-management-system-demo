# 05 — Demo credentials (fictional)

All accounts are **synthetic** and exist only in the demo database. They are not GasMan employees.

**Password for every demo account:** `GasMan@Demo2026`

| Role | Email | What to try |
|---|---|---|
| Super Admin | `superadmin@gasman-demo.local` | Everything, incl. Users & Roles, audit log, **Reset demo data** |
| Transport Manager | `transport.manager@gasman-demo.local` | Full operations; view users; cannot manage users |
| Dispatcher | `dispatcher@gasman-demo.local` | Create/assign/dispatch trips, dispatch board |
| Fleet Manager | `fleet.manager@gasman-demo.local` | Vehicles, drivers, documents, maintenance, safety management |
| Driver | `driver@gasman-demo.local` | Mobile-style "My Trips": pre-trip check → start trip (own trip only) |
| Management (Viewer) | `management@gasman-demo.local` | Read-only dashboards/reports + CSV export |
| (extra) Dispatcher 2 | `dispatcher2@gasman-demo.local` | Second dispatcher for concurrency demos |

Security notes: accounts lock for 10 minutes after 5 wrong passwords; passwords are bcrypt-hashed; change the shared password and disable the quick-fill box (`pages/Login.tsx`) before any non-demo use. Never reuse these credentials outside the demo.

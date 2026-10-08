# 05 — Demo credentials (fictional)

All accounts are **synthetic** and exist only in the demo database. They are not GasMan employees.

**Password for every demo account:** `GasMan@Demo2026`

| Role | Email | Lands on | What to try |
|---|---|---|---|
| Super Admin | `superadmin@gasman-demo.local` | Control Tower | Everything: users & roles, audit, setup, approvals, **Reset demo data** |
| Transport Manager | `transport.manager@gasman-demo.local` | Control Tower | Operations, approvals (expenses, requisitions), manager mobile `/m`, finance read |
| Dispatcher | `dispatcher@gasman-demo.local` | Control Tower | Create/assign/dispatch trips, dispatch board, tracking |
| Dispatcher 2 | `dispatcher2@gasman-demo.local` | Control Tower | Second dispatcher for concurrency demos |
| Fleet Manager | `fleet.manager@gasman-demo.local` | Control Tower | Vehicles, drivers, documents, maintenance, safety |
| Accountant | `accountant@gasman-demo.local` | Control Tower | Vouchers, invoices, receipts, financial reports, bowzer accounts, vendors |
| Store & Procurement Manager | `store.manager@gasman-demo.local` | Control Tower | Inventory, stock vouchers, tyres, procurement, vendors |
| HR Manager | `hr.manager@gasman-demo.local` | Control Tower | Employees, attendance, leave, payroll (salaries visible only to payroll managers) |
| Driver | `driver@gasman-demo.local` | My Trips (phone) | Pre-trip check → start trip → fuel/expense (own trip only) |
| Management (Viewer) | `management@gasman-demo.local` | Control Tower | Read-only dashboards, reports, exceptions, assistant |

Login page has one-click role buttons (demo only). Permission matrix: `09-permissions.md`.

Security notes: accounts lock for 10 minutes after 5 wrong passwords; passwords are bcrypt-hashed; **change the shared password and remove the quick-fill buttons (`pages/Login.tsx`) before any non-demo use.** Never reuse these credentials elsewhere.

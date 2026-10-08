# 06 — Demo script and test plan

Password for all accounts: `GasMan@Demo2026` (see `05-demo-credentials.md`). Reset anytime: sidebar → *Reset demo data* (Super Admin).

## A. 30-minute client walk-through
| # | Role | Do this | Expect |
|---|---|---|---|
| 1 | Super Admin | Control Tower | live KPIs, finance tiles, bank reserves, credit watch, low stock, recent activity |
| 2 | Dispatcher | *Create Trip* → a distributor (e.g. Peshawar), 8 MT → *Create & assign* → best-fit vehicle/driver → Dispatch | trip reaches *Dispatched*; vehicle/driver reserved |
| 3 | Driver (phone) | My Trips → Pre-trip check → Start trip (meter reading) | *In transit*, simulated GPS moves |
| 4 | Dispatcher | Live Tracking → find the trip; copy the customer tracking link | public page `/track/…` works without login |
| 5 | Driver | Add fuel and a toll expense | fuel validated vs norm; small expense auto-approved; large one waits for approval |
| 6 | Transport Manager (phone `/m`) | Approve the pending expense with one tap | status changes; audit entry |
| 7 | Dispatcher | Move the trip to Delivered (POD) → Completed (end meter) | invoice appears automatically; ledger posted |
| 8 | Accountant | Invoices → open the new invoice → *Receive payment* | invoice PAID; receivable and bank balances move |
| 9 | Accountant | Vouchers → New → Cash payment (F10) → Financial Reports → Trial balance, Bowzer P&L | balances; every row drills to its voucher |
| 10 | Accountant | Customers → Bowzers → open a bowzer | its income, costs, profit and ledger |
| 11 | Store manager | Inventory → New stock voucher → Parts replacement on a bowzer | stock leaves store, sits on bowzer; cost hits that bowzer's account |
| 12 | Store manager | Tyres → wheel map → fit a tyre | register, history and stock agree |
| 13 | Store manager | Procurement → requisition → (Manager approves) → quotations → order → receive goods | PO status partial/received; vendor payable posted |
| 14 | HR manager | HR & Payroll → attendance, leave, payroll draft → submit | Super Admin approves in Approvals; voucher posted; pay from bank |
| 15 | Super Admin | Exceptions Center; *Ask GasMan* ("Who owes us the most?") | live findings; assistant labelled as rule-based |
| 16 | Super Admin | Setup → Data integrity | all checks green |
| 17 | Management (viewer) | Try to create/edit anything | read-only; API also refuses |

## B. Break-it checklist (what a sceptical client will try)
* Assign a vehicle with an expired document or in maintenance → blocked with a reason.
* Two dispatchers assign the same vehicle at once → one wins, the other gets a clear conflict.
* Unbalanced journal voucher → refused in UI and API (and by the database).
* Issue more stock than a store holds → refused with quantities in the message.
* Receipt larger than invoice allocation → refused; void a paid invoice → refused.
* Post into a closed fiscal year → refused.
* Dispatcher opens `/finance/vouchers` by URL → no access; API returns 403.
* Driver tries another driver's trip → 403.
* Wrong password 5× → locked 10 minutes.
* Expense above the limit → approval; approver of the wrong role → 403.
* Payroll rebuilt after submission → refused; paid before approval → refused.

## C. Automated tests (all green at hand-over)
| Suite | What it proves | Count |
|---|---|---|
| `tests/auth-rbac` | login, lockout, refresh rotation, permission matrix, driver scoping | 10 |
| `tests/workflow` | trip lifecycle, assignment rules, concurrency, idempotent events | 11 |
| `tests/economics` | freight/income gating, expenses & approvals, fuel validation, auto-invoice on completion | 12 |
| `tests/finance` | ledger balance, DB trigger, receipts/credit notes, void rules, finance RBAC | 10 |
| `tests/inventory` | stock rules, negative-stock check, serial tyres, procurement flow, reports, RBAC | 10 |
| `tests/people-insights` | payroll flow, leave approval, exceptions, assistant, setup integrity, trip vouchers | 7 |
| `tests/shared` | shared logic + seed determinism and referential integrity | 5 |
| **API total** | `cd apps/api && npx vitest run` | **65** |
| `e2e/demo-flow.mjs` | 39 browser steps across 8 roles incl. phone viewport, zero console/server errors | 39 |

Run e2e: `npm i -D playwright-core`, then `BASE_URL=http://127.0.0.1:5173 CHROMIUM=/path/to/chrome node e2e/demo-flow.mjs`.

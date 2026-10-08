# 08 — Old-system gap analysis

**Purpose:** GasMan's current software is a set of separate systems (finance uses one, operations another). The new product is **one unified system with roles and permissions**. This document maps every old-system module we have seen to where it lives in the new system, and lists what is *new*.

**Evidence base (be aware):** the old-system modules were reviewed from the screenshot set `old_tranaport_SS.zip` plus the verbal clarifications recorded in `07-client-feedback-log.md`. We have **not** yet received the full old system, its data, or its reports as files. Items marked 🟡 are implemented from the description we have and must be re-checked against real screens/reports once received. Nothing here uses GasMan data — every figure in the demo is synthetic.

Legend: ✅ implemented and tested · 🟡 implemented, needs client confirmation · ⬜ not in demo scope (reason given)

## 1. Trip Voucher menu
| Old module | New location | Status | Notes |
|---|---|---|---|
| Trip Start | Trip → Start dialog (meter reading, loaded MT, uplift voucher no.) + **Trip Vouchers → Trip start vouchers** | ✅ | Pre-trip safety check can be switched off in Settings (assumption: client to confirm). |
| Uplifting Voucher | Trip type *Uplifting* (gas field → plant) + **Trip Vouchers → Uplifting vouchers** | ✅ | Shows loaded vs received MT and shortage. |
| Trip Expense Voucher | Trip → Expenses tab, **Trip Expenses** screen, **Trip Vouchers → Trip expense vouchers**, auto-posting to the ledger | ✅ | Auto-approve limit and approver by amount are configurable (Settings → approval rules). |
| Tour Stay Details | Expense category *Tour stay* with nights; **Trip Vouchers → Tour stay details** | ✅ | |
| Trip Completion | Trip → Complete (end meter) + **Trip Vouchers → Trip completion**; completion raises the freight invoice | ✅ | Printable single-trip voucher at `/trips/:id/voucher`. |
| Trip reports | Trip Vouchers hub, Reports hub (trip profitability, owner P&L, fuel efficiency, expense summary), driver summary | ✅ | |
| Fuel entry / validation | **Fuel** (km-per-litre check against the bowzer norm, exception review) | ✅ | Variance threshold in Settings. |

## 2. Setup / master data
| Old module | New location | Status |
|---|---|---|
| Suppliers / vendors | **Vendors** (categories: supplier, transporter, workshop, fuel station, refinery, service) | ✅ |
| Transporters | Vendors → category *Transporter* | ✅ |
| Banks | Finance → Accounts & Banks → Banks (each bank is a ledger account) | ✅ |
| Fiscal year / session | Finance → Accounts & Banks → Fiscal years (open/close; posting blocked in closed years) | ✅ |
| Chart of accounts (levels) | Finance → Accounts & Banks → Chart of accounts (4 levels, heading vs posting accounts) | ✅ |
| Items, category, sub-category, brand, made-in | Inventory → Items and *Categories & brands* | ✅ |
| Warehouses | Inventory → Stores | ✅ |
| Refineries / gas fields | Plants & Locations (type *Field*) | ✅ |
| Locations | Plants & Locations | ✅ |
| Routes / fare per MT | Routes & Freight | ✅ |
| Staff / employees | **HR & Payroll** → Employees | 🟡 |
| States / regions | Setup → States & regions | 🟡 (static list; client to confirm the regional hierarchy they use) |
| Trip expense definition | Setup → Trip expense definitions (defaults, receipt expected, active) | 🟡 (categories fixed because each maps to a ledger account) |
| Settings / backup / utilities | Settings, Setup → Data integrity, Backup & utilities (guidance) | ✅ / 🟡 (backup runs via `deploy/backup.sh`, not from the UI) |

## 3. Accounts
| Old module | New location | Status |
|---|---|---|
| Cash payment / cash receipt vouchers | Finance → Vouchers (F10 saves) | ✅ |
| Bank payment / bank receive vouchers | Finance → Vouchers | ✅ |
| Journal voucher | Finance → Vouchers | ✅ (database refuses unbalanced entries even if the app is bypassed) |
| Expense voucher | **Bowzer expense voucher** (charged to a bowzer's account) | ✅ |
| Account ledger | Financial Reports → Account / bowzer / party ledger (opening balance, running balance, drill to voucher) | ✅ |
| Trial balance | Financial Reports → Trial balance | ✅ |
| Day book, cash book | Financial Reports → Day book / Cash book | ✅ |
| Cash flow | Financial Reports → Cash flow (by counter-account) | 🟡 |
| Expense report | Financial Reports → Expense report | ✅ |
| Bank balance / payment / receive reports | Bank balances report; voucher registers for bank payment / bank receive | ✅ |
| Payable / receivable | Payables by vendor; Receivable aging | ✅ |
| Aging / invoice aging | Receivable aging, Invoice aging | ✅ |
| Profit & loss, balance sheet | Financial Reports (balance sheet shows a zero check line) | ✅ |
| Item-wise profit/loss | **Route profit & loss** (the freight business sells lanes, not items) and **Bowzer profit & loss** | 🟡 interpretation to confirm |
| Chart of accounts report | Financial Reports → Chart of accounts | ✅ |
| JV / cash payment / cash receipt reports | Voucher registers (filter by type, date, bowzer, party) | ✅ |

## 4. Sales (no POS — vouchers only)
| Old module | New location | Status |
|---|---|---|
| Sale order | Sales & Invoicing → Sales orders (open → invoiced/cancelled) | ✅ |
| Sale invoice | Invoices (auto-created when a trip completes; manual invoices; billing queue for exceptions) | ✅ |
| Sale return | Credit note (optionally settles a referenced invoice) | ✅ |
| Multi-invoice printing | Select invoices → *Print selected* (one per page) | ✅ |
| Monthly sale / pending orders | Monthly sales report; Sales orders filtered *Open* | ✅ |
| Customer ledger / credit control | Customers → Distributors & marketers: balance, overdue, credit-limit meter and alerts | ✅ |
| POS | Out of scope by client decision | ⬜ |

## 5. Inventory (vehicle-centred, as clarified by the client)
| Old module / meaning | New location | Status |
|---|---|---|
| "Customers = bowzers" | **Customers → Bowzers**: each bowzer is its own account (income, fuel, repairs, tyres, parts, profit, ledger) | ✅ |
| Items fitted per bowzer ("5 cameras in A, 3 in B") | Stock can be held in a store **or fitted to a bowzer**; Bowzer fitment matrix; Vehicle-wise inventory; Bowzer → Inventory & tyres tab | ✅ |
| Fuel changes | Fuel by bowzer report, Fuel screen, bowzer tab | ✅ |
| Tyre changes | Tyre register (serial-tracked), wheel map per bowzer, Tyre changes report, tyre fit/swap voucher | ✅ |
| Spare-part replacement | **Parts replacement voucher** (new part in, old part scrapped/returned/retreaded), history report, job-card link from Maintenance | ✅ |
| Navigation (transfer) voucher | Stock voucher *Navigation (transfer)* between stores and bowzers | ✅ |
| Purchase order / purchase / purchase return | Procurement (requisition → approval → quotations → PO → goods receipt) and stock vouchers *Purchase*, *Purchase return* | ✅ |
| Item ledger | Inventory Reports → Item ledger | ✅ |
| Stock navigation report | Inventory Reports → Stock navigation (item × store/bowzer matrix) | ✅ |
| Inventory summary / stock / stock value | Inventory summary, Stock value by category | ✅ |
| Check item stock | Inventory Reports → Check item stock | ✅ |
| Low-stock | Low-stock report, dashboard widget, exceptions | ✅ |

## 6. Dashboard widgets
Bank reserves ✅ · Check balance (cash and bank) ✅ · Low stock ✅ · Activity (recent trip activity) ✅ · Receivables & credit watch ✅ (new).

## 7. New in the unified system (not in the old tools)
Role-based access across all modules (9 roles, server-enforced) · single audit trail · approval engine with amount-based approvers · live GPS simulation and map · customer tracking link · driver mobile flow · **Exceptions Center** · **demo assistant** (rule-based, labelled) · **manager mobile home** with one-tap approvals · bowzer P&L and owner/partner statements · double-entry ledger that every module posts into · data-integrity checks · running-balance tables for speed · F10-to-save everywhere.

## 8. Open questions for GasMan (answers change the model)
1. Chart of accounts: real code structure and levels?
2. Sales tax on freight (rate, who is registered)?
3. Does a bowzer owner (partner) receive a statement? Basis (profit share, fixed rent)?
4. Payroll rules: working days, overtime, advances, statutory deductions?
5. Costing: is moving-average acceptable for stock, or FIFO?
6. Retread and tyre-life policy (km limits)?
7. Approval limits and who approves what.
8. Which old reports must print identically (layout)?

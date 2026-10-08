# 11 — Assumptions, limitations, and what to confirm

## Assumptions made (all configurable or easy to change)
1. Company name, plants, distributors, vehicles, drivers, money — **synthetic**. No GasMan confidential data is used or invented as fact.
2. Currency PKR, time zone Asia/Karachi, fiscal year 1 July – 30 June (session names like 2026-27).
3. Freight tariff in the demo is a synthetic function of distance; real rates come from the client's route table.
4. Sales tax on freight defaults to 0 % (Settings → Finance).
5. Pre-trip safety check is required before a trip starts (can be switched off in Settings).
6. Expenses ≤ PKR 5,000 auto-approve; above goes to an approver by amount (Settings → approval rules).
7. Moving-average stock costing; opening fitments on bowzers are part of the bowzer's carried-forward cost (no ledger entry).
8. Payroll: absence deduction = basic ÷ 30 per absent day; trip bonus per completed trip; no statutory deductions modelled.
9. One tenant per deployment.

## Known limitations of the demo
* **GPS is simulated** (clearly labelled); real devices will post to the batch endpoint.
* The assistant is rule-based and labelled so; it answers a fixed set of question types.
* Notifications are in-app only (no SMS/WhatsApp/email delivery yet; the contact fields are stored).
* Print layouts are generic (browser print), not replicas of the old reports.
* Stock voucher *void* is not offered — corrections are made with an adjustment, return or reverse transfer (keeps the audit trail honest).
* Tax invoices for FBR/PRA are not implemented.
* VPS deployment not performed (no access from the build environment).
* Map tiles use public OpenStreetMap in the demo; production should use a licensed tile provider.

## What we need from GasMan to move from demo to production
Real chart of accounts and opening balances · tariff table · approval limits · payroll policy · customer/vendor/vehicle/driver masters · old-system report layouts · tyre and maintenance policies · GPS device model · decision on tax invoicing.

## Dependency audit (`npm audit`)
Production dependencies report 4 *moderate* advisories, all one chain: `uuid` < 11.1.1 (missing buffer bounds check in `v3/v5/v6` when a caller passes a `buf`) pulled in by `sequelize`. The API only uses Sequelize for connection pooling and never calls uuid with a caller-supplied buffer, so the advisory is not reachable. The suggested "fix" downgrades Sequelize to 3.x, which would break the application; we track the upstream release instead. Re-run `npm audit` before go-live.
Including dev dependencies, `npm audit` lists further advisories (test runner, bundler and dev-server tooling such as vitest/esbuild/braces). These packages are **not** in the production images (the API image installs runtime dependencies only; the web image serves static files from nginx) and the dev server must never be exposed to a network. They will be bumped as part of routine dependency maintenance before production.

## Multi-drop and custom roles
- Stop tariffs default to the direct origin→stop rate; the trip-level rate is a rounded weighted average (income reports can differ from invoices by a few rupees — invoices use exact per-stop amounts).
- Gas not delivered at a skipped stop stays on board; there is no return-load or re-delivery workflow yet. Stops are served strictly in order.
- Seeded history converts some completed trips to multi-drop on their original direct path; trips created in the app use composite routes.
- Custom roles borrow workflow behaviour from a built-in "works like" role; approver routing can only name built-in roles.

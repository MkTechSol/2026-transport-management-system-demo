# 00 — Discovery & audit

_Status: Phase 1 complete for the Figma material and public research; the VPS audit is **blocked on access** (see 01)._

## Legend
**CONFIRMED** = verified from a source we could read · **ASSUMPTION** = reasonable demo choice, *not* a GasMan rule · **NEEDED** = must come from GasMan.

## A. Design audit

### Material received
| Source | What it is | How it was used |
|---|---|---|
| **Design 1** — `Transport_management_system.zip` | 130 PNG exports of the Figma file, folders `02`–`28`, cover slide *"GHOURI Transport Service (Pvt) Ltd — Enterprise Transportation & Logistics ERP · 106 production screens"* | Visual language, shell, module map, dashboard/dispatch/tracking/roles patterns |
| **Design 2** — two zips of browser screenshots of the Figma **Make** interactive prototype | Login, Control Tower, Trip Management → Trip detail (11-step lifecycle + tabs), Approvals, HR, Reports (+ simulated-AI modal), "Reset Demo Data" | Interaction patterns, trip lifecycle/tab structure, demo conventions |
| Figma links | Not reachable from the build environment (connector blocked, login required) | Screens were taken from the exports instead |

**Direction from the client side:** the GHOURI branding/data is a dummy; it is replaced by GasMan. The demo is **a Transport Management System, not an ERP** — Finance, HR, Procurement, Inventory, Tyres, Sales, Approvals and the AI assistant are out of scope for this demo.

> Honesty note: all 130 exported files were inventoried by folder/filename; ~14 key screens (shell, control tower, dispatch, tracking, roles matrix, trip detail, approvals, reports) were inspected in detail. Anything not visible there is marked as an assumption.

### Common shell (both designs)
Royal-blue top bar (global search ⌘K, "Quick Create", bell, user), deep-navy sidebar with grouped modules, light canvas, white cards, blue primary buttons, status pills (blue=in transit, red=delayed, green=delivered/completed, amber=pending, purple=at customer), breadcrumbs, KPI tile rows, tables with pagination + "Showing x of y", right-hand detail drawers, "client demo mode" banner, "Reset demo data".

### Mapping: Figma → route → module → data → actions
| Figma screen(s) | Route | Module | Required data | Key actions | Demo scope |
|---|---|---|---|---|---|
| 02 Authentication, Design 2 login (fictional creds box) | `/login` | Auth | users, roles | sign in, demo-credential quick-fill | ✅ |
| 03 ERP Shell / Enterprise navigation | layout | Shell | permissions | global search, notifications, role-aware nav | ✅ |
| 04 Executive / Operational Control Tower | `/` | Dashboard | trips, vehicles, drivers, docs, maintenance, incidents | KPIs, live trips, alerts, charts, plant filter | ✅ (finance tiles dropped) |
| 05 Transportation: dashboard, trip management, trip detail, create/add trip, route & load, trip summary, states | `/trips`, `/trips/new`, `/trips/:id` | Trips | trips, routes, events | create, edit, assign, status lifecycle, hold/cancel, POD | ✅ |
| 05 Trip requests | `/trips` (Draft/Planned) | Trips | — | folded into Draft → Planned | ✅ simplified |
| 05 Trip fuel / trip expenses, 10 Fuel, 11 Expenses | — | — | — | — | ⏭ Phase 2 |
| 06 Dispatch board / control center | `/dispatch` | Dispatch | trips by status, candidates | kanban, recommended vehicle + explanation, conflict banners | ✅ |
| 07 Fleet (vehicles, add vehicle, documents & expiries, maintenance history, health) | `/fleet`, `/fleet/:id` | Fleet | vehicles, documents, maintenance | CRUD, document renew, schedule maintenance | ✅ |
| 08 Drivers (list, add & compliance, 360) | `/drivers`, `/drivers/:id` | Drivers | drivers, documents, incidents | CRUD, compliance, performance | ✅ |
| 09 Tracking (live control center, live map) | `/tracking` | Tracking | positions | map, vehicle list, selected-vehicle panel, exceptions | ✅ simulated GPS |
| 12 Workshop (dashboard, PM, job cards) | `/maintenance` | Maintenance | maintenance_records | schedule, start, complete, cancel | ✅ simplified (no parts/job-card BOM) |
| 17 Customers (list, 360, create) | `/distributors` | Distributors | distributors, trips | CRUD, delivery history | ✅ (credit/invoices dropped) |
| 21 Notifications | `/notifications` | Notifications | notifications | read/unread, deep links | ✅ |
| 22 Reports | `/reports` | Reports | all | 8 live reports, filters, CSV | ✅ |
| 23 Settings: users, roles & permission matrix, security | `/users` | Admin | users, roles | user CRUD, permission matrix | ✅ (approval rules dropped) |
| 28 Exceptions | dashboard alerts + `/safety` | Safety | incidents, docs | alerts, incident log | ✅ |
| 24 Driver Mobile, 26 Manager Mobile | `/driver` (responsive web) | Driver home | assigned trips | pre-trip check, start, deliver, report incident | ✅ web; native app later |
| 13 Inventory, 14 Tyres, 15 Procurement, 16 Sales, 18 Finance, 19 HR, 20 Approvals, 27 AI | — | — | — | — | ⏭ out of scope (ERP) |

### Inconsistencies between the two designs (and how they were resolved)
| # | Design 1 | Design 2 | Decision |
|---|---|---|---|
| 1 | Trip ids `TRP-2026-00125`, vehicles `GTS-104` | Trip ids `TR-1041`, vehicles `C-9814`/`LES-4421` | Use `TRP-YYYY-NNNN` and fleet codes `GAS-BZ-NNN` |
| 2 | Status chip set: Unassigned/Ready/Assigned/Dispatched/In Transit/At Customer/Delayed | 11-step lifecycle: Pending approval → Approved → Planning → Vehicle → Driver → Dispatched → In transit → Delivered → POD → Closed → Settled | Single lifecycle in `tripMachine.ts`: Draft → Planned → Assigned → Dispatched → In Transit → Arrived → Delivered → Returning → Completed (+ Delayed, On Hold, Cancelled). Approval/finance steps are ERP scope. |
| 3 | Nav: "Control Towers, Transportation, Trip Requests, Dispatch…" | Nav: "Control Tower, Trip Management, Approvals, Sales, Procurement…" | TMS-focused nav (Operations / Resources / Compliance & Safety / Insights / Administration) |
| 4 | Customer = industrial gas customer (cement, refineries) | same | Customer = LPG **distributor** |
| 5 | Money (PKR revenue/profit) on dashboards | same | Not shown — no commercial data in a TMS demo |

### Missing states the build adds
Loading skeletons, empty states, error states with retry, validation errors, permission-denied page, offline-tiles map fallback, confirm dialogs, success/error toasts, mobile/tablet layouts.

## B. Public business audit
Searches run during the build could **not** find a public page for a company called *GasMan* or a plant called *Osakai*. Therefore **every GasMan-specific statement below comes from the client brief and is unverified by us**.

| Statement | Class |
|---|---|
| GasMan Pvt Ltd is an LPG marketer/distributor operating in KPK, Punjab, AJK and northern areas | NEEDED (brief only; not independently verified) |
| Plants at Dhurnal and Osakai; ~20 owned + 6 hired bowzers | NEEDED (brief only) |
| **Dhurnal** is a real LPG plant location in Pakistan (e.g. PSO operates an LPG plant there) | CONFIRMED ([PSO – LPG](https://psopk.com/en/fuels/gaseous-fuels/liquefied-petroleum-gas)) |
| LPG in Pakistan is moved by road **bowzers** (bulk tankers) licensed by OGRA | CONFIRMED ([PSO bowser list](https://psopk.com/documents/lpg/LPG-Bowser-List.pdf), [ProPakistani](https://propakistani.pk/2025/01/19/ogra-enforces-strict-safety-standards-for-manufacturing-of-lpg-bowsers/amp/)) |
| OGRA limits a newly manufactured bowzer to 30 MT (excl. 15 % allowance) | CONFIRMED (same ProPakistani article) → demo capacities 10–22 MT are within it |
| Marketers sell through distributor networks (Lub Gas 437, Mehran 142, PPGL 400+) | CONFIRMED (marketer sites, e.g. [Lub Gas](https://ag.com.pk/lub-gas/)) — GasMan's own count is NEEDED |
| Coordinates of Osakai / Dhurnal / cities | ASSUMPTION — approximate, map demo only |
| Required documents (registration, insurance, fitness, route permit, tank pressure test, driver licence, medical, LPG handling cert) | ASSUMPTION — typical for hazmat haulage |
| Pre-trip safety checklist content & "must pass before departure" rule | ASSUMPTION |
| Round-trip occupancy window = out + back + 2 h turnaround | ASSUMPTION |
| On-time = arrival ≤ 15 min after plan; expiring soon = ≤ 30 days; delayed alert = ETA > plan + 30 min | ASSUMPTION |
| Synthetic route geometry (curved line between points, ×1.28 road factor) | ASSUMPTION — replace with a routing provider |
| Real customer/distributor names, phones, registration numbers | **Not used.** All seed data is fictional. |

## C. Client requirements still needed
1. Real plants/terminals/depots, loading-bay model, and whether bowzers load at one bay or several.
2. Trip lifecycle actually used (is there approval? weighbridge? POD paper?) and who may do each step.
3. Load model: tonnes vs litres, compartments, partial deliveries / multi-drop, cylinders vs bulk.
4. Document list & validity rules per vehicle/driver; regulatory checks (OGRA licence, hydro-test cadence).
5. Tracking hardware (existing GPS vendor? API?) and event types (overspeed, geofence, long-stop).
6. Mobile app scope (offline needs, languages — Urdu), user counts per role (**sizing**).
7. Hired-vehicle contracts and how hired carriers are onboarded.
8. Old-system screens/video (→ `08-old-system-gap-analysis.md`).

## D. Product objective → how the demo covers it
Plant → trip planning → bowzer → driver → route → load → dispatch → in transit → checkpoints → arrival → delivery (POD) → return → completion → reporting: **all implemented and clickable**; see `06-demo-test-plan.md`.

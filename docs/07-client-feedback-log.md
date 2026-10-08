# 07 — Client feedback log

One entry per piece of feedback. Convert **confirmed** items into requirements; keep rejected ones for traceability.

```
## Feedback #001
Date:
Source:              (name / meeting / email / screenshot file)
Module:
Problem:
Client expectation:
Current behavior:
Decision:            (accept / defer / reject / needs clarification) + rationale
Action:              (ticket / PR / doc change)
Status:              (new / planned / in progress / done / won't do)
```

---
## Feedback #001
Date: _recorded during build_
Source:              Initial brief (GasMan TMS, roles, seed data, docs, VPS, two Figma links, zip)
Module:              All
Problem / request:   Build a realistic working system; start with discovery.
Decision:            Accept
Action:              Discovery (`00-discovery.md`); VPS audit script delivered because the server was unreachable from the build environment.
Status:              done (VPS pending access)

---
## Feedback #002
Date: _recorded during build_
Source:              Message: "No ERP style demo… the Ghouri design is dummy, use it as GasMan… performance first; mobile app later; hundreds–thousands of users"
Module:              Design / performance
Problem / request:   Treat the dummy brand as GasMan; seed our own data; performance is a first-order requirement.
Decision:            Accept
Action:              Renamed to GasMan; synthetic seed; load fixtures and benchmark (`10-performance.md`).
Status:              done

---
## Feedback #003
Date: _recorded during build_
Source:              Old-system screenshots (`old_tranaport_SS.zip`)
Module:              Old system
Problem / request:   Use these modules as must-haves; also keep the new Figma design complete.
Decision:            Accept
Action:              `08-old-system-gap-analysis.md` maps each module; Phases A–D implement them.
Status:              done (re-verify on real screens)

---
## Feedback #004
Date: _recorded during build_
Source:              Message: "These modules are must… new design complete plus these… update anything missing"
Module:              All
Problem / request:   Union of old modules and new design.
Decision:            Accept
Action:              Gap analysis lists both; new-only items called out.
Status:              done

---
## Feedback #005
Date: _recorded during build_
Source:              Message: no POS, only vouchers; "inventory" means vehicle fuel changes, tyre changes, spare parts, items fitted per vehicle
Module:              Sales / Inventory
Problem / request:   No POS. Inventory = what is fitted to / replaced on / consumed by each vehicle.
Decision:            Accept
Action:              Stock held by stores or bowzers; parts replacement, navigation, tyre register, fitment matrix, vehicle-wise reports (ADR 0003).
Status:              done

---
## Feedback #006
Date: _recorded during build_
Source:              Message: "customers means bowzers (vehicles)"
Module:              Customers
Problem / request:   Each bowzer is its own account.
Decision:            Accept (and keep distributor/marketer receivables)
Action:              Customers screen has Bowzers and Distributors & marketers tabs; bowzer dimension on every ledger line (ADR 0002).
Status:              done

---
## Feedback #007
Date: _recorded during build_
Source:              Message: "we will give them all vouchers, reports, everything… and new features in our design… add new ideas if you think of any"
Module:              All
Problem / request:   Complete voucher/report set plus new ideas.
Decision:            Accept
Action:              Voucher and report catalogue; new ideas: Exceptions Center, demo assistant, manager mobile, integrity checks, customer tracking link, bowzer P&L.
Status:              done

---
## Feedback #008
Date: _recorded during build_
Source:              Message: "they use different systems — finance has one, others another; we will give them one unified system with roles and permissions"
Module:              Architecture
Problem / request:   Single product, role-based modules.
Decision:            Accept
Action:              One ledger and one RBAC model across operations, finance, stores, HR (ADR 0002).
Status:              done

---
## Feedback #009
Date: _recorded during build_
Source:              Message: "add multiple trip destinations for one trip — a vehicle from A to B, C, D — and manage them properly everywhere"
Module:              Trips, dispatch, tracking, billing, reports
Problem / request:   One trip had exactly one destination.
Decision:            Accept
Action:              Multi-drop trips (up to 8 ordered delivery stops, `trip_stops`): per-stop quantity, ETA (incl. unloading time, setting `trip.stopDwellMin`), arrive / deliver / skip with POD, load-on-board checks, composite route and map markers, simulator pauses at each stop, one invoice per customer with a line per delivered stop, weighted trip freight rate, customer pages and reports count each drop, public tracking shows stop progress by city, POD register report. Uplifting trips stay single-destination.
Status:              done

---
## Feedback #010
Date: _recorded during build_
Source:              Message: "as super admin we can create roles and add proper permissions (checkboxes), select-all and category-wise"
Module:              Users & roles
Problem / request:   Roles were fixed in code.
Decision:            Accept
Action:              Users & roles → Manage roles (super admin only): create/edit/delete custom roles, tick permissions individually, per module or all at once. Enforced server-side (cache of a few seconds); built-in roles stay fixed (duplicate to customise); a role cannot be deleted while in use; nobody can assign a role with more access than their own.
Status:              done

---
## Template for new entries
```
## Feedback #NNN
Date: / Source: / Module: / Problem: / Client expectation: / Current behavior: / Decision: / Action: / Status:
```

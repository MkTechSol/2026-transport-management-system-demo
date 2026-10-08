# Role & permission matrix

> Generated from `packages/shared/src/permissions.ts` (`npm run docs:permissions`). The API enforces exactly this matrix on every endpoint; the UI only mirrors it.

| Module | Super Admin | Transport Manager | Dispatcher | Fleet Manager | Driver | Management (Viewer) | Accountant | Store & Procurement Manager | HR Manager |
|---|---|---|---|---|---|---|---|---|---|
| Control Tower | view | view | view | view | — | view | view | view | view |
| Vehicles / Bowzers | ✓ full | ✓ full | view | ✓ full | view | view | view | view | — |
| Drivers | ✓ full | ✓ full | view | ✓ full | view | view | view | — | view, create, edit |
| Plants & Locations | ✓ full | ✓ full | view | view | — | view | view | — | — |
| Routes & Freight | ✓ full | ✓ full | view | view | — | view | ✓ full | — | — |
| Customers | ✓ full | ✓ full | view | view | — | view | ✓ full | — | — |
| Trips | ✓ full | ✓ full | ✓ full | view | view | view | view | — | — |
| Dispatch | ✓ full | ✓ full | ✓ full | — | — | — | — | — | — |
| Trip Progress | update progress | update progress | update progress | — | update progress | — | — | — | — |
| Live Tracking | view | view | view | view | — | view | — | — | — |
| Fuel | ✓ full | ✓ full | view,  | ✓ full | view,  | view | view | — | — |
| Trip Expenses | ✓ full | ✓ full | view,  | view,  | view,  | view | view,  | view | — |
| Approvals | ✓ full | ✓ full | — | — | — | view | view,  | view | view,  |
| Workshop / Maintenance | ✓ full | ✓ full | view | ✓ full | — | view | — | ✓ full | — |
| Inventory | ✓ full | view | — | view | — | view | view | ✓ full | — |
| Tyres | ✓ full | view | — | ✓ full | — | view | — | ✓ full | — |
| Vendors | ✓ full | view | — | — | — | view | ✓ full | ✓ full | — |
| Procurement | ✓ full | view | — | — | — | view | view | ✓ full | — |
| Sales & Invoicing | ✓ full | ✓ full | — | — | — | view | ✓ full | — | — |
| Finance & Accounts | ✓ full | view | — | — | — | view | ✓ full | — | — |
| HR & Payroll | ✓ full | view | — | — | — | view | view, manage | — | ✓ full |
| Documents | ✓ full | ✓ full | view | ✓ full | view | view | — | — | ✓ full |
| Safety | ✓ full | ✓ full | view, report | ✓ full | report | view | — | — | — |
| Exceptions | view | view | view | view | — | view | view | view | view |
| AI Assistant |  |  |  |  | — |  |  |  | — |
| Reports | ✓ full | ✓ full | view | ✓ full | — | ✓ full | ✓ full | view | view |
| Settings | ✓ full | ✓ full | — | — | — | view | view | — | — |
| Audit Log | view | view | — | — | — | — | — | — | — |
| Users & Roles | ✓ full | view | — | — | — | — | — | — | — |

## Row-level scoping (beyond the matrix)

- **Driver**: only trips assigned to their own driver profile, their own profile and documents, and vehicles they are/were assigned to. Cannot see dashboard, reports, other drivers, users or audit data.
- **Dispatcher**: can progress trips (start, arrive, deliver, return, complete) on behalf of drivers from the control room.
- **Management (viewer)**: read-only everywhere they have access, plus report CSV export.
- **Super Admin only**: user management and the demo-data reset.

## Business rules enforced server-side (not permissions)

- A vehicle/driver cannot be assigned if: unavailable, in maintenance, inactive, double-booked in the time window, capacity < load, or a required document is missing / expired / expires before the trip ends.
- Trip status changes follow the state machine in `packages/shared/src/tripMachine.ts`; every change writes a trip event + audit entry.
- Starting a trip requires a passed pre-trip safety check (configurable, `REQUIRE_PRETRIP_CHECK`; **demo assumption**).

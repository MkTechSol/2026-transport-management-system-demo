# 02 — Market research (desk research, no client data)

**Honesty note:** this is a synthesis of how bulk-liquid / LPG road-haulage operators and common transport-management products are structured, written from general domain knowledge to guide the demo. We did not have web-search verification of GasMan's own operations (see `00-discovery.md`), and no competitor claims below are quoted from vendor sites. Treat it as a hypothesis list for the client workshop.

## What operators in this niche actually need
| Need | Why it matters for LPG bowzers | Where it lives in the system |
|---|---|---|
| Per-vehicle economics | Bowzers are costly assets, often partner-owned; owners want their own statement | Bowzer = account, bowzer P&L, owner statement data |
| Freight per MT per route | Revenue is tonnage × lane tariff, not an hourly rate | Routes & Freight, auto-invoice on completion |
| Uplifting vs delivery trips | Gas-field-to-plant legs are part of the cycle | Trip type, uplifting vouchers |
| Fuel control | Fuel is the largest variable cost and the largest leak | Km-per-litre validation, exception review |
| Compliance | Expired fitness / tank pressure test / insurance stops a vehicle | Documents, dispatch blocks, exceptions |
| Safety evidence | Hazardous cargo; incidents and pre-trip checks must be traceable | Pre-trip checklist, incidents, audit |
| Tyres and spares | Large recurring cost, theft/misuse risk | Serial-tracked tyres, parts replacement vouchers, fitted items per bowzer |
| Credit control | Distributors buy on credit | Credit limits, aging, alerts |
| One set of books | Operations, stores, HR and finance are usually separate tools | Unified ledger with role-based modules |

## Typical TMS building blocks (and our position)
Order/trip planning, dispatch board, vehicle & driver allocation, live tracking, proof of delivery, freight billing, fleet maintenance, fuel management, driver app, analytics. We include all of these. We deliberately did **not** build: route optimisation across many stops (LPG bowzers run point-to-point), carrier marketplaces, EDI, or POS.

## Design choices that follow from the research
* Rule-based exceptions rather than a black-box "AI" — managers need to know *why* something is flagged.
* Approvals by amount, because small expenses must not stall a driver at a toll plaza.
* Mobile-first driver flow and a manager mobile home: the people with the least desk time carry the most decisions.
* Keyboard-first data entry (F10 saves) because accountants and storekeepers enter vouchers all day.

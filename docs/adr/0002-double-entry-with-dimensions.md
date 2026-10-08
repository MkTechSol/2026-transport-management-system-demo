# ADR 0002 — One double-entry ledger with dimensions

**Decision:** every financial effect (trip expenses, invoices, receipts, stock, payroll) becomes a balanced voucher in one ledger. Lines carry **vehicle**, **party** and **trip** dimensions instead of separate sub-ledgers per module. Running balances (`account_balances`, `party_balances`) are updated in the posting transaction.

**Why:** the client wants each bowzer to behave as its own account, with customers and vendors alongside; dimensions give bowzer P&L, customer ledger and trip profit from one source of truth. A deferred trigger refuses unbalanced vouchers, so a bug elsewhere cannot corrupt the books.

**Alternatives rejected:** separate module tables with periodic export to accounting (drift, no single audit trail); per-bowzer chart-of-accounts branches (explodes the chart).

**Consequences:** reports are queries over `voucher_lines`; very large installations will need monthly summary tables (design noted in `10-performance.md`).

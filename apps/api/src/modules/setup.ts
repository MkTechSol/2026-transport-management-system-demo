import { Router } from 'express';
import { z } from 'zod';
import { REGIONS } from '@gasman/shared';
import { q, q1 } from '../db/sequelize';
import { notFound } from '../lib/errors';
import { parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';

/** Setup hub: master-data overview, trip expense definitions and a data-integrity check. */
export const setupRouter = Router();

setupRouter.get('/overview', requirePerm('settings:view'), wrap(async (_req, res) => {
  const [c] = await q(`SELECT (SELECT count(*)::int FROM locations WHERE type IN ('PLANT','TERMINAL','DEPOT','PARKING')) AS locations, (SELECT count(*)::int FROM locations WHERE type = 'FIELD') AS fields, (SELECT count(*)::int FROM routes WHERE active) AS routes,
      (SELECT count(*)::int FROM distributors WHERE customer_type = 'DISTRIBUTOR') AS distributors, (SELECT count(*)::int FROM distributors WHERE customer_type = 'MARKETER') AS marketers, (SELECT count(*)::int FROM vehicles WHERE archived_at IS NULL) AS bowzers,
      (SELECT count(*)::int FROM drivers) AS drivers, (SELECT count(*)::int FROM vendors WHERE active AND category <> 'TRANSPORTER') AS vendors, (SELECT count(*)::int FROM vendors WHERE active AND category = 'TRANSPORTER') AS transporters,
      (SELECT count(*)::int FROM banks WHERE active) AS banks, (SELECT count(*)::int FROM fiscal_years) AS fiscal_years, (SELECT count(*)::int FROM accounts) AS accounts, (SELECT count(*)::int FROM items WHERE active) AS items, (SELECT count(*)::int FROM item_categories) AS categories,
      (SELECT count(*)::int FROM brands) AS brands, (SELECT count(*)::int FROM warehouses WHERE active) AS warehouses, (SELECT count(*)::int FROM employees WHERE status = 'ACTIVE') AS employees, (SELECT count(*)::int FROM departments) AS departments,
      (SELECT count(*)::int FROM expense_definitions WHERE active) AS expense_types, (SELECT count(*)::int FROM users WHERE status = 'ACTIVE') AS users, (SELECT count(*)::int FROM approval_rules WHERE active) AS approval_rules`);
  res.json({ counts: c, regions: REGIONS.filter((r) => r !== 'SINDH') });
}));

setupRouter.get('/expense-definitions', requirePerm('expenses:view', 'expenses:record', 'settings:view'), wrap(async (_req, res) => res.json({ data: await q('SELECT category, label, default_amount::float AS default_amount, requires_receipt, active, note FROM expense_definitions ORDER BY label') })));
setupRouter.patch('/expense-definitions/:category', requirePerm('settings:manage'), wrap(async (req, res) => {
  const b = parse(z.object({ defaultAmount: z.coerce.number().min(0).max(10_000_000).optional(), requiresReceipt: z.boolean().optional(), active: z.boolean().optional(), note: z.string().trim().max(200).nullish() }), req.body);
  const row = await q1<any>(`UPDATE expense_definitions SET default_amount = COALESCE(:d, default_amount), requires_receipt = COALESCE(:r, requires_receipt), active = COALESCE(:a, active), note = COALESCE(:n, note) WHERE category = :c RETURNING *`,
    { d: b.defaultAmount ?? null, r: b.requiresReceipt ?? null, a: b.active ?? null, n: b.note ?? null, c: String(req.params.category).toUpperCase() });
  if (!row) throw notFound('Expense type');
  await audit(req, { action: 'EXPENSE_DEFINITION_UPDATED', entityType: 'SETTING', entityLabel: `${row.label}: default PKR ${row.default_amount}${row.active ? '' : ' (inactive)'}` });
  res.json({ definition: row });
}));

/** Cross-module consistency checks: the sub-ledgers must agree with the general ledger. */
setupRouter.get('/integrity', requirePerm('settings:view'), wrap(async (_req, res) => {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const unbal = await q1<any>('SELECT count(*)::int AS n FROM (SELECT voucher_id FROM voucher_lines GROUP BY 1 HAVING sum(debit) <> sum(credit)) x');
  add('Every voucher balances (debit = credit)', unbal.n === 0, unbal.n ? `${unbal.n} unbalanced voucher(s)` : 'All vouchers balance');
  const tb = await q1<any>(`SELECT COALESCE(sum(l.debit), 0)::float AS d, COALESCE(sum(l.credit), 0)::float AS c FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED'`);
  add('Trial balance agrees', Math.abs(tb.d - tb.c) < 0.005, `Debits ${tb.d.toLocaleString('en-US')} · credits ${tb.c.toLocaleString('en-US')}`);
  const ar = await q1<any>(`SELECT (SELECT COALESCE(sum(l.debit - l.credit), 0) FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED' WHERE l.account_id = (SELECT id FROM accounts WHERE system_key = 'receivable'))::float AS gl,
      (SELECT COALESCE(sum(total - paid), 0) FROM sales_invoices WHERE kind = 'INVOICE' AND status IN ('UNPAID','PARTIAL'))::float AS inv`);
  add('Receivables ledger = open invoices', Math.abs(ar.gl - ar.inv) < 1, `Ledger ${Math.round(ar.gl).toLocaleString('en-US')} · invoices ${Math.round(ar.inv).toLocaleString('en-US')}${ar.gl - ar.inv > 1 ? ' (difference is unapplied customer credit or an opening balance)' : ''}`);
  const inv = await q1<any>(`SELECT (SELECT COALESCE(sum(l.debit - l.credit), 0) FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED' WHERE l.account_id = (SELECT id FROM accounts WHERE system_key = 'inventory'))::float AS gl,
      (SELECT COALESCE(sum(b.qty * i.avg_cost), 0) FROM stock_balances b JOIN items i ON i.id = b.item_id WHERE b.holder_type = 'WAREHOUSE')::float AS stock`);
  add('Inventory ledger = stock in stores', Math.abs(inv.gl - inv.stock) < 5, `Ledger ${Math.round(inv.gl).toLocaleString('en-US')} · stock ${Math.round(inv.stock).toLocaleString('en-US')}`);
  const ty = await q1<any>(`SELECT (SELECT count(*) FROM tyres WHERE status = 'FITTED')::int AS reg, (SELECT COALESCE(sum(b.qty), 0) FROM stock_balances b JOIN items i ON i.id = b.item_id WHERE i.serialized AND b.holder_type = 'VEHICLE')::int AS bal`);
  add('Tyre register = tyres fitted in stock', ty.reg === ty.bal, `Register ${ty.reg} · stock ${ty.bal}`);
  const neg = await q1<any>('SELECT count(*)::int AS n FROM stock_balances WHERE qty < 0');
  add('No negative stock anywhere', neg.n === 0, neg.n ? `${neg.n} negative balance(s)` : 'No negative balances');
  const unposted = await q1<any>(`SELECT count(*)::int AS n FROM trip_expenses WHERE status IN ('APPROVED','REIMBURSED') AND voucher_id IS NULL`);
  add('Approved trip expenses are all in the ledger', unposted.n === 0, unposted.n ? `${unposted.n} approved expense(s) have no voucher` : 'All approved expenses are posted');
  const unbilled = await q1<any>(`SELECT count(*)::int AS n FROM trips WHERE status = 'COMPLETED' AND invoice_id IS NULL AND freight_per_mt > 0 AND bill_to_id IS NOT NULL`);
  add('Completed trips are all invoiced', unbilled.n === 0, unbilled.n ? `${unbilled.n} completed trip(s) await billing (see Billing queue)` : 'Nothing awaiting billing');
  const po = await q1<any>('SELECT count(*)::int AS n FROM purchase_order_lines WHERE received_qty > qty');
  add('No purchase order is over-received', po.n === 0, po.n ? `${po.n} line(s) over-received` : 'Receipts are within order quantities');
  const pay = await q1<any>(`SELECT count(*)::int AS n FROM payroll_runs WHERE status IN ('POSTED','PAID') AND voucher_id IS NULL`);
  add('Posted payroll runs have ledger vouchers', pay.n === 0, pay.n ? `${pay.n} run(s) missing a voucher` : 'All posted runs are in the ledger');
  const cash = await q1<any>(`SELECT COALESCE(sum(l.debit - l.credit), 0)::float AS b FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED' WHERE l.account_id = (SELECT id FROM accounts WHERE system_key = 'cash')`);
  add('Cash in hand is not negative', cash.b >= 0, `Cash book ${Math.round(cash.b).toLocaleString('en-US')}`);
  res.json({ ok: checks.every((c) => c.ok), ranAt: new Date().toISOString(), checks });
}));

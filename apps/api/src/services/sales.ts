import { q, q1, exec, sequelize } from '../db/sequelize';
import { badRequest, notFound, unprocessable } from '../lib/errors';
import type { AuthUser } from '../middleware/auth';
import { EXPENSE_CATEGORY_LABELS } from '@gasman/shared';
import { audit } from './audit';
import { accountId, fiscalYearFor, postVoucher, voidVoucher } from './ledger';
import { postHooks } from './hooks';
import { setting } from './settings';
import { notify } from './notify';

const r2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

export interface InvoiceLineInput { description: string; qty: number; unit?: string; rate: number; vehicleId?: number | null }
export interface InvoiceInput {
  customerId: number; date?: string; dueDays?: number; tripId?: number | null; orderId?: number | null; taxPct?: number; notes?: string; lines: InvoiceLineInput[];
  kind?: 'INVOICE' | 'RETURN'; refInvoiceId?: number | null; incomeKey?: string;
}

/** Customer receivable balance from the ledger (debit-positive). */
export async function customerBalance(customerId: number, tx?: any): Promise<number> {
  const r = await q1<{ b: number }>(
    `SELECT COALESCE(sum(l.debit - l.credit), 0)::float AS b FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED'
      WHERE l.party_type = 'CUSTOMER' AND l.party_id = :c AND l.account_id = (SELECT id FROM accounts WHERE system_key = 'receivable')`, { c: customerId }, tx);
  return r!.b;
}

export async function createInvoice(user: AuthUser | null, req: any, input: InvoiceInput, tx?: any): Promise<any> {
  if (!tx) return sequelize.transaction((t) => createInvoice(user, req, input, t));
  const kind = input.kind ?? 'INVOICE';
  if (!input.lines.length) throw badRequest('Add at least one invoice line.');
  const cust = await q1<any>('SELECT id, name, credit_limit_pkr, credit_alert_pct, credit_status, status FROM distributors WHERE id = :id', { id: input.customerId }, tx);
  if (!cust) throw notFound('Customer');
  const date = input.date ?? today();
  await fiscalYearFor(date, tx);
  const lines = input.lines.map((l, i) => {
    if (!(l.qty > 0) || l.rate < 0) throw badRequest(`Line ${i + 1}: quantity must be above zero and rate cannot be negative.`);
    return { ...l, unit: l.unit ?? 'MT', amount: r2(l.qty * l.rate) };
  });
  const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0));
  const taxPct = input.taxPct ?? (await setting<number>('finance.freightTaxPct'));
  const tax = r2(subtotal * taxPct / 100); const total = r2(subtotal + tax);
  if (total <= 0) throw badRequest('Invoice total must be above zero.');
  let trip: any = null;
  if (input.tripId) {
    trip = await q1<any>('SELECT id, code, trip_type, vehicle_id FROM trips WHERE id = :id', { id: input.tripId }, tx);
    if (!trip) throw notFound('Trip');
  }
  if (kind === 'INVOICE') {
    if (cust.credit_status === 'BLOCKED' && user) throw unprocessable(`${cust.name} is blocked for credit. Clear the dues or change the credit status before invoicing.`);
  }
  let ref: any = null;
  if (kind === 'RETURN' && input.refInvoiceId) {
    ref = await q1<any>(`SELECT * FROM sales_invoices WHERE id = :id AND kind = 'INVOICE' AND status <> 'VOID'`, { id: input.refInvoiceId }, tx);
    if (!ref || ref.customer_id !== input.customerId) throw unprocessable('The referenced invoice does not belong to this customer.');
  }
  const seq = await q1<{ n: number }>(`SELECT nextval('invoice_no_seq')::int AS n`, {}, tx);
  const invoiceNo = `${kind === 'RETURN' ? 'SR' : 'SI'}-${date.slice(2, 4)}-${String(seq!.n).padStart(5, '0')}`;
  const dueDate = addDays(date, input.dueDays ?? (await setting<number>('finance.paymentTermsDays')));
  const incomeKey = input.incomeKey ?? (trip?.trip_type === 'UPLIFTING' ? 'freight_uplift' : 'freight_delivery');
  const inv = await q1<any>(
    `INSERT INTO sales_invoices (invoice_no, kind, invoice_date, due_date, customer_id, trip_id, order_id, ref_invoice_id, subtotal, tax_pct, tax_amount, total, paid, status, notes, created_by)
     VALUES (:no, :kind, :d, :due, :c, :t, :o, :ref, :sub, :tp, :tax, :tot, 0, 'UNPAID', :n, :u) RETURNING *`,
    { no: invoiceNo, kind, d: date, due: dueDate, c: cust.id, t: input.tripId ?? null, o: input.orderId ?? null, ref: ref?.id ?? null, sub: subtotal, tp: taxPct, tax, tot: total, n: input.notes ?? null, u: user?.id ?? null }, tx);
  let n = 1;
  for (const l of lines) await exec(`INSERT INTO sales_invoice_lines (invoice_id, line_no, description, qty, unit, rate, amount, vehicle_id) VALUES (:i, :n, :d, :q, :u, :r, :a, :v)`,
    { i: inv.id, n: n++, d: l.description, q: l.qty, u: l.unit, r: l.rate, a: l.amount, v: l.vehicleId ?? trip?.vehicle_id ?? null }, tx);
  const sign = kind === 'RETURN';
  const income = await accountId(sign ? 'sales_returns' : incomeKey, tx);
  const party = { partyType: 'CUSTOMER' as const, partyId: cust.id };
  const vlines: any[] = [{ accountKey: 'receivable', [sign ? 'credit' : 'debit']: total, ...party, tripId: input.tripId ?? null, memo: invoiceNo }];
  for (const l of lines) vlines.push({ accountId: income, [sign ? 'debit' : 'credit']: l.amount, vehicleId: l.vehicleId ?? trip?.vehicle_id ?? null, tripId: input.tripId ?? null, memo: l.description });
  if (tax > 0) vlines.push({ accountKey: 'tax_payable', [sign ? 'debit' : 'credit']: tax, memo: `Sales tax ${taxPct}%` });
  const v = await postVoucher({ type: sign ? 'SALE_RETURN' : 'SALE_INVOICE', date, narration: `${sign ? 'Credit note' : 'Invoice'} ${invoiceNo} — ${cust.name}${trip ? ` (${trip.code})` : ''}`, lines: vlines, ...party, tripId: input.tripId ?? null, vehicleId: trip?.vehicle_id ?? null, sourceType: 'INVOICE', sourceId: inv.id, user }, tx);
  await exec('UPDATE sales_invoices SET voucher_id = :v WHERE id = :i', { v: v.id, i: inv.id }, tx);
  if (trip && kind === 'INVOICE') await exec('UPDATE trips SET invoice_id = :i WHERE id = :t', { i: inv.id, t: trip.id }, tx);
  if (input.orderId) await exec(`UPDATE sales_orders SET status = 'INVOICED' WHERE id = :o`, { o: input.orderId }, tx);
  if (sign) {
    // A credit note settles the referenced invoice (up to its outstanding amount); anything left stays as customer credit on the ledger.
    let applied = 0;
    if (ref) {
      applied = Math.min(total, r2(ref.total - ref.paid));
      if (applied > 0) {
        await exec(`INSERT INTO voucher_allocations (voucher_id, invoice_id, amount) VALUES (:v, :i, :a)`, { v: v.id, i: ref.id, a: applied }, tx);
        await exec(`UPDATE sales_invoices SET paid = paid + :a, status = CASE WHEN paid + :a >= total THEN 'PAID' ELSE 'PARTIAL' END WHERE id = :i`, { a: applied, i: ref.id }, tx);
      }
    }
    await exec(`UPDATE sales_invoices SET status = 'PAID', paid = :a WHERE id = :i`, { a: total, i: inv.id }, tx);
  }
  await audit(req, { action: sign ? 'CREDIT_NOTE_CREATED' : 'INVOICE_CREATED', entityType: 'INVOICE', entityId: inv.id, entityLabel: `${invoiceNo} · PKR ${total}`, tx });
  // Credit-limit watch (informational; the invoice is a legitimate claim for work already done).
  if (kind === 'INVOICE' && cust.credit_limit_pkr > 0) {
    const bal = await customerBalance(cust.id, tx);
    if (bal >= cust.credit_limit_pkr) await notify({ type: 'CREDIT_LIMIT', severity: 'CRITICAL', title: `${cust.name} is over its credit limit`, body: `Outstanding PKR ${Math.round(bal).toLocaleString()} vs limit PKR ${Number(cust.credit_limit_pkr).toLocaleString()}.`, roles: ['SUPER_ADMIN', 'ACCOUNTANT', 'TRANSPORT_MANAGER'], dedupeKey: `credit-over-${cust.id}-${date.slice(0, 7)}`, tx });
    else if (bal >= cust.credit_limit_pkr * cust.credit_alert_pct / 100) await notify({ type: 'CREDIT_LIMIT', severity: 'WARNING', title: `${cust.name} reached ${cust.credit_alert_pct}% of its credit limit`, body: `Outstanding PKR ${Math.round(bal).toLocaleString()} of PKR ${Number(cust.credit_limit_pkr).toLocaleString()}.`, roles: ['SUPER_ADMIN', 'ACCOUNTANT', 'TRANSPORT_MANAGER'], dedupeKey: `credit-warn-${cust.id}-${date.slice(0, 7)}`, tx });
  }
  return { ...inv, voucher_id: v.id, voucher_no: v.voucher_no };
}

export async function voidInvoice(user: AuthUser, req: any, id: number, reason: string) {
  return sequelize.transaction(async (tx) => {
    const inv = await q1<any>('SELECT * FROM sales_invoices WHERE id = :id FOR UPDATE', { id }, tx);
    if (!inv) throw notFound('Invoice');
    if (inv.status === 'VOID') throw unprocessable('Invoice is already void.');
    if (Number(inv.paid) > 0 && inv.kind === 'INVOICE') throw unprocessable('This invoice has receipts allocated. Void or reverse those receipts first.');
    if (inv.voucher_id) { await exec(`UPDATE vouchers SET status = 'VOID', void_reason = :r WHERE id = :v`, { r: reason, v: inv.voucher_id }, tx); }
    await exec(`DELETE FROM voucher_allocations WHERE voucher_id = :v`, { v: inv.voucher_id }, tx);
    await exec(`UPDATE sales_invoices SET status = 'VOID' WHERE id = :id`, { id }, tx);
    await exec(`UPDATE trips SET invoice_id = NULL WHERE invoice_id = :id`, { id }, tx);
    await audit(req, { action: 'INVOICE_VOIDED', entityType: 'INVOICE', entityId: id, entityLabel: `${inv.invoice_no}: ${reason}`, tx });
  });
}

export interface ReceiptInput { customerId: number; amount: number; mode: 'CASH' | 'BANK'; bankId?: number | null; date?: string; narration?: string; reference?: string; allocations?: { invoiceId: number; amount: number }[]; autoAllocate?: boolean }

export async function createReceipt(user: AuthUser | null, req: any, input: ReceiptInput, tx?: any): Promise<any> {
  if (!tx) return sequelize.transaction((t) => createReceipt(user, req, input, t));
  if (!(input.amount > 0)) throw badRequest('Receipt amount must be above zero.');
  const cust = await q1<any>('SELECT id, name FROM distributors WHERE id = :id', { id: input.customerId }, tx);
  if (!cust) throw notFound('Customer');
  let cashAcc: number;
  if (input.mode === 'BANK') {
    if (!input.bankId) throw badRequest('Choose the bank account that received the money.', { fields: { bankId: 'Required' } });
    const b = await q1<any>('SELECT account_id FROM banks WHERE id = :id AND active', { id: input.bankId }, tx); if (!b) throw notFound('Bank');
    cashAcc = b.account_id;
  } else cashAcc = await accountId('cash', tx);
  const date = input.date ?? today();
  let allocs = input.allocations ?? [];
  if (input.autoAllocate && !allocs.length) {
    const open = await q<any>(`SELECT id, total, paid FROM sales_invoices WHERE customer_id = :c AND kind = 'INVOICE' AND status IN ('UNPAID','PARTIAL') ORDER BY due_date, id FOR UPDATE`, { c: cust.id }, tx);
    let left = input.amount; allocs = [];
    for (const i of open) { if (left <= 0) break; const a = Math.min(left, r2(i.total - i.paid)); if (a > 0) { allocs.push({ invoiceId: i.id, amount: a }); left = r2(left - a); } }
  }
  const sum = r2(allocs.reduce((s, a) => s + a.amount, 0));
  if (sum > r2(input.amount)) throw unprocessable('Allocated amount is more than the receipt amount.');
  const v = await postVoucher({
    type: input.mode === 'BANK' ? 'BANK_RECEIVE' : 'CASH_RECEIPT', date, narration: input.narration ?? `Receipt from ${cust.name}${input.reference ? ` (${input.reference})` : ''}`,
    lines: [{ accountId: cashAcc, debit: input.amount, memo: input.reference }, { accountKey: 'receivable', credit: input.amount, partyType: 'CUSTOMER', partyId: cust.id }],
    partyType: 'CUSTOMER', partyId: cust.id, user,
  }, tx);
  for (const a of allocs) {
    const inv = await q1<any>(`SELECT * FROM sales_invoices WHERE id = :id AND kind = 'INVOICE' AND status IN ('UNPAID','PARTIAL') FOR UPDATE`, { id: a.invoiceId }, tx);
    if (!inv || inv.customer_id !== cust.id) throw unprocessable('An allocated invoice is not open for this customer.');
    if (a.amount > r2(inv.total - inv.paid)) throw unprocessable(`Invoice ${inv.invoice_no} only has PKR ${r2(inv.total - inv.paid)} outstanding.`);
    await exec(`INSERT INTO voucher_allocations (voucher_id, invoice_id, amount) VALUES (:v, :i, :a)`, { v: v.id, i: inv.id, a: a.amount }, tx);
    await exec(`UPDATE sales_invoices SET paid = paid + :a, status = CASE WHEN paid + :a >= total THEN 'PAID' ELSE 'PARTIAL' END WHERE id = :i`, { a: a.amount, i: inv.id }, tx);
  }
  await audit(req, { action: 'RECEIPT_POSTED', entityType: 'VOUCHER', entityId: v.id, entityLabel: `${v.voucher_no} · ${cust.name} · PKR ${input.amount}`, tx });
  return { voucher: v, allocated: sum, unallocated: r2(input.amount - sum) };
}

/** Auto-postings: approved trip expenses and completed trips feed the ledger without anyone re-keying them. */
export async function postExpense(e: any, tx?: any) {
  const t = await q1<any>('SELECT code, vehicle_id FROM trips WHERE id = :id', { id: e.trip_id }, tx);
  let date = String(e.incurred_on).slice(0, 10);
  try { await fiscalYearFor(date, tx); } catch { date = today(); }
  const fuel = e.fuel_entry_id ? await q1<any>('SELECT payment_mode, station FROM fuel_entries WHERE id = :id', { id: e.fuel_entry_id }, tx) : null;
  const onCredit = fuel?.payment_mode === 'CREDIT';
  const credit = onCredit ? 'payable' : 'cash';
  const vendor = onCredit && fuel.station ? await q1<any>('SELECT id FROM vendors WHERE name = :n', { n: fuel.station }, tx) : null;
  const v = await postVoucher({
    type: 'TRIP_EXPENSE', date, narration: `${t.code} · ${EXPENSE_CATEGORY_LABELS[e.category] ?? e.category}${e.description ? ` — ${e.description}` : ''}`,
    lines: [{ accountKey: `exp_${e.category}`, debit: e.amount, vehicleId: e.vehicle_id ?? t.vehicle_id, tripId: e.trip_id }, { accountKey: credit, credit: e.amount, vehicleId: e.vehicle_id ?? t.vehicle_id, tripId: e.trip_id, ...(vendor ? { partyType: 'VENDOR' as const, partyId: vendor.id } : {}) }],
    vehicleId: e.vehicle_id ?? t.vehicle_id, tripId: e.trip_id, sourceType: 'TRIP_EXPENSE', sourceId: e.id,
  }, tx);
  await exec('UPDATE trip_expenses SET voucher_id = :v WHERE id = :id', { v: v.id, id: e.id }, tx);
}

async function invoiceCompletedTrip(trip: any, tx?: any) {
  const t = await q1<any>(
    `SELECT t.id, t.code, t.trip_type, t.vehicle_id, t.bill_to_id, t.freight_per_mt, t.delivered_mt, t.loaded_mt, t.planned_load_mt, t.invoice_id, o.name AS origin, COALESCE(d.name, dl.name) AS dest
       FROM trips t JOIN locations o ON o.id = t.origin_location_id LEFT JOIN locations dl ON dl.id = t.destination_location_id LEFT JOIN distributors d ON d.id = t.distributor_id WHERE t.id = :id`, { id: trip.id }, tx);
  if (!t || t.invoice_id || !t.bill_to_id || !(Number(t.freight_per_mt) > 0)) return;
  const mt = Number(t.delivered_mt ?? t.loaded_mt ?? t.planned_load_mt);
  await createInvoice(null, undefined, { customerId: t.bill_to_id, tripId: t.id, lines: [{ description: `Freight ${t.code}: ${t.origin} → ${t.dest}`, qty: mt, rate: Number(t.freight_per_mt), vehicleId: t.vehicle_id }] }, tx);
}

export function registerFinanceHooks() {
  postHooks.expenseApproved = postExpense;
  postHooks.tripCompleted = invoiceCompletedTrip;
}
export { voidVoucher };

import { Router } from 'express';
import { z } from 'zod';
import { q, q1, exec, sequelize } from '../db/sequelize';
import { badRequest, notFound, unprocessable } from '../lib/errors';
import { id, likeTerm, listResponse, orderBy, paging, parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';
import { createInvoice, createReceipt, customerBalance, invoiceTrip, tripInvoiceGroups, voidInvoice } from '../services/sales';

export const salesRouter = Router();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// ---------- Invoices ----------
salesRouter.get('/invoices', requirePerm('sales:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ status: z.string().optional(), kind: z.string().optional(), customerId: z.coerce.number().optional(), from: dateStr.optional(), to: dateStr.optional(), overdue: z.string().optional() }), req.query);
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (f.status) { where.push('i.status IN (:st)'); r.st = f.status.split(','); }
  if (f.kind) { where.push('i.kind = :kind'); r.kind = f.kind; }
  if (f.customerId) { where.push('i.customer_id = :c'); r.c = f.customerId; }
  if (f.from) { where.push('i.invoice_date >= :from'); r.from = f.from; }
  if (f.to) { where.push('i.invoice_date <= :to'); r.to = f.to; }
  if (f.overdue === '1') where.push(`i.status IN ('UNPAID','PARTIAL') AND i.due_date < CURRENT_DATE AND i.kind = 'INVOICE'`);
  if (p.q) { where.push('(i.invoice_no ILIKE :q OR d.name ILIKE :q OR t.code ILIKE :q)'); r.q = likeTerm(p.q); }
  const from = `FROM sales_invoices i JOIN distributors d ON d.id = i.customer_id LEFT JOIN trips t ON t.id = i.trip_id WHERE ${where.join(' AND ')}`;
  const [rows, [{ total }], [sum]] = await Promise.all([
    q(`SELECT i.*, d.name AS customer_name, d.code AS customer_code, t.code AS trip_code, (i.total - i.paid)::float AS outstanding, (i.status IN ('UNPAID','PARTIAL') AND i.kind = 'INVOICE' AND i.due_date < CURRENT_DATE) AS overdue
        ${from} ORDER BY ${orderBy(p.sort, p.dir, { date: 'i.invoice_date', total: 'i.total', due: 'i.due_date', no: 'i.invoice_no', customer: 'd.name' }, 'i.invoice_date DESC, i.id DESC')} LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total ${from}`, r),
    q(`SELECT COALESCE(sum(i.total) FILTER (WHERE i.kind = 'INVOICE' AND i.status <> 'VOID'), 0)::float AS billed, COALESCE(sum(i.total - i.paid) FILTER (WHERE i.kind = 'INVOICE' AND i.status IN ('UNPAID','PARTIAL')), 0)::float AS outstanding,
              COALESCE(sum(i.total - i.paid) FILTER (WHERE i.kind = 'INVOICE' AND i.status IN ('UNPAID','PARTIAL') AND i.due_date < CURRENT_DATE), 0)::float AS overdue ${from}`, r),
  ]);
  res.json({ ...listResponse(rows, total, p.page, p.pageSize), summary: sum });
}));

salesRouter.get('/invoices/:id', requirePerm('sales:view'), wrap(async (req, res) => {
  const inv = await q1<any>(`SELECT i.*, d.name AS customer_name, d.code AS customer_code, d.address AS customer_address, d.city AS customer_city, d.ntn AS customer_ntn, d.phone AS customer_phone, t.code AS trip_code, v.voucher_no, u.full_name AS created_by_name
      FROM sales_invoices i JOIN distributors d ON d.id = i.customer_id LEFT JOIN trips t ON t.id = i.trip_id LEFT JOIN vouchers v ON v.id = i.voucher_id LEFT JOIN users u ON u.id = i.created_by WHERE i.id = :id`, { id: id(req) });
  if (!inv) throw notFound('Invoice');
  const [lines, receipts] = await Promise.all([
    q(`SELECT l.*, ve.code AS vehicle_code FROM sales_invoice_lines l LEFT JOIN vehicles ve ON ve.id = l.vehicle_id WHERE l.invoice_id = :id ORDER BY l.line_no`, { id: inv.id }),
    q(`SELECT a.amount::float AS amount, v.voucher_no, v.voucher_date, v.type, v.id AS voucher_id FROM voucher_allocations a JOIN vouchers v ON v.id = a.voucher_id WHERE a.invoice_id = :id ORDER BY v.voucher_date`, { id: inv.id }),
  ]);
  res.json({ invoice: { ...inv, outstanding: Math.round((inv.total - inv.paid) * 100) / 100 }, lines, receipts });
}));

const invBody = z.object({
  customerId: z.coerce.number().int().positive(), date: dateStr.optional(), dueDays: z.coerce.number().int().min(0).max(365).optional(), tripId: z.coerce.number().int().positive().nullish(), orderId: z.coerce.number().int().positive().nullish(),
  taxPct: z.coerce.number().min(0).max(30).optional(), notes: z.string().trim().max(300).optional(), kind: z.enum(['INVOICE', 'RETURN']).default('INVOICE'), refInvoiceId: z.coerce.number().int().positive().nullish(),
  lines: z.array(z.object({ description: z.string().trim().min(2).max(250), qty: z.coerce.number().positive(), unit: z.string().max(10).optional(), rate: z.coerce.number().min(0), vehicleId: z.coerce.number().int().positive().nullish() })).min(1).max(40),
});
salesRouter.post('/invoices', requirePerm('sales:manage'), wrap(async (req, res) => {
  const b = parse(invBody, req.body);
  const inv = await createInvoice(req.user!, req, b);
  res.status(201).json({ invoice: inv });
}));
salesRouter.post('/invoices/:id/void', requirePerm('sales:manage'), wrap(async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters).').max(250) }), req.body);
  await voidInvoice(req.user!, req, id(req), b.reason);
  res.json({ ok: true });
}));

/** Completed trips that have freight but no invoice yet — the billing queue. */
salesRouter.get('/billing-queue', requirePerm('sales:view'), wrap(async (_req, res) => {
  const rows = await q(`SELECT t.id, t.code, t.trip_type, t.completed_at, t.freight_per_mt::float, COALESCE(t.delivered_mt, t.loaded_mt, t.planned_load_mt)::float AS mt, t.bill_to_id, CASE WHEN t.stop_count > 1 THEN t.stop_count || ' customers / stops' ELSE d.name END AS bill_to_name, t.stop_count, ve.code AS vehicle_code,
      (COALESCE(t.delivered_mt, t.loaded_mt, t.planned_load_mt) * t.freight_per_mt)::float AS amount
    FROM trips t LEFT JOIN distributors d ON d.id = t.bill_to_id LEFT JOIN vehicles ve ON ve.id = t.vehicle_id
    WHERE t.status = 'COMPLETED' AND t.invoice_id IS NULL AND t.freight_per_mt > 0 ORDER BY t.completed_at DESC LIMIT 100`);
  res.json({ data: rows });
}));
salesRouter.post('/billing-queue/:tripId/invoice', requirePerm('sales:manage'), wrap(async (req, res) => {
  const tid = id(req, 'tripId');
  const t = await q1<any>(`SELECT id, code, stop_count, invoice_id, bill_to_id, freight_per_mt FROM trips WHERE id = :id`, { id: tid });
  if (!t) throw notFound('Trip');
  const cid = parse(z.object({ customerId: z.coerce.number().int().positive().optional() }), req.body).customerId;
  if (t.stop_count > 1) {
    const made = await sequelize.transaction((tx) => invoiceTrip(req.user!, req, tid, tx, cid));
    if (!made.length) throw unprocessable('Every customer on this trip is already invoiced, or no stop has a freight rate and bill-to customer.');
    return res.status(201).json({ invoice: made[0], invoices: made });
  }
  if (t.invoice_id) throw unprocessable('This trip is already invoiced.');
  const customer = cid ?? t.bill_to_id;
  if (!customer) throw badRequest('Choose the customer to bill.');
  const g = (await tripInvoiceGroups(tid))[0];
  if (!g) throw unprocessable('This trip has no freight rate to bill.');
  const inv = await createInvoice(req.user!, req, { customerId: customer, tripId: tid, lines: g.lines });
  res.status(201).json({ invoice: inv });
}));

// ---------- Receipts ----------
salesRouter.post('/receipts', requirePerm('finance:post'), wrap(async (req, res) => {
  const b = parse(z.object({
    customerId: z.coerce.number().int().positive(), amount: z.coerce.number().positive(), mode: z.enum(['CASH', 'BANK']), bankId: z.coerce.number().int().positive().nullish(), date: dateStr.optional(),
    narration: z.string().trim().max(300).optional(), reference: z.string().trim().max(60).optional(), autoAllocate: z.boolean().optional(),
    allocations: z.array(z.object({ invoiceId: z.coerce.number().int().positive(), amount: z.coerce.number().positive() })).max(60).optional(),
  }), req.body);
  res.status(201).json(await createReceipt(req.user!, req, b));
}));

// ---------- Sales orders ----------
salesRouter.get('/orders', requirePerm('sales:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset }; const where = ['1=1'];
  if (status) { where.push('o.status = :st'); r.st = status; }
  if (p.q) { where.push('(o.order_no ILIKE :q OR d.name ILIKE :q)'); r.q = likeTerm(p.q); }
  const from = `FROM sales_orders o JOIN distributors d ON d.id = o.customer_id WHERE ${where.join(' AND ')}`;
  const [rows, [{ total }]] = await Promise.all([q(`SELECT o.*, d.name AS customer_name, (SELECT sum(qty)::float FROM sales_order_lines WHERE order_id = o.id) AS qty ${from} ORDER BY o.order_date DESC, o.id DESC LIMIT :lim OFFSET :off`, r), q(`SELECT count(*)::int AS total ${from}`, r)]);
  res.json(listResponse(rows, total, p.page, p.pageSize));
}));
salesRouter.get('/orders/:id', requirePerm('sales:view'), wrap(async (req, res) => {
  const o = await q1<any>(`SELECT o.*, d.name AS customer_name FROM sales_orders o JOIN distributors d ON d.id = o.customer_id WHERE o.id = :id`, { id: id(req) });
  if (!o) throw notFound('Order');
  res.json({ order: o, lines: await q('SELECT * FROM sales_order_lines WHERE order_id = :id ORDER BY line_no', { id: o.id }) });
}));
salesRouter.post('/orders', requirePerm('sales:manage'), wrap(async (req, res) => {
  const b = parse(z.object({ customerId: z.coerce.number().int().positive(), date: dateStr.optional(), deliveryDate: dateStr.optional(), notes: z.string().trim().max(300).optional(),
    lines: z.array(z.object({ description: z.string().trim().min(2).max(250), qty: z.coerce.number().positive(), unit: z.string().max(10).optional(), rate: z.coerce.number().min(0) })).min(1).max(40) }), req.body);
  const order = await sequelize.transaction(async (tx) => {
    if (!(await q1('SELECT 1 FROM distributors WHERE id = :id', { id: b.customerId }, tx))) throw notFound('Customer');
    const seq = await q1<{ n: number }>(`SELECT nextval('sales_order_no_seq')::int AS n`, {}, tx);
    const date = b.date ?? new Date().toISOString().slice(0, 10);
    const total = Math.round(b.lines.reduce((s, l) => s + l.qty * l.rate, 0) * 100) / 100;
    const o = await q1<any>(`INSERT INTO sales_orders (order_no, order_date, customer_id, delivery_date, notes, total, created_by) VALUES (:no, :d, :c, :dd, :n, :t, :u) RETURNING *`,
      { no: `SO-${date.slice(2, 4)}-${String(seq!.n).padStart(5, '0')}`, d: date, c: b.customerId, dd: b.deliveryDate ?? null, n: b.notes ?? null, t: total, u: req.user!.id }, tx);
    let n = 1;
    for (const l of b.lines) await exec(`INSERT INTO sales_order_lines (order_id, line_no, description, qty, unit, rate, amount) VALUES (:o, :n, :d, :q, :u, :r, :a)`, { o: o.id, n: n++, d: l.description, q: l.qty, u: l.unit ?? 'MT', r: l.rate, a: Math.round(l.qty * l.rate * 100) / 100 }, tx);
    await audit(req, { action: 'SALES_ORDER_CREATED', entityType: 'SALES_ORDER', entityId: o.id, entityLabel: o.order_no, tx });
    return o;
  });
  res.status(201).json({ order });
}));
salesRouter.post('/orders/:id/invoice', requirePerm('sales:manage'), wrap(async (req, res) => {
  const o = await q1<any>('SELECT * FROM sales_orders WHERE id = :id', { id: id(req) });
  if (!o) throw notFound('Order');
  if (o.status !== 'OPEN') throw unprocessable(`This order is already ${o.status.toLowerCase()}.`);
  const lines = await q<any>('SELECT * FROM sales_order_lines WHERE order_id = :id ORDER BY line_no', { id: o.id });
  const inv = await createInvoice(req.user!, req, { customerId: o.customer_id, orderId: o.id, lines: lines.map((l: any) => ({ description: l.description, qty: Number(l.qty), unit: l.unit, rate: Number(l.rate) })) });
  res.status(201).json({ invoice: inv });
}));
salesRouter.post('/orders/:id/cancel', requirePerm('sales:manage'), wrap(async (req, res) => {
  const row = await q1<any>(`UPDATE sales_orders SET status = 'CANCELLED' WHERE id = :id AND status = 'OPEN' RETURNING *`, { id: id(req) });
  if (!row) throw unprocessable('Only open orders can be cancelled.');
  await audit(req, { action: 'SALES_ORDER_CANCELLED', entityType: 'SALES_ORDER', entityId: row.id, entityLabel: row.order_no });
  res.json({ ok: true });
}));

// ---------- Customer account (distributor / marketer) ----------
salesRouter.get('/customers/:id/account', requirePerm('sales:view'), wrap(async (req, res) => {
  const c = await q1<any>('SELECT id, code, name, customer_type, credit_limit_pkr, credit_alert_pct, credit_status FROM distributors WHERE id = :id', { id: id(req) });
  if (!c) throw notFound('Customer');
  const balance = await customerBalance(c.id);
  const [open] = await q(`SELECT COALESCE(sum(total - paid) FILTER (WHERE due_date < CURRENT_DATE), 0)::float AS overdue, count(*)::int AS open_invoices FROM sales_invoices WHERE customer_id = :c AND kind = 'INVOICE' AND status IN ('UNPAID','PARTIAL')`, { c: c.id });
  const usedPct = c.credit_limit_pkr > 0 ? Math.round((balance / c.credit_limit_pkr) * 1000) / 10 : null;
  res.json({ customer: c, balance, overdue: open.overdue, openInvoices: open.open_invoices, creditUsedPct: usedPct, overLimit: c.credit_limit_pkr > 0 && balance >= c.credit_limit_pkr });
}));

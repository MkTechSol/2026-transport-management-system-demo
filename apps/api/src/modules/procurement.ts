import { Router } from 'express';
import { z } from 'zod';
import { q, q1, exec, sequelize } from '../db/sequelize';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors';
import { id, likeTerm, listResponse, paging, parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';
import { registerApprovalHandler, requestApproval } from '../services/approvals';
import { postStockDoc } from '../services/stock';

export const procurementRouter = Router();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const today = () => new Date().toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------- Purchase requests (requisitions) ----------
procurementRouter.get('/requests', requirePerm('procurement:view'), wrap(async (req, res) => {
  const p = paging(req.query); const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (status) { where.push('r.status IN (:st)'); r.st = status.split(','); }
  if (p.q) { where.push('(r.pr_no ILIKE :q OR r.notes ILIKE :q OR v.code ILIKE :q)'); r.q = likeTerm(p.q); }
  const from = `FROM purchase_requests r LEFT JOIN vehicles v ON v.id = r.vehicle_id LEFT JOIN users u ON u.id = r.requested_by WHERE ${where.join(' AND ')}`;
  const [rows, [{ total }]] = await Promise.all([
    q(`SELECT r.*, v.code AS vehicle_code, u.full_name AS requested_by_name, (SELECT count(*)::int FROM purchase_request_lines l WHERE l.pr_id = r.id) AS lines, (SELECT count(*)::int FROM rfq_quotes x WHERE x.pr_id = r.id) AS quotes
        ${from} ORDER BY r.pr_date DESC, r.id DESC LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total ${from}`, r),
  ]);
  res.json(listResponse(rows, total, p.page, p.pageSize));
}));
procurementRouter.get('/requests/:id', requirePerm('procurement:view'), wrap(async (req, res) => {
  const pr = await q1<any>(`SELECT r.*, v.code AS vehicle_code, u.full_name AS requested_by_name FROM purchase_requests r LEFT JOIN vehicles v ON v.id = r.vehicle_id LEFT JOIN users u ON u.id = r.requested_by WHERE r.id = :id`, { id: id(req) });
  if (!pr) throw notFound('Purchase request');
  const lines = await q(`SELECT l.*, i.code, i.name, i.unit, i.avg_cost::float AS avg_cost FROM purchase_request_lines l JOIN items i ON i.id = l.item_id WHERE l.pr_id = :id ORDER BY l.line_no`, { id: pr.id });
  const quotes = await q<any>(`SELECT x.*, v.name AS vendor_name FROM rfq_quotes x JOIN vendors v ON v.id = x.vendor_id WHERE x.pr_id = :id ORDER BY x.total`, { id: pr.id });
  const qlines = quotes.length ? await q<any>('SELECT quote_id, pr_line_id, rate::float AS rate FROM rfq_quote_lines WHERE quote_id IN (:ids)', { ids: quotes.map((x: any) => x.id) }) : [];
  const order = await q1<any>('SELECT id, po_no FROM purchase_orders WHERE pr_id = :id AND status <> \'CANCELLED\' LIMIT 1', { id: pr.id });
  res.json({ request: pr, lines, quotes: quotes.map((x: any) => ({ ...x, rates: Object.fromEntries(qlines.filter((l: any) => l.quote_id === x.id).map((l: any) => [l.pr_line_id, l.rate])) })), order });
}));
const prBody = z.object({ date: dateStr.optional(), neededBy: dateStr.nullish(), vehicleId: z.coerce.number().int().positive().nullish(), notes: z.string().trim().max(300).optional(), submit: z.boolean().default(true),
  lines: z.array(z.object({ itemId: z.coerce.number().int().positive(), qty: z.coerce.number().positive(), note: z.string().trim().max(200).optional() })).min(1).max(40) });
procurementRouter.post('/requests', requirePerm('procurement:manage', 'inventory:manage'), wrap(async (req, res) => {
  const b = parse(prBody, req.body);
  const out = await sequelize.transaction(async (tx) => {
    const items = await q<any>('SELECT id, avg_cost::float AS c FROM items WHERE id IN (:ids)', { ids: b.lines.map((l) => l.itemId) }, tx);
    if (new Set(items.map((i: any) => i.id)).size !== new Set(b.lines.map((l) => l.itemId)).size) throw notFound('Item');
    const est = r2(b.lines.reduce((s, l) => s + l.qty * (items.find((i: any) => i.id === l.itemId)?.c ?? 0), 0));
    const seq = await q1<any>(`SELECT nextval('pr_no_seq')::int AS n`, {}, tx); const date = b.date ?? today();
    const pr = await q1<any>(`INSERT INTO purchase_requests (pr_no, pr_date, needed_by, vehicle_id, requested_by, status, est_value, notes) VALUES (:no, :d, :nb, :v, :u, 'DRAFT', :e, :n) RETURNING *`,
      { no: `PR-${date.slice(2, 4)}-${String(seq.n).padStart(5, '0')}`, d: date, nb: b.neededBy ?? null, v: b.vehicleId ?? null, u: req.user!.id, e: est, n: b.notes ?? null }, tx);
    let n = 1; for (const l of b.lines) await exec(`INSERT INTO purchase_request_lines (pr_id, line_no, item_id, qty, note) VALUES (:p, :n, :i, :q, :no)`, { p: pr.id, n: n++, i: l.itemId, q: l.qty, no: l.note ?? null }, tx);
    if (b.submit) { await exec(`UPDATE purchase_requests SET status = 'SUBMITTED' WHERE id = :id`, { id: pr.id }, tx); pr.status = 'SUBMITTED'; await requestApproval({ entityType: 'PURCHASE_REQUISITION', entityId: pr.id, title: `${pr.pr_no} · ${b.lines.length} item(s)`, amount: Math.round(est), requestedBy: req.user!.id, tx }); }
    await audit(req, { action: 'PURCHASE_REQUEST_CREATED', entityType: 'PURCHASE_REQUISITION', entityId: pr.id, entityLabel: pr.pr_no, tx });
    return pr;
  });
  res.status(201).json({ request: out });
}));
procurementRouter.post('/requests/:id/cancel', requirePerm('procurement:manage'), wrap(async (req, res) => {
  const row = await q1<any>(`UPDATE purchase_requests SET status = 'CANCELLED' WHERE id = :id AND status IN ('DRAFT','SUBMITTED','APPROVED') RETURNING *`, { id: id(req) });
  if (!row) throw unprocessable('This request can no longer be cancelled.');
  await exec(`UPDATE approvals SET status = 'CANCELLED' WHERE entity_type = 'PURCHASE_REQUISITION' AND entity_id = :id AND status = 'PENDING'`, { id: row.id });
  res.json({ ok: true });
}));
registerApprovalHandler('PURCHASE_REQUISITION', {
  async onApproved(entityId, { tx }) { await exec(`UPDATE purchase_requests SET status = 'APPROVED' WHERE id = :id AND status = 'SUBMITTED'`, { id: entityId }, tx); },
  async onRejected(entityId, { tx }) { await exec(`UPDATE purchase_requests SET status = 'REJECTED' WHERE id = :id AND status = 'SUBMITTED'`, { id: entityId }, tx); },
});

// ---------- Quotations & comparison ----------
procurementRouter.post('/requests/:id/quotes', requirePerm('procurement:manage'), wrap(async (req, res) => {
  const b = parse(z.object({ vendorId: z.coerce.number().int().positive(), validUntil: dateStr.nullish(), deliveryDays: z.coerce.number().int().min(0).max(365).nullish(), rates: z.array(z.object({ prLineId: z.coerce.number().int().positive(), rate: z.coerce.number().min(0) })).min(1) }), req.body);
  const pr = await q1<any>('SELECT id, status FROM purchase_requests WHERE id = :id', { id: id(req) });
  if (!pr) throw notFound('Purchase request');
  if (!['APPROVED', 'SUBMITTED'].includes(pr.status)) throw unprocessable(`Quotations can be recorded for submitted or approved requests (this one is ${pr.status.toLowerCase()}).`);
  const lines = await q<any>('SELECT id, qty::float AS qty FROM purchase_request_lines WHERE pr_id = :id', { id: pr.id });
  if (lines.length !== b.rates.length || !lines.every((l: any) => b.rates.some((r) => r.prLineId === l.id))) throw badRequest('Enter a rate for every requested item.');
  const quote = await sequelize.transaction(async (tx) => {
    await exec('DELETE FROM rfq_quotes WHERE pr_id = :p AND vendor_id = :v', { p: pr.id, v: b.vendorId }, tx);
    const total = r2(b.rates.reduce((s, r) => s + r.rate * lines.find((l: any) => l.id === r.prLineId).qty, 0));
    const x = await q1<any>(`INSERT INTO rfq_quotes (pr_id, vendor_id, quoted_on, valid_until, delivery_days, total) VALUES (:p, :v, CURRENT_DATE, :vu, :dd, :t) RETURNING *`, { p: pr.id, v: b.vendorId, vu: b.validUntil ?? null, dd: b.deliveryDays ?? null, t: total }, tx);
    for (const r of b.rates) await exec('INSERT INTO rfq_quote_lines (quote_id, pr_line_id, rate) VALUES (:q, :l, :r)', { q: x.id, l: r.prLineId, r: r.rate }, tx);
    return x;
  });
  res.status(201).json({ quote });
}));
/** Selects the winning quotation and raises the purchase order from it (rates as quoted). Only approved requests can be ordered. */
procurementRouter.post('/requests/:id/order', requirePerm('procurement:manage'), wrap(async (req, res) => {
  const b = parse(z.object({ quoteId: z.coerce.number().int().positive(), expectedOn: dateStr.nullish() }), req.body);
  const out = await sequelize.transaction(async (tx) => {
    const pr = await q1<any>('SELECT * FROM purchase_requests WHERE id = :id FOR UPDATE', { id: id(req) }, tx);
    if (!pr) throw notFound('Purchase request');
    if (pr.status !== 'APPROVED') throw unprocessable(pr.status === 'ORDERED' ? 'A purchase order was already raised for this request.' : `The request must be approved first (it is ${pr.status.toLowerCase()}).`);
    const quote = await q1<any>('SELECT * FROM rfq_quotes WHERE id = :q AND pr_id = :p', { q: b.quoteId, p: pr.id }, tx);
    if (!quote) throw notFound('Quotation');
    const lines = await q<any>(`SELECT l.item_id, l.qty::float AS qty, ql.rate::float AS rate FROM purchase_request_lines l JOIN rfq_quote_lines ql ON ql.pr_line_id = l.id AND ql.quote_id = :q ORDER BY l.line_no`, { q: quote.id }, tx);
    const seq = await q1<any>(`SELECT nextval('po_no_seq')::int AS n`, {}, tx); const date = today();
    const po = await q1<any>(`INSERT INTO purchase_orders (po_no, po_date, vendor_id, pr_id, expected_on, total, created_by) VALUES (:no, :d, :v, :pr, :e, :t, :u) RETURNING *`,
      { no: `PO-${date.slice(2, 4)}-${String(seq.n).padStart(5, '0')}`, d: date, v: quote.vendor_id, pr: pr.id, e: b.expectedOn ?? null, t: quote.total, u: req.user!.id }, tx);
    let n = 1; for (const l of lines) await exec('INSERT INTO purchase_order_lines (po_id, line_no, item_id, qty, rate) VALUES (:p, :n, :i, :q, :r)', { p: po.id, n: n++, i: l.item_id, q: l.qty, r: l.rate }, tx);
    await exec(`UPDATE rfq_quotes SET selected = (id = :q) WHERE pr_id = :p`, { q: quote.id, p: pr.id }, tx);
    await exec(`UPDATE purchase_requests SET status = 'ORDERED' WHERE id = :id`, { id: pr.id }, tx);
    await audit(req, { action: 'PURCHASE_ORDER_CREATED', entityType: 'PURCHASE_ORDER', entityId: po.id, entityLabel: `${po.po_no} · PKR ${po.total}`, tx });
    return po;
  });
  res.status(201).json({ order: out });
}));

// ---------- Purchase orders & receiving ----------
procurementRouter.get('/orders', requirePerm('procurement:view'), wrap(async (req, res) => {
  const p = paging(req.query); const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (status) { where.push('o.status IN (:st)'); r.st = status.split(','); }
  if (p.q) { where.push('(o.po_no ILIKE :q OR v.name ILIKE :q)'); r.q = likeTerm(p.q); }
  const from = `FROM purchase_orders o JOIN vendors v ON v.id = o.vendor_id WHERE ${where.join(' AND ')}`;
  const [rows, [{ total }]] = await Promise.all([
    q(`SELECT o.*, v.name AS vendor_name, (SELECT sum(qty)::float FROM purchase_order_lines WHERE po_id = o.id) AS qty, (SELECT sum(received_qty)::float FROM purchase_order_lines WHERE po_id = o.id) AS received ${from} ORDER BY o.po_date DESC, o.id DESC LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total ${from}`, r),
  ]);
  res.json(listResponse(rows, total, p.page, p.pageSize));
}));
procurementRouter.get('/orders/:id', requirePerm('procurement:view'), wrap(async (req, res) => {
  const o = await q1<any>(`SELECT o.*, v.name AS vendor_name, pr.pr_no FROM purchase_orders o JOIN vendors v ON v.id = o.vendor_id LEFT JOIN purchase_requests pr ON pr.id = o.pr_id WHERE o.id = :id`, { id: id(req) });
  if (!o) throw notFound('Purchase order');
  const lines = await q(`SELECT l.*, i.code, i.name, i.unit, i.serialized FROM purchase_order_lines l JOIN items i ON i.id = l.item_id WHERE l.po_id = :id ORDER BY l.line_no`, { id: o.id });
  const receipts = await q(`SELECT id, doc_no, doc_date, total_value::float AS total_value FROM stock_docs WHERE po_id = :id ORDER BY id`, { id: o.id });
  res.json({ order: o, lines, receipts });
}));
procurementRouter.post('/orders/:id/cancel', requirePerm('procurement:manage'), wrap(async (req, res) => {
  const row = await q1<any>(`UPDATE purchase_orders SET status = 'CANCELLED' WHERE id = :id AND status = 'OPEN' RETURNING *`, { id: id(req) });
  if (!row) throw conflict('Only orders with nothing received yet can be cancelled.');
  await exec(`UPDATE purchase_requests SET status = 'APPROVED' WHERE id = :p AND status = 'ORDERED'`, { p: row.pr_id });
  await audit(req, { action: 'PURCHASE_ORDER_CANCELLED', entityType: 'PURCHASE_ORDER', entityId: row.id, entityLabel: row.po_no });
  res.json({ ok: true });
}));
/** Goods receipt against a PO: creates the purchase stock voucher (stock in + payable) at the PO rates. */
procurementRouter.post('/orders/:id/receive', requirePerm('inventory:manage'), wrap(async (req, res) => {
  const b = parse(z.object({ warehouseId: z.coerce.number().int().positive(), date: dateStr.optional(), payMode: z.enum(['CREDIT', 'CASH', 'BANK']).default('CREDIT'), bankId: z.coerce.number().int().positive().nullish(),
    lines: z.array(z.object({ itemId: z.coerce.number().int().positive(), qty: z.coerce.number().positive(), serialNos: z.array(z.string().trim().min(2).max(60)).optional() })).min(1) }), req.body);
  const po = await q1<any>('SELECT * FROM purchase_orders WHERE id = :id', { id: id(req) });
  if (!po) throw notFound('Purchase order');
  if (['RECEIVED', 'CANCELLED'].includes(po.status)) throw unprocessable(`This order is already ${po.status.toLowerCase()}.`);
  const pol = await q<any>('SELECT l.item_id, l.rate::float AS rate, (l.qty - l.received_qty)::float AS open_qty, i.serialized FROM purchase_order_lines l JOIN items i ON i.id = l.item_id WHERE l.po_id = :id', { id: po.id });
  const lines: any[] = [];
  for (const l of b.lines) {
    const o = pol.find((x: any) => x.item_id === l.itemId); if (!o) throw badRequest('An item on the receipt is not on the order.');
    if (l.qty > o.open_qty + 0.0004) throw unprocessable(`Only ${o.open_qty} of this item is still open on ${po.po_no}.`, { fields: { qty: 'More than ordered' } });
    if (o.serialized) { if (!l.serialNos || l.serialNos.length !== l.qty) throw badRequest('Enter one serial number per unit received.', { fields: { serialNos: 'Count must match quantity' } }); for (const s of l.serialNos) lines.push({ itemId: l.itemId, qty: 1, unitCost: o.rate, serialNo: s }); }
    else lines.push({ itemId: l.itemId, qty: l.qty, unitCost: o.rate });
  }
  const doc = await postStockDoc(req.user!, req, { type: 'PURCHASE', date: b.date, to: { type: 'WAREHOUSE', id: b.warehouseId }, vendorId: po.vendor_id, poId: po.id, payMode: b.payMode, bankId: b.bankId, narration: `Receipt against ${po.po_no}`, lines });
  res.status(201).json({ doc });
}));

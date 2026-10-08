import { Router } from 'express';
import { z } from 'zod';
import { q, q1 } from '../db/sequelize';
import { notFound } from '../lib/errors';
import { id, likeTerm, listResponse, paging, parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { postStockDoc } from '../services/stock';

export const tyresRouter = Router();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

tyresRouter.get('/', requirePerm('tyres:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ status: z.string().optional(), vehicleId: z.coerce.number().optional(), warehouseId: z.coerce.number().optional() }), req.query);
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (f.status) { where.push('t.status IN (:st)'); r.st = f.status.split(','); }
  if (f.vehicleId) { where.push('t.vehicle_id = :v'); r.v = f.vehicleId; }
  if (f.warehouseId) { where.push('t.warehouse_id = :w'); r.w = f.warehouseId; }
  if (p.q) { where.push('(t.serial_no ILIKE :q OR i.name ILIKE :q OR v.code ILIKE :q)'); r.q = likeTerm(p.q); }
  const from = `FROM tyres t JOIN items i ON i.id = t.item_id LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN warehouses w ON w.id = t.warehouse_id WHERE ${where.join(' AND ')}`;
  const [rows, [{ total }], [stats]] = await Promise.all([
    q(`SELECT t.*, i.name AS item_name, v.code AS vehicle_code, v.odometer_km AS vehicle_odometer, w.name AS warehouse_name,
        CASE WHEN t.status = 'FITTED' THEN t.km_run + GREATEST(0, v.odometer_km - COALESCE(t.odometer_fit, v.odometer_km)) ELSE t.km_run END AS km_total
       ${from} ORDER BY t.status, v.code NULLS LAST, t.position, t.serial_no LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total ${from}`, r),
    q(`SELECT count(*) FILTER (WHERE status = 'FITTED')::int AS fitted, count(*) FILTER (WHERE status = 'IN_STORE')::int AS in_store, count(*) FILTER (WHERE status = 'RETREAD')::int AS retread, count(*) FILTER (WHERE status = 'SCRAPPED')::int AS scrapped FROM tyres`),
  ]);
  res.json({ ...listResponse(rows, total, p.page, p.pageSize), stats });
}));

/** Wheel map for one bowzer: every position with the tyre on it (or empty). */
tyresRouter.get('/vehicle/:vehicleId', requirePerm('tyres:view'), wrap(async (req, res) => {
  const v = await q1<any>('SELECT id, code, wheels, odometer_km FROM vehicles WHERE id = :id', { id: id(req, 'vehicleId') });
  if (!v) throw notFound('Vehicle');
  const fitted = await q(`SELECT t.id, t.serial_no, t.position, t.size, t.fitted_on, t.odometer_fit, t.retread_count, i.name AS item_name, (t.km_run + GREATEST(0, :odo - COALESCE(t.odometer_fit, :odo)))::int AS km_total FROM tyres t JOIN items i ON i.id = t.item_id WHERE t.vehicle_id = :id AND t.status = 'FITTED' ORDER BY t.position`, { id: v.id, odo: v.odometer_km });
  const history = await q(`SELECT e.event_date, e.event_type, e.position, e.odometer, e.note, t.serial_no, i.name AS item_name FROM tyre_events e JOIN tyres t ON t.id = e.tyre_id JOIN items i ON i.id = t.item_id WHERE e.vehicle_id = :id AND e.event_type <> 'PURCHASED' ORDER BY e.event_date DESC, e.id DESC LIMIT 40`, { id: v.id });
  res.json({ vehicle: v, positions: Array.from({ length: v.wheels ?? 10 }, (_, i) => `W${i + 1}`), fitted, history });
}));
tyresRouter.get('/:id', requirePerm('tyres:view'), wrap(async (req, res) => {
  const t = await q1<any>(`SELECT t.*, i.name AS item_name, v.code AS vehicle_code, w.name AS warehouse_name FROM tyres t JOIN items i ON i.id = t.item_id LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN warehouses w ON w.id = t.warehouse_id WHERE t.id = :id`, { id: id(req) });
  if (!t) throw notFound('Tyre');
  res.json({ tyre: t, events: await q(`SELECT e.*, v.code AS vehicle_code FROM tyre_events e LEFT JOIN vehicles v ON v.id = e.vehicle_id WHERE e.tyre_id = :id ORDER BY e.event_date, e.id`, { id: t.id }) });
}));

/** Fit a tyre (optionally swapping out the one currently on that wheel position) — creates a Parts replacement voucher. */
tyresRouter.post('/fit', requirePerm('tyres:manage'), wrap(async (req, res) => {
  const b = parse(z.object({ serialNo: z.string().trim().min(2), vehicleId: z.coerce.number().int().positive(), position: z.string().trim().min(1).max(12), date: dateStr.optional(), removeDisposition: z.enum(['SCRAP', 'RETURN', 'RETREAD']).default('RETREAD'), reason: z.string().trim().max(250).optional() }), req.body);
  const tyre = await q1<any>('SELECT * FROM tyres WHERE serial_no = :s', { s: b.serialNo });
  if (!tyre) throw notFound('Tyre');
  const old = await q1<any>(`SELECT serial_no, item_id FROM tyres WHERE vehicle_id = :v AND position = :p AND status = 'FITTED'`, { v: b.vehicleId, p: b.position });
  const doc = await postStockDoc(req.user!, req, {
    type: 'PARTS_REPLACEMENT', date: b.date, vehicleId: b.vehicleId, from: { type: 'WAREHOUSE', id: tyre.warehouse_id }, narration: `Tyre ${old ? 'change' : 'fitment'} at ${b.position}`,
    lines: [{ itemId: tyre.item_id, qty: 1, serialNo: tyre.serial_no, position: b.position, reason: b.reason, ...(old ? { removeItemId: old.item_id, removeQty: 1, removeSerialNo: old.serial_no, removeDisposition: b.removeDisposition } : {}) }],
  });
  res.status(201).json({ doc });
}));

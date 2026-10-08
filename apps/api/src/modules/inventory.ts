import { Router } from 'express';
import { z } from 'zod';
import { q, q1, exec } from '../db/sequelize';
import { badRequest, conflict, notFound } from '../lib/errors';
import { id, likeTerm, listResponse, orderBy, paging, parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { can } from '@gasman/shared';
import { audit } from '../services/audit';
import { postStockDoc, STOCK_DOC_LABELS } from '../services/stock';

export const inventoryRouter = Router();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const KINDS = ['SPARE', 'TYRE', 'CAMERA', 'ACCESSORY', 'LUBRICANT', 'SAFETY', 'TOOL', 'OTHER'] as const;
const today = () => new Date().toISOString().slice(0, 10);

// ---------- Overview ----------
inventoryRouter.get('/summary', requirePerm('inventory:view'), wrap(async (_req, res) => {
  const [s] = await q(`SELECT (SELECT count(*)::int FROM items WHERE active) AS items,
      COALESCE((SELECT sum(b.qty * i.avg_cost) FROM stock_balances b JOIN items i ON i.id = b.item_id WHERE b.holder_type = 'WAREHOUSE'), 0)::float AS warehouse_value,
      COALESCE((SELECT sum(b.qty * i.avg_cost) FROM stock_balances b JOIN items i ON i.id = b.item_id WHERE b.holder_type = 'VEHICLE'), 0)::float AS fitted_value,
      COALESCE((SELECT sum(b.qty) FROM stock_balances b WHERE b.holder_type = 'VEHICLE'), 0)::float AS fitted_units,
      (SELECT count(*)::int FROM (SELECT i.id FROM items i LEFT JOIN stock_balances b ON b.item_id = i.id AND b.holder_type = 'WAREHOUSE' WHERE i.active AND i.min_level > 0 GROUP BY i.id HAVING COALESCE(sum(b.qty), 0) <= i.min_level) x) AS low_stock,
      (SELECT count(*)::int FROM warehouses WHERE active) AS warehouses,
      (SELECT count(*)::int FROM purchase_requests WHERE status IN ('SUBMITTED','APPROVED')) AS open_requests,
      (SELECT count(*)::int FROM purchase_orders WHERE status IN ('OPEN','PARTIAL')) AS open_orders`);
  res.json(s);
}));

// ---------- Masters ----------
inventoryRouter.get('/categories', requirePerm('inventory:view'), wrap(async (_req, res) => {
  res.json({ data: await q(`SELECT c.*, (SELECT count(*)::int FROM items i WHERE i.category_id = c.id) AS items, COALESCE((SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name) FROM item_subcategories s WHERE s.category_id = c.id), '[]') AS subcategories FROM item_categories c ORDER BY c.name`) });
}));
inventoryRouter.post('/categories', requirePerm('inventory:manage'), wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(80), kind: z.enum(KINDS).default('SPARE') }), req.body);
  if (await q1('SELECT 1 FROM item_categories WHERE lower(name) = lower(:n)', { n: b.name })) throw conflict('A category with this name already exists.', { fields: { name: 'Already exists' } });
  res.status(201).json({ category: await q1(`INSERT INTO item_categories (name, kind) VALUES (:n, :k) RETURNING *`, { n: b.name, k: b.kind }) });
}));
inventoryRouter.post('/categories/:id/subcategories', requirePerm('inventory:manage'), wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(80) }), req.body);
  if (await q1('SELECT 1 FROM item_subcategories WHERE category_id = :c AND lower(name) = lower(:n)', { c: id(req), n: b.name })) throw conflict('This sub-category already exists.', { fields: { name: 'Already exists' } });
  res.status(201).json({ subcategory: await q1(`INSERT INTO item_subcategories (category_id, name) VALUES (:c, :n) RETURNING *`, { c: id(req), n: b.name }) });
}));
inventoryRouter.get('/brands', requirePerm('inventory:view'), wrap(async (_req, res) => res.json({ data: await q('SELECT b.*, (SELECT count(*)::int FROM items i WHERE i.brand_id = b.id) AS items FROM brands b ORDER BY b.name') })));
inventoryRouter.post('/brands', requirePerm('inventory:manage'), wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(80) }), req.body);
  if (await q1('SELECT 1 FROM brands WHERE lower(name) = lower(:n)', { n: b.name })) throw conflict('This brand already exists.', { fields: { name: 'Already exists' } });
  res.status(201).json({ brand: await q1(`INSERT INTO brands (name) VALUES (:n) RETURNING *`, { n: b.name }) });
}));
inventoryRouter.get('/warehouses', requirePerm('inventory:view'), wrap(async (_req, res) => {
  res.json({ data: await q(`SELECT w.*, l.name AS location_name, COALESCE(s.value, 0)::float AS value, COALESCE(s.units, 0)::float AS units, COALESCE(s.lines, 0)::int AS lines FROM warehouses w LEFT JOIN locations l ON l.id = w.location_id
    LEFT JOIN (SELECT b.holder_id, sum(b.qty * i.avg_cost) AS value, sum(b.qty) AS units, count(*) FILTER (WHERE b.qty > 0) AS lines FROM stock_balances b JOIN items i ON i.id = b.item_id WHERE b.holder_type = 'WAREHOUSE' GROUP BY 1) s ON s.holder_id = w.id ORDER BY w.name`) });
}));
inventoryRouter.post('/warehouses', requirePerm('inventory:manage'), wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(120), locationId: z.coerce.number().int().positive().nullish() }), req.body);
  const n = await q1<any>('SELECT count(*)::int + 1 AS n FROM warehouses');
  const row = await q1(`INSERT INTO warehouses (code, name, location_id) VALUES (:c, :n, :l) RETURNING *`, { c: `WH-${String(n.n).padStart(2, '0')}`, n: b.name, l: b.locationId ?? null });
  res.status(201).json({ warehouse: row });
}));

// ---------- Items ----------
const itemBody = z.object({
  code: z.string().trim().min(2).max(30), name: z.string().trim().min(2).max(150), categoryId: z.coerce.number().int().positive(), subcategoryId: z.coerce.number().int().positive().nullish(), brandId: z.coerce.number().int().positive().nullish(),
  madeIn: z.string().trim().max(60).nullish(), unit: z.string().trim().max(10).default('PCS'), minLevel: z.coerce.number().min(0).default(0), reorderQty: z.coerce.number().min(0).default(0), serialized: z.boolean().default(false), notes: z.string().trim().max(300).nullish(),
});
inventoryRouter.get('/items', requirePerm('inventory:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ categoryId: z.coerce.number().optional(), brandId: z.coerce.number().optional(), kind: z.string().optional(), low: z.string().optional(), active: z.string().optional(), all: z.string().optional() }), req.query);
  const where = ['1=1']; const r: Record<string, unknown> = { lim: f.all ? 500 : p.pageSize, off: f.all ? 0 : p.offset };
  if (f.categoryId) { where.push('i.category_id = :cat'); r.cat = f.categoryId; }
  if (f.brandId) { where.push('i.brand_id = :br'); r.br = f.brandId; }
  if (f.kind) { where.push('c.kind = :kind'); r.kind = f.kind; }
  if (f.active !== '0') where.push('i.active');
  if (p.q) { where.push('(i.name ILIKE :q OR i.code ILIKE :q OR b.name ILIKE :q)'); r.q = likeTerm(p.q); }
  const having = f.low === '1' ? 'HAVING i.min_level > 0 AND COALESCE(sum(s.qty) FILTER (WHERE s.holder_type = \'WAREHOUSE\'), 0) <= i.min_level' : '';
  const base = `FROM items i JOIN item_categories c ON c.id = i.category_id LEFT JOIN item_subcategories sc ON sc.id = i.subcategory_id LEFT JOIN brands b ON b.id = i.brand_id LEFT JOIN stock_balances s ON s.item_id = i.id WHERE ${where.join(' AND ')} GROUP BY i.id, c.id, sc.id, b.id ${having}`;
  const [rows, [{ total }]] = await Promise.all([
    q(`SELECT i.*, c.name AS category_name, c.kind, sc.name AS subcategory_name, b.name AS brand_name,
        COALESCE(sum(s.qty) FILTER (WHERE s.holder_type = 'WAREHOUSE'), 0)::float AS in_store, COALESCE(sum(s.qty) FILTER (WHERE s.holder_type = 'VEHICLE'), 0)::float AS fitted,
        (COALESCE(sum(s.qty), 0) * i.avg_cost)::float AS value
       ${base} ORDER BY ${orderBy(p.sort, p.dir, { name: 'i.name', code: 'i.code', category: 'c.name', cost: 'i.avg_cost' }, 'c.name, i.name')} LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total FROM (SELECT i.id ${base}) x`, r),
  ]);
  res.json(listResponse(rows, total, p.page, p.pageSize));
}));
inventoryRouter.get('/items/:id', requirePerm('inventory:view'), wrap(async (req, res) => {
  const item = await q1<any>(`SELECT i.*, c.name AS category_name, c.kind, sc.name AS subcategory_name, b.name AS brand_name FROM items i JOIN item_categories c ON c.id = i.category_id LEFT JOIN item_subcategories sc ON sc.id = i.subcategory_id LEFT JOIN brands b ON b.id = i.brand_id WHERE i.id = :id`, { id: id(req) });
  if (!item) throw notFound('Item');
  const holders = await q(`SELECT s.holder_type, s.holder_id, s.qty::float AS qty, CASE s.holder_type WHEN 'WAREHOUSE' THEN w.name ELSE v.code END AS holder_name, (s.qty * :cost)::float AS value
      FROM stock_balances s LEFT JOIN warehouses w ON s.holder_type = 'WAREHOUSE' AND w.id = s.holder_id LEFT JOIN vehicles v ON s.holder_type = 'VEHICLE' AND v.id = s.holder_id WHERE s.item_id = :id AND s.qty > 0 ORDER BY s.holder_type, holder_name`, { id: item.id, cost: item.avg_cost });
  const movements = await q(`SELECT m.movement_date, m.holder_type, m.qty::float AS qty, m.unit_cost::float AS unit_cost, d.doc_no, d.type, CASE m.holder_type WHEN 'WAREHOUSE' THEN w.name WHEN 'VEHICLE' THEN v.code WHEN 'VENDOR' THEN ve.name ELSE m.holder_type END AS holder_name
      FROM stock_movements m JOIN stock_docs d ON d.id = m.doc_id LEFT JOIN warehouses w ON m.holder_type = 'WAREHOUSE' AND w.id = m.holder_id LEFT JOIN vehicles v ON m.holder_type = 'VEHICLE' AND v.id = m.holder_id LEFT JOIN vendors ve ON m.holder_type = 'VENDOR' AND ve.id = m.holder_id
      WHERE m.item_id = :id ORDER BY m.movement_date DESC, m.id DESC LIMIT 30`, { id: item.id });
  res.json({ item, holders, movements });
}));
inventoryRouter.post('/items', requirePerm('inventory:manage'), wrap(async (req, res) => {
  const b = parse(itemBody, req.body);
  if (await q1('SELECT 1 FROM items WHERE lower(code) = lower(:c)', { c: b.code })) throw conflict('An item with this code already exists.', { fields: { code: 'Already used' } });
  const row = await q1<any>(`INSERT INTO items (code, name, category_id, subcategory_id, brand_id, made_in, unit, min_level, reorder_qty, serialized, notes) VALUES (:c, :n, :cat, :sc, :br, :mi, :u, :ml, :rq, :se, :no) RETURNING *`,
    { c: b.code.toUpperCase(), n: b.name, cat: b.categoryId, sc: b.subcategoryId ?? null, br: b.brandId ?? null, mi: b.madeIn ?? null, u: b.unit, ml: b.minLevel, rq: b.reorderQty, se: b.serialized, no: b.notes ?? null });
  await audit(req, { action: 'ITEM_CREATED', entityType: 'ITEM', entityId: row.id, entityLabel: `${row.code} ${row.name}` });
  res.status(201).json({ item: row });
}));
inventoryRouter.patch('/items/:id', requirePerm('inventory:manage'), wrap(async (req, res) => {
  const b = parse(itemBody.partial().extend({ active: z.boolean().optional() }), req.body);
  const row = await q1<any>(`UPDATE items SET name = COALESCE(:n, name), category_id = COALESCE(:cat, category_id), subcategory_id = COALESCE(:sc, subcategory_id), brand_id = COALESCE(:br, brand_id), made_in = COALESCE(:mi, made_in), unit = COALESCE(:u, unit),
      min_level = COALESCE(:ml, min_level), reorder_qty = COALESCE(:rq, reorder_qty), notes = COALESCE(:no, notes), active = COALESCE(:act, active) WHERE id = :id RETURNING *`,
    { n: b.name ?? null, cat: b.categoryId ?? null, sc: b.subcategoryId ?? null, br: b.brandId ?? null, mi: b.madeIn ?? null, u: b.unit ?? null, ml: b.minLevel ?? null, rq: b.reorderQty ?? null, no: b.notes ?? null, act: b.active ?? null, id: id(req) });
  if (!row) throw notFound('Item');
  await audit(req, { action: 'ITEM_UPDATED', entityType: 'ITEM', entityId: row.id, entityLabel: `${row.code} ${row.name}` });
  res.json({ item: row });
}));

/** What can be taken from a holder right now (drives the item pickers on stock vouchers). */
inventoryRouter.get('/available', requirePerm('inventory:view'), wrap(async (req, res) => {
  const f = parse(z.object({ holderType: z.enum(['WAREHOUSE', 'VEHICLE']), holderId: z.coerce.number().int().positive() }), req.query);
  res.json({ data: await q(`SELECT i.id, i.code, i.name, i.unit, i.serialized, i.avg_cost::float AS avg_cost, s.qty::float AS qty, c.kind FROM stock_balances s JOIN items i ON i.id = s.item_id JOIN item_categories c ON c.id = i.category_id WHERE s.holder_type = :t AND s.holder_id = :h AND s.qty > 0 ORDER BY c.name, i.name`, { t: f.holderType, h: f.holderId }) });
}));

// ---------- Stock documents (vouchers) ----------
inventoryRouter.get('/docs', requirePerm('inventory:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ type: z.string().optional(), vehicleId: z.coerce.number().optional(), vendorId: z.coerce.number().optional(), from: dateStr.optional(), to: dateStr.optional() }), req.query);
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (f.type) { where.push('d.type IN (:types)'); r.types = f.type.split(','); }
  if (f.vehicleId) { where.push('d.vehicle_id = :v'); r.v = f.vehicleId; }
  if (f.vendorId) { where.push('d.vendor_id = :ven'); r.ven = f.vendorId; }
  if (f.from) { where.push('d.doc_date >= :from'); r.from = f.from; }
  if (f.to) { where.push('d.doc_date <= :to'); r.to = f.to; }
  if (p.q) { where.push('(d.doc_no ILIKE :q OR d.narration ILIKE :q OR v.name ILIKE :q)'); r.q = likeTerm(p.q); }
  const from = `FROM stock_docs d LEFT JOIN vendors v ON v.id = d.vendor_id LEFT JOIN vehicles ve ON ve.id = d.vehicle_id LEFT JOIN users u ON u.id = d.created_by WHERE ${where.join(' AND ')}`;
  const [rows, [{ total }]] = await Promise.all([
    q(`SELECT d.*, v.name AS vendor_name, ve.code AS vehicle_code, u.full_name AS created_by_name, (SELECT count(*)::int FROM stock_doc_lines l WHERE l.doc_id = d.id) AS lines,
        CASE d.from_type WHEN 'WAREHOUSE' THEN (SELECT name FROM warehouses WHERE id = d.from_id) WHEN 'VEHICLE' THEN (SELECT code FROM vehicles WHERE id = d.from_id) END AS from_name,
        CASE d.to_type WHEN 'WAREHOUSE' THEN (SELECT name FROM warehouses WHERE id = d.to_id) WHEN 'VEHICLE' THEN (SELECT code FROM vehicles WHERE id = d.to_id) END AS to_name
       ${from} ORDER BY d.doc_date DESC, d.id DESC LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total ${from}`, r),
  ]);
  res.json({ ...listResponse(rows, total, p.page, p.pageSize), labels: STOCK_DOC_LABELS });
}));
inventoryRouter.get('/docs/:id', requirePerm('inventory:view'), wrap(async (req, res) => {
  const d = await q1<any>(`SELECT d.*, v.name AS vendor_name, ve.code AS vehicle_code, u.full_name AS created_by_name, vo.voucher_no,
      CASE d.from_type WHEN 'WAREHOUSE' THEN (SELECT name FROM warehouses WHERE id = d.from_id) WHEN 'VEHICLE' THEN (SELECT code FROM vehicles WHERE id = d.from_id) END AS from_name,
      CASE d.to_type WHEN 'WAREHOUSE' THEN (SELECT name FROM warehouses WHERE id = d.to_id) WHEN 'VEHICLE' THEN (SELECT code FROM vehicles WHERE id = d.to_id) END AS to_name
    FROM stock_docs d LEFT JOIN vendors v ON v.id = d.vendor_id LEFT JOIN vehicles ve ON ve.id = d.vehicle_id LEFT JOIN users u ON u.id = d.created_by LEFT JOIN vouchers vo ON vo.id = d.voucher_id WHERE d.id = :id`, { id: id(req) });
  if (!d) throw notFound('Stock voucher');
  const lines = await q(`SELECT l.*, i.code, i.name, i.unit, ri.code AS remove_code, ri.name AS remove_name FROM stock_doc_lines l JOIN items i ON i.id = l.item_id LEFT JOIN items ri ON ri.id = l.remove_item_id WHERE l.doc_id = :id ORDER BY l.line_no`, { id: d.id });
  res.json({ doc: d, lines, label: STOCK_DOC_LABELS[d.type as keyof typeof STOCK_DOC_LABELS] });
}));
const holder = z.object({ type: z.enum(['WAREHOUSE', 'VEHICLE']), id: z.coerce.number().int().positive() });
const docBody = z.object({
  type: z.enum(['OPENING', 'PURCHASE', 'PURCHASE_RETURN', 'NAVIGATION', 'PARTS_REPLACEMENT', 'ISSUE', 'ADJUSTMENT']), date: dateStr.optional(), from: holder.nullish(), to: holder.nullish(),
  vehicleId: z.coerce.number().int().positive().nullish(), vendorId: z.coerce.number().int().positive().nullish(), poId: z.coerce.number().int().positive().nullish(), payMode: z.enum(['CREDIT', 'CASH', 'BANK']).optional(), bankId: z.coerce.number().int().positive().nullish(), maintenanceId: z.coerce.number().int().positive().nullish(),
  narration: z.string().trim().max(300).optional(),
  lines: z.array(z.object({ itemId: z.coerce.number().int().positive(), qty: z.coerce.number(), unitCost: z.coerce.number().min(0).optional(), serialNo: z.string().trim().max(60).optional(), position: z.string().trim().max(12).optional(),
    removeItemId: z.coerce.number().int().positive().optional(), removeQty: z.coerce.number().positive().optional(), removeSerialNo: z.string().trim().max(60).optional(), removeDisposition: z.enum(['SCRAP', 'RETURN', 'RETREAD']).optional(), reason: z.string().trim().max(250).optional() })).min(1).max(60),
});
inventoryRouter.post('/docs', requirePerm('inventory:manage'), wrap(async (req, res) => {
  const b = parse(docBody, req.body);
  if (b.type === 'PURCHASE' || b.type === 'PURCHASE_RETURN') { if (!can(req.user!.role, 'procurement:manage') && req.user!.role !== 'SUPER_ADMIN') throw badRequest('Purchases need procurement permission.'); }
  const doc = await postStockDoc(req.user!, req, b);
  res.status(201).json({ doc });
}));

// ---------- Vehicle-wise inventory ----------
inventoryRouter.get('/vehicles/:id', requirePerm('inventory:view'), wrap(async (req, res) => {
  const vid = id(req);
  const veh = await q1<any>('SELECT id, code, odometer_km, wheels FROM vehicles WHERE id = :id', { id: vid });
  if (!veh) throw notFound('Vehicle');
  const [fitted, tyres, replaced, fuel] = await Promise.all([
    q(`SELECT i.id, i.code, i.name, i.unit, c.name AS category, c.kind, s.qty::float AS qty, (s.qty * i.avg_cost)::float AS value, (SELECT max(m.movement_date) FROM stock_movements m WHERE m.item_id = i.id AND m.holder_type = 'VEHICLE' AND m.holder_id = s.holder_id AND m.qty > 0) AS since
        FROM stock_balances s JOIN items i ON i.id = s.item_id JOIN item_categories c ON c.id = i.category_id WHERE s.holder_type = 'VEHICLE' AND s.holder_id = :id AND s.qty > 0 ORDER BY c.name, i.name`, { id: vid }),
    q(`SELECT t.id, t.serial_no, t.position, t.size, t.fitted_on, t.odometer_fit, t.km_run, t.retread_count, i.name AS item_name, GREATEST(0, :odo - COALESCE(t.odometer_fit, :odo)) + t.km_run AS km_total FROM tyres t JOIN items i ON i.id = t.item_id WHERE t.vehicle_id = :id AND t.status = 'FITTED' ORDER BY t.position`, { id: vid, odo: veh.odometer_km }),
    q(`SELECT d.doc_date, d.doc_no, d.type, i.name AS item_name, l.qty::float AS qty, l.line_value::float AS value, ri.name AS removed_name, l.remove_disposition, l.reason FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id JOIN items i ON i.id = l.item_id LEFT JOIN items ri ON ri.id = l.remove_item_id
        WHERE d.vehicle_id = :id AND d.type IN ('PARTS_REPLACEMENT','ISSUE','NAVIGATION') ORDER BY d.doc_date DESC, d.id DESC LIMIT 40`, { id: vid }),
    q1(`SELECT count(*)::int AS fills, COALESCE(sum(litres), 0)::float AS litres, COALESCE(sum(amount), 0)::float AS amount, avg(kmpl)::float AS avg_kmpl, max(fueled_at) AS last_fill FROM fuel_entries WHERE vehicle_id = :id`, { id: vid }),
  ]);
  res.json({ vehicle: veh, fitted, tyres, replaced, fuel });
}));

// ---------- Reports ----------
type Col = { key: string; label: string; type?: 'money' | 'date' | 'num' | 'text' | 'pct' };
interface Report { title: string; subtitle?: string; columns: Col[]; rows: any[]; totals?: Record<string, number | string> }
interface P extends Record<string, unknown> { from: string; to: string; asOf: string; itemId?: number; vehicleId?: number; warehouseId?: number; categoryId?: number; vendorId?: number }
const sum = (rows: any[], k: string) => Math.round(rows.reduce((s, r) => s + Number(r[k] ?? 0), 0) * 100) / 100;
const num: Col['type'] = 'num';

const REPORTS: Record<string, { title: string; group: string; run: (p: P) => Promise<Report> }> = {
  'inventory-summary': { title: 'Inventory summary', group: 'Stock', run: async (p) => {
    const rows = await q(`SELECT i.code, i.name, c.name AS category, COALESCE(b.name, '') AS brand, i.unit, COALESCE(sum(s.qty) FILTER (WHERE s.holder_type = 'WAREHOUSE'), 0)::float AS in_store, COALESCE(sum(s.qty) FILTER (WHERE s.holder_type = 'VEHICLE'), 0)::float AS fitted,
        COALESCE(sum(s.qty), 0)::float AS total, i.avg_cost::float AS avg_cost, (COALESCE(sum(s.qty), 0) * i.avg_cost)::float AS value, i.min_level::float AS min_level
      FROM items i JOIN item_categories c ON c.id = i.category_id LEFT JOIN brands b ON b.id = i.brand_id LEFT JOIN stock_balances s ON s.item_id = i.id
      WHERE i.active ${p.categoryId ? 'AND i.category_id = :categoryId' : ''} GROUP BY i.id, c.name, b.name HAVING COALESCE(sum(s.qty), 0) > 0 ORDER BY c.name, i.name`, p);
    return { title: 'Inventory summary', subtitle: 'Quantities in stores and fitted to bowzers, valued at moving-average cost', columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Item' }, { key: 'category', label: 'Category' }, { key: 'brand', label: 'Brand' }, { key: 'in_store', label: 'In store', type: num }, { key: 'fitted', label: 'On bowzers', type: num }, { key: 'total', label: 'Total', type: num }, { key: 'avg_cost', label: 'Avg cost', type: 'money' }, { key: 'value', label: 'Value', type: 'money' }],
      rows, totals: { in_store: sum(rows, 'in_store'), fitted: sum(rows, 'fitted'), total: sum(rows, 'total'), value: sum(rows, 'value') } };
  } },
  'stock-value': { title: 'Stock value by category', group: 'Stock', run: async () => {
    const rows = await q(`SELECT c.name AS category, c.kind, count(DISTINCT i.id) FILTER (WHERE s.qty > 0)::int AS items, COALESCE(sum(s.qty) FILTER (WHERE s.holder_type = 'WAREHOUSE'), 0)::float AS in_store, COALESCE(sum(s.qty * i.avg_cost) FILTER (WHERE s.holder_type = 'WAREHOUSE'), 0)::float AS store_value, COALESCE(sum(s.qty * i.avg_cost) FILTER (WHERE s.holder_type = 'VEHICLE'), 0)::float AS fitted_value
      FROM item_categories c LEFT JOIN items i ON i.category_id = c.id LEFT JOIN stock_balances s ON s.item_id = i.id GROUP BY c.id ORDER BY store_value DESC`);
    return { title: 'Stock value by category', columns: [{ key: 'category', label: 'Category' }, { key: 'items', label: 'Items with stock', type: num }, { key: 'in_store', label: 'Units in store', type: num }, { key: 'store_value', label: 'Store value', type: 'money' }, { key: 'fitted_value', label: 'Fitted to bowzers', type: 'money' }], rows, totals: { items: sum(rows, 'items'), in_store: sum(rows, 'in_store'), store_value: sum(rows, 'store_value'), fitted_value: sum(rows, 'fitted_value') } };
  } },
  'low-stock': { title: 'Low-stock items', group: 'Stock', run: async () => {
    const rows = await q(`SELECT i.code, i.name, c.name AS category, COALESCE(sum(s.qty), 0)::float AS in_store, i.min_level::float AS min_level, i.reorder_qty::float AS reorder_qty, GREATEST(i.reorder_qty, i.min_level * 2 - COALESCE(sum(s.qty), 0))::float AS suggested
      FROM items i JOIN item_categories c ON c.id = i.category_id LEFT JOIN stock_balances s ON s.item_id = i.id AND s.holder_type = 'WAREHOUSE' WHERE i.active AND i.min_level > 0 GROUP BY i.id, c.name HAVING COALESCE(sum(s.qty), 0) <= i.min_level ORDER BY (COALESCE(sum(s.qty), 0) / NULLIF(i.min_level, 0)), i.name`);
    return { title: 'Low-stock items', subtitle: 'At or below the minimum level', columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Item' }, { key: 'category', label: 'Category' }, { key: 'in_store', label: 'In store', type: num }, { key: 'min_level', label: 'Minimum', type: num }, { key: 'suggested', label: 'Suggested order', type: num }], rows };
  } },
  'item-ledger': { title: 'Item ledger', group: 'Stock', run: async (p) => {
    if (!p.itemId) throw badRequest('Choose an item to open its ledger.');
    const item = await q1<any>('SELECT code, name FROM items WHERE id = :id', { id: p.itemId }); if (!item) throw notFound('Item');
    const rows = await q(`SELECT m.movement_date AS date, d.doc_no, d.type, CASE m.holder_type WHEN 'WAREHOUSE' THEN w.name WHEN 'VEHICLE' THEN v.code WHEN 'VENDOR' THEN ve.name ELSE m.holder_type END AS holder, m.qty::float AS qty, m.unit_cost::float AS unit_cost
        FROM stock_movements m JOIN stock_docs d ON d.id = m.doc_id LEFT JOIN warehouses w ON m.holder_type = 'WAREHOUSE' AND w.id = m.holder_id LEFT JOIN vehicles v ON m.holder_type = 'VEHICLE' AND v.id = m.holder_id LEFT JOIN vendors ve ON m.holder_type = 'VENDOR' AND ve.id = m.holder_id
        WHERE m.item_id = :itemId AND m.movement_date BETWEEN :from AND :to ${p.warehouseId ? `AND m.holder_type = 'WAREHOUSE' AND m.holder_id = :warehouseId` : ''} ORDER BY m.movement_date, m.id`, p);
    const out = rows.map((r: any) => ({ ...r, type: STOCK_DOC_LABELS[r.type as keyof typeof STOCK_DOC_LABELS] ?? r.type, qty_in: r.qty > 0 ? r.qty : 0, qty_out: r.qty < 0 ? -r.qty : 0, value: Math.round(r.qty * r.unit_cost * 100) / 100 }));
    return { title: `Item ledger — ${item.code} ${item.name}`, subtitle: `${p.from} to ${p.to} · each movement is shown against the holder it affected`, columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'doc_no', label: 'Document' }, { key: 'type', label: 'Type' }, { key: 'holder', label: 'Holder' }, { key: 'qty_in', label: 'In', type: num }, { key: 'qty_out', label: 'Out', type: num }, { key: 'unit_cost', label: 'Unit cost', type: 'money' }], rows: out, totals: { qty_in: sum(out, 'qty_in'), qty_out: sum(out, 'qty_out') } };
  } },
  'check-item-stock': { title: 'Check item stock', group: 'Stock', run: async (p) => {
    if (!p.itemId) throw badRequest('Choose an item to check.');
    const item = await q1<any>('SELECT code, name, unit, avg_cost::float AS avg_cost FROM items WHERE id = :id', { id: p.itemId }); if (!item) throw notFound('Item');
    const rows = await q(`SELECT s.holder_type AS kind, CASE s.holder_type WHEN 'WAREHOUSE' THEN w.name ELSE v.code END AS holder, s.qty::float AS qty, (s.qty * :cost)::float AS value FROM stock_balances s LEFT JOIN warehouses w ON s.holder_type = 'WAREHOUSE' AND w.id = s.holder_id LEFT JOIN vehicles v ON s.holder_type = 'VEHICLE' AND v.id = s.holder_id WHERE s.item_id = :itemId AND s.qty > 0 ORDER BY s.holder_type, holder`, { ...p, cost: item.avg_cost });
    return { title: `Stock check — ${item.code} ${item.name}`, subtitle: `Where every ${item.unit.toLowerCase()} of this item is right now`, columns: [{ key: 'kind', label: 'Held in' }, { key: 'holder', label: 'Store / bowzer' }, { key: 'qty', label: 'Quantity', type: num }, { key: 'value', label: 'Value', type: 'money' }], rows, totals: { qty: sum(rows, 'qty'), value: sum(rows, 'value') } };
  } },
  'stock-navigation': { title: 'Stock navigation (item × holder)', group: 'Stock', run: async (p) => {
    const holders = await q<any>(`SELECT s.holder_type, s.holder_id, CASE s.holder_type WHEN 'WAREHOUSE' THEN w.name ELSE v.code END AS name FROM stock_balances s LEFT JOIN warehouses w ON s.holder_type = 'WAREHOUSE' AND w.id = s.holder_id LEFT JOIN vehicles v ON s.holder_type = 'VEHICLE' AND v.id = s.holder_id
        JOIN items i ON i.id = s.item_id WHERE s.qty > 0 ${p.categoryId ? 'AND i.category_id = :categoryId' : ''} GROUP BY 1, 2, 3 ORDER BY 1 DESC, 3`, p);
    const bal = await q<any>(`SELECT s.item_id, s.holder_type, s.holder_id, s.qty::float AS qty FROM stock_balances s JOIN items i ON i.id = s.item_id WHERE s.qty > 0 ${p.categoryId ? 'AND i.category_id = :categoryId' : ''}`, p);
    const items = await q<any>(`SELECT i.id, i.code, i.name FROM items i WHERE i.id IN (SELECT item_id FROM stock_balances WHERE qty > 0) ${p.categoryId ? 'AND i.category_id = :categoryId' : ''} ORDER BY i.name`, p);
    const key = (t: string, id: number) => `${t}:${id}`;
    const byItem = new Map<number, Map<string, number>>();
    for (const b of bal) { const m = byItem.get(b.item_id) ?? new Map(); m.set(key(b.holder_type, b.holder_id), b.qty); byItem.set(b.item_id, m); }
    const cols: Col[] = [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Item' }, ...holders.map((h: any) => ({ key: key(h.holder_type, h.holder_id), label: h.name, type: num as Col['type'] })), { key: 'total', label: 'Total', type: num }];
    const rows = items.map((i: any) => { const m = byItem.get(i.id) ?? new Map<string, number>(); const r: any = { code: i.code, name: i.name, total: 0 }; for (const [k, v] of m) { r[k] = v; r.total += v; } return r; });
    const totals: any = { total: sum(rows, 'total') }; for (const h of holders) totals[key(h.holder_type, h.holder_id)] = sum(rows, key(h.holder_type, h.holder_id));
    return { title: 'Stock navigation', subtitle: 'Items down the side; stores and bowzers across the top', columns: cols, rows, totals };
  } },
  'vehicle-inventory': { title: 'Vehicle-wise inventory', group: 'Vehicles', run: async (p) => {
    const rows = await q(`SELECT v.code AS vehicle, c.name AS category, i.name AS item, s.qty::float AS qty, (s.qty * i.avg_cost)::float AS value FROM stock_balances s JOIN vehicles v ON v.id = s.holder_id JOIN items i ON i.id = s.item_id JOIN item_categories c ON c.id = i.category_id
        WHERE s.holder_type = 'VEHICLE' AND s.qty > 0 ${p.vehicleId ? 'AND s.holder_id = :vehicleId' : ''} ${p.categoryId ? 'AND i.category_id = :categoryId' : ''} ORDER BY v.code, c.name, i.name`, p);
    return { title: 'Vehicle-wise inventory', subtitle: 'Everything fitted to each bowzer — cameras, trackers, extinguishers, valves, tyres and spares', columns: [{ key: 'vehicle', label: 'Bowzer' }, { key: 'category', label: 'Category' }, { key: 'item', label: 'Item' }, { key: 'qty', label: 'Qty', type: num }, { key: 'value', label: 'Value', type: 'money' }], rows, totals: { qty: sum(rows, 'qty'), value: sum(rows, 'value') } };
  } },
  'vehicle-fitment-matrix': { title: 'Bowzer fitment matrix', group: 'Vehicles', run: async (p) => {
    const cats = await q<any>(`SELECT DISTINCT c.id, c.name FROM stock_balances s JOIN items i ON i.id = s.item_id JOIN item_categories c ON c.id = i.category_id WHERE s.holder_type = 'VEHICLE' AND s.qty > 0 ORDER BY c.name`);
    const rows = await q<any>(`SELECT v.code AS vehicle, c.id AS cat, sum(s.qty)::float AS qty FROM stock_balances s JOIN vehicles v ON v.id = s.holder_id JOIN items i ON i.id = s.item_id JOIN item_categories c ON c.id = i.category_id WHERE s.holder_type = 'VEHICLE' AND s.qty > 0 ${p.vehicleId ? 'AND s.holder_id = :vehicleId' : ''} GROUP BY v.code, c.id ORDER BY v.code`, p);
    const by = new Map<string, any>(); for (const r of rows) { const o = by.get(r.vehicle) ?? { vehicle: r.vehicle, total: 0 }; o[`c${r.cat}`] = r.qty; o.total += r.qty; by.set(r.vehicle, o); }
    const out = [...by.values()]; const totals: any = { total: sum(out, 'total') }; for (const c of cats) totals[`c${c.id}`] = sum(out, `c${c.id}`);
    return { title: 'Bowzer fitment matrix', subtitle: 'Units fitted per bowzer by category (e.g. 5 cameras in bowzer A, 3 in bowzer B)', columns: [{ key: 'vehicle', label: 'Bowzer' }, ...cats.map((c: any) => ({ key: `c${c.id}`, label: c.name, type: num as Col['type'] })), { key: 'total', label: 'Total', type: num }], rows: out, totals };
  } },
  'parts-replaced': { title: 'Parts replacement history', group: 'Vehicles', run: async (p) => {
    const rows = await q(`SELECT d.doc_date AS date, d.doc_no, v.code AS vehicle, i.name AS new_part, l.qty::float AS qty, COALESCE(ri.name, '') AS removed_part, COALESCE(l.remove_disposition, '') AS disposition, l.line_value::float AS value, COALESCE(l.reason, '') AS reason
        FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id JOIN vehicles v ON v.id = d.vehicle_id JOIN items i ON i.id = l.item_id LEFT JOIN items ri ON ri.id = l.remove_item_id
        WHERE d.type = 'PARTS_REPLACEMENT' AND d.doc_date BETWEEN :from AND :to ${p.vehicleId ? 'AND d.vehicle_id = :vehicleId' : ''} ORDER BY d.doc_date DESC, d.id DESC`, p);
    return { title: 'Parts replacement history', subtitle: `${p.from} to ${p.to}`, columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'doc_no', label: 'Voucher' }, { key: 'vehicle', label: 'Bowzer' }, { key: 'new_part', label: 'Fitted' }, { key: 'qty', label: 'Qty', type: num }, { key: 'removed_part', label: 'Removed' }, { key: 'disposition', label: 'Old part' }, { key: 'value', label: 'Cost', type: 'money' }, { key: 'reason', label: 'Reason' }], rows, totals: { value: sum(rows, 'value') } };
  } },
  'tyre-changes': { title: 'Tyre changes', group: 'Vehicles', run: async (p) => {
    const rows = await q(`SELECT e.event_date AS date, v.code AS vehicle, t.serial_no, i.name AS tyre, e.event_type AS event, COALESCE(e.position, '') AS position, e.odometer, COALESCE(e.note, '') AS note FROM tyre_events e JOIN tyres t ON t.id = e.tyre_id JOIN items i ON i.id = t.item_id LEFT JOIN vehicles v ON v.id = e.vehicle_id
        WHERE e.event_type <> 'PURCHASED' AND e.event_date BETWEEN :from AND :to ${p.vehicleId ? 'AND e.vehicle_id = :vehicleId' : ''} ORDER BY e.event_date DESC, e.id DESC`, p);
    return { title: 'Tyre changes', subtitle: `${p.from} to ${p.to}`, columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'vehicle', label: 'Bowzer' }, { key: 'serial_no', label: 'Serial' }, { key: 'tyre', label: 'Tyre' }, { key: 'event', label: 'Event' }, { key: 'position', label: 'Position' }, { key: 'odometer', label: 'Odometer', type: num }, { key: 'note', label: 'Note' }], rows };
  } },
  'fuel-changes': { title: 'Fuel by bowzer', group: 'Vehicles', run: async (p) => {
    const rows = await q(`SELECT v.code AS vehicle, count(*)::int AS fills, sum(f.litres)::float AS litres, sum(f.amount)::float AS amount, (sum(f.amount) / NULLIF(sum(f.litres), 0))::float AS avg_rate, avg(f.kmpl)::float AS avg_kmpl, v.fuel_norm_kmpl::float AS norm, count(*) FILTER (WHERE f.status = 'FLAGGED')::int AS flagged, max(f.fueled_at) AS last_fill
        FROM fuel_entries f JOIN vehicles v ON v.id = f.vehicle_id WHERE f.fueled_at::date BETWEEN :from AND :to ${p.vehicleId ? 'AND f.vehicle_id = :vehicleId' : ''} GROUP BY v.id ORDER BY amount DESC`, p);
    const out = rows.map((r: any) => ({ ...r, avg_rate: r.avg_rate ? Math.round(r.avg_rate * 10) / 10 : null, avg_kmpl: r.avg_kmpl ? Math.round(r.avg_kmpl * 100) / 100 : null }));
    return { title: 'Fuel by bowzer', subtitle: `${p.from} to ${p.to}`, columns: [{ key: 'vehicle', label: 'Bowzer' }, { key: 'fills', label: 'Fills', type: num }, { key: 'litres', label: 'Litres', type: num }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'avg_rate', label: 'Avg PKR/L', type: 'money' }, { key: 'avg_kmpl', label: 'Avg km/L', type: num }, { key: 'norm', label: 'Norm km/L', type: num }, { key: 'flagged', label: 'Flagged', type: num }], rows: out, totals: { fills: sum(out, 'fills'), litres: sum(out, 'litres'), amount: sum(out, 'amount'), flagged: sum(out, 'flagged') } };
  } },
  'purchase-register': { title: 'Purchase register', group: 'Purchases', run: async (p) => {
    const rows = await q(`SELECT d.doc_date AS date, d.doc_no, v.name AS vendor, i.name AS item, l.qty::float AS qty, l.unit_cost::float AS unit_cost, l.line_value::float AS value, d.pay_mode FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id JOIN items i ON i.id = l.item_id LEFT JOIN vendors v ON v.id = d.vendor_id
        WHERE d.type = 'PURCHASE' AND d.doc_date BETWEEN :from AND :to ${p.vendorId ? 'AND d.vendor_id = :vendorId' : ''} ORDER BY d.doc_date DESC, d.id DESC`, p);
    return { title: 'Purchase register', subtitle: `${p.from} to ${p.to}`, columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'doc_no', label: 'Purchase' }, { key: 'vendor', label: 'Vendor' }, { key: 'item', label: 'Item' }, { key: 'qty', label: 'Qty', type: num }, { key: 'unit_cost', label: 'Rate', type: 'money' }, { key: 'value', label: 'Amount', type: 'money' }, { key: 'pay_mode', label: 'Paid by' }], rows, totals: { qty: sum(rows, 'qty'), value: sum(rows, 'value') } };
  } },
  'purchase-return-register': { title: 'Purchase return register', group: 'Purchases', run: async (p) => {
    const rows = await q(`SELECT d.doc_date AS date, d.doc_no, v.name AS vendor, i.name AS item, l.qty::float AS qty, l.unit_cost::float AS unit_cost, l.line_value::float AS value, COALESCE(l.reason, d.narration, '') AS reason FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id JOIN items i ON i.id = l.item_id LEFT JOIN vendors v ON v.id = d.vendor_id
        WHERE d.type = 'PURCHASE_RETURN' AND d.doc_date BETWEEN :from AND :to ORDER BY d.doc_date DESC`, p);
    return { title: 'Purchase return register', subtitle: `${p.from} to ${p.to}`, columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'doc_no', label: 'Return' }, { key: 'vendor', label: 'Vendor' }, { key: 'item', label: 'Item' }, { key: 'qty', label: 'Qty', type: num }, { key: 'unit_cost', label: 'Rate', type: 'money' }, { key: 'value', label: 'Amount', type: 'money' }, { key: 'reason', label: 'Reason' }], rows, totals: { value: sum(rows, 'value') } };
  } },
  'vendor-purchases': { title: 'Purchases by vendor', group: 'Purchases', run: async (p) => {
    const rows = await q(`SELECT v.name AS vendor, v.category, count(DISTINCT d.id)::int AS documents, COALESCE(sum(d.total_value) FILTER (WHERE d.type = 'PURCHASE'), 0)::float AS purchased, COALESCE(sum(d.total_value) FILTER (WHERE d.type = 'PURCHASE_RETURN'), 0)::float AS returned
        FROM stock_docs d JOIN vendors v ON v.id = d.vendor_id WHERE d.type IN ('PURCHASE','PURCHASE_RETURN') AND d.doc_date BETWEEN :from AND :to GROUP BY v.id ORDER BY purchased DESC`, p);
    const out = rows.map((r: any) => ({ ...r, net: Math.round((r.purchased - r.returned) * 100) / 100 }));
    return { title: 'Purchases by vendor', subtitle: `${p.from} to ${p.to}`, columns: [{ key: 'vendor', label: 'Vendor' }, { key: 'category', label: 'Category' }, { key: 'documents', label: 'Documents', type: num }, { key: 'purchased', label: 'Purchased', type: 'money' }, { key: 'returned', label: 'Returned', type: 'money' }, { key: 'net', label: 'Net', type: 'money' }], rows: out, totals: { purchased: sum(out, 'purchased'), returned: sum(out, 'returned'), net: sum(out, 'net') } };
  } },
  'vouchers-register': { title: 'Stock voucher register', group: 'Stock', run: async (p) => {
    const rows = await q(`SELECT d.doc_date AS date, d.doc_no, d.type, COALESCE(ve.code, '') AS vehicle, COALESCE(v.name, '') AS vendor, d.total_value::float AS value, COALESCE(d.narration, '') AS narration FROM stock_docs d LEFT JOIN vehicles ve ON ve.id = d.vehicle_id LEFT JOIN vendors v ON v.id = d.vendor_id WHERE d.doc_date BETWEEN :from AND :to ORDER BY d.doc_date DESC, d.id DESC`, p);
    const out = rows.map((r: any) => ({ ...r, type: STOCK_DOC_LABELS[r.type as keyof typeof STOCK_DOC_LABELS] ?? r.type }));
    return { title: 'Stock voucher register', subtitle: `${p.from} to ${p.to}`, columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'doc_no', label: 'Voucher' }, { key: 'type', label: 'Type' }, { key: 'vehicle', label: 'Bowzer' }, { key: 'vendor', label: 'Vendor' }, { key: 'value', label: 'Value', type: 'money' }, { key: 'narration', label: 'Narration' }], rows: out, totals: { value: sum(out, 'value') } };
  } },
};
inventoryRouter.get('/reports', requirePerm('inventory:view'), wrap(async (_req, res) => res.json({ data: Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title, group: r.group })) })));
inventoryRouter.get('/reports/:key', requirePerm('inventory:view'), wrap(async (req, res) => {
  const def = REPORTS[String(req.params.key)]; if (!def) throw notFound('Report');
  const f = parse(z.object({ from: dateStr.optional(), to: dateStr.optional(), asOf: dateStr.optional(), itemId: z.coerce.number().optional(), vehicleId: z.coerce.number().optional(), warehouseId: z.coerce.number().optional(), categoryId: z.coerce.number().optional(), vendorId: z.coerce.number().optional() }), req.query);
  const to = f.to ?? today(); const from = f.from ?? new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  res.json(await def.run({ ...f, from, to, asOf: f.asOf ?? to }));
}));
void exec;

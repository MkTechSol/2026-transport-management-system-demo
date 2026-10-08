import { describe, expect, it } from 'vitest';
import { as, USERS } from './helpers';
import { q1, exec } from '../src/db/sequelize';

const item = async (code: string) => (await q1<any>('SELECT id FROM items WHERE code = :c', { c: code })).id as number;
const qty = async (itemId: number, type: string, id: number) => Number((await q1<any>('SELECT qty::float AS q FROM stock_balances WHERE item_id = :i AND holder_type = :t AND holder_id = :h', { i: itemId, t: type, h: id }))?.q ?? 0);

describe('inventory integrity', () => {
  it('inventory ledger equals the value of stock held in stores', async () => {
    const gl = await q1<any>("SELECT COALESCE(sum(l.debit - l.credit), 0)::float AS v FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED' WHERE l.account_id = (SELECT id FROM accounts WHERE system_key = 'inventory')");
    const st = await q1<any>("SELECT COALESCE(sum(b.qty * i.avg_cost), 0)::float AS v FROM stock_balances b JOIN items i ON i.id = b.item_id WHERE b.holder_type = 'WAREHOUSE'");
    expect(Math.abs(gl.v - st.v)).toBeLessThan(5);
  });

  it('tyre register matches stock balances', async () => {
    const t = await q1<any>("SELECT (SELECT count(*) FROM tyres WHERE status = 'FITTED')::int AS fitted, (SELECT COALESCE(sum(b.qty), 0) FROM stock_balances b JOIN items i ON i.id = b.item_id WHERE i.serialized AND b.holder_type = 'VEHICLE')::int AS bal");
    expect(t.fitted).toBe(t.bal);
  });

  it('database refuses negative stock even if the API is bypassed', async () => {
    await expect(exec(`UPDATE stock_balances SET qty = -1 WHERE (item_id, holder_type, holder_id) = (SELECT item_id, holder_type, holder_id FROM stock_balances LIMIT 1)`)).rejects.toThrow();
  });
});

describe('stock vouchers', () => {
  it('refuses to issue more than is in the store, with a clear message', async () => {
    const s = await as(USERS.store);
    const r = await s.post('/inventory/docs', { type: 'ISSUE', from: { type: 'WAREHOUSE', id: 3 }, vehicleId: 1, lines: [{ itemId: await item('CAM-DASH'), qty: 9999 }] });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/not enough stock/i);
  });

  it('navigation voucher moves stock warehouse → bowzer → warehouse and charges / refunds the bowzer account', async () => {
    const s = await as(USERS.store);
    const it = await item('LGT-BULB'); const veh = 4;
    const whBefore = await qty(it, 'WAREHOUSE', 1); const vBefore = await qty(it, 'VEHICLE', veh);
    const out = await s.post('/inventory/docs', { type: 'NAVIGATION', from: { type: 'WAREHOUSE', id: 1 }, to: { type: 'VEHICLE', id: veh }, lines: [{ itemId: it, qty: 2 }] });
    expect(out.status).toBe(201);
    expect(out.body.doc.voucher_id).toBeGreaterThan(0);
    expect(await qty(it, 'WAREHOUSE', 1)).toBe(whBefore - 2); expect(await qty(it, 'VEHICLE', veh)).toBe(vBefore + 2);
    const exp = await q1<any>("SELECT sum(l.debit - l.credit)::float AS v FROM voucher_lines l WHERE l.voucher_id = :v AND l.vehicle_id = :veh", { v: out.body.doc.voucher_id, veh });
    expect(exp.v).toBeGreaterThan(0);
    const back = await s.post('/inventory/docs', { type: 'NAVIGATION', from: { type: 'VEHICLE', id: veh }, to: { type: 'WAREHOUSE', id: 1 }, lines: [{ itemId: it, qty: 2 }] });
    expect(back.status).toBe(201);
    expect(await qty(it, 'WAREHOUSE', 1)).toBe(whBefore); expect(await qty(it, 'VEHICLE', veh)).toBe(vBefore);
  });

  it('serial-tracked items need a serial; duplicate serials are refused', async () => {
    const s = await as(USERS.store);
    const tyre = await item('TYR-1100'); const vendor = (await q1<any>("SELECT id FROM vendors WHERE category = 'SUPPLIER' LIMIT 1")).id;
    const noSerial = await s.post('/inventory/docs', { type: 'PURCHASE', to: { type: 'WAREHOUSE', id: 1 }, vendorId: vendor, lines: [{ itemId: tyre, qty: 1, unitCost: 78000 }] });
    expect(noSerial.status).toBe(400);
    const ok = await s.post('/inventory/docs', { type: 'PURCHASE', to: { type: 'WAREHOUSE', id: 1 }, vendorId: vendor, lines: [{ itemId: tyre, qty: 1, unitCost: 78000, serialNo: 'TEST-SER-1' }] });
    expect(ok.status).toBe(201);
    const dup = await s.post('/inventory/docs', { type: 'PURCHASE', to: { type: 'WAREHOUSE', id: 1 }, vendorId: vendor, lines: [{ itemId: tyre, qty: 1, unitCost: 78000, serialNo: 'TEST-SER-1' }] });
    expect(dup.status).toBe(422);
  });

  it('tyre change: new tyre fitted, old one retreaded, register and positions stay consistent', async () => {
    const s = await as(USERS.store);
    const fitted = await q1<any>("SELECT id, serial_no, vehicle_id, position FROM tyres WHERE status = 'FITTED' ORDER BY id LIMIT 1");
    const spare = await q1<any>("SELECT serial_no FROM tyres WHERE status = 'IN_STORE' AND item_id = (SELECT id FROM items WHERE code = 'TYR-1100') ORDER BY id LIMIT 1");
    const occupied = await s.post('/tyres/fit', { serialNo: spare.serial_no, vehicleId: fitted.vehicle_id, position: fitted.position, removeDisposition: 'RETREAD' });
    expect(occupied.status).toBe(201); // swapping the tyre on that position is a valid tyre change
    const t = await q1<any>('SELECT status FROM tyres WHERE id = :id', { id: fitted.id });
    expect(t.status).toBe('RETREAD');
    const nu = await q1<any>('SELECT status, vehicle_id, position FROM tyres WHERE serial_no = :s', { s: spare.serial_no });
    expect(nu).toMatchObject({ status: 'FITTED', vehicle_id: fitted.vehicle_id, position: fitted.position });
  });
});

describe('inventory access & procurement flow', () => {
  it('only store/management roles can see stock; drivers and dispatchers cannot', async () => {
    expect((await (await as(USERS.store)).get('/inventory/items')).status).toBe(200);
    expect((await (await as(USERS.driver)).get('/inventory/items')).status).toBe(403);
    expect((await (await as(USERS.dispatcher)).get('/inventory/reports/inventory-summary')).status).toBe(403);
    expect((await (await as(USERS.viewer)).post('/inventory/docs', { type: 'ADJUSTMENT', from: { type: 'WAREHOUSE', id: 1 }, lines: [{ itemId: 1, qty: 1 }] })).status).toBe(403);
  });

  it('requisition → approval → quotations → purchase order → goods receipt', async () => {
    const store = await as(USERS.store); const mgr = await as(USERS.manager);
    const it = await item('FLT-OIL'); const vendors = await q1<any>("SELECT array_agg(id ORDER BY id) AS ids FROM vendors WHERE category = 'SUPPLIER'");
    const pr = await store.post('/procurement/requests', { lines: [{ itemId: it, qty: 10 }], notes: 'test requisition' });
    expect(pr.status).toBe(201); expect(pr.body.request.status).toBe('SUBMITTED');
    const prId = pr.body.request.id;
    const early = await store.post(`/procurement/requests/${prId}/order`, { quoteId: 1 });
    expect(early.status).toBe(422); // not approved yet
    const approval = await q1<any>("SELECT id FROM approvals WHERE entity_type = 'PURCHASE_REQUISITION' AND entity_id = :id AND status = 'PENDING'", { id: prId });
    expect((await mgr.post(`/approvals/${approval.id}/decide`, { decision: 'APPROVED' })).status).toBe(200);
    const detail = (await store.get(`/procurement/requests/${prId}`)).body;
    const line = detail.lines[0].id;
    const q1r = await store.post(`/procurement/requests/${prId}/quotes`, { vendorId: vendors.ids[0], rates: [{ prLineId: line, rate: 2500 }] });
    const q2r = await store.post(`/procurement/requests/${prId}/quotes`, { vendorId: vendors.ids[1], rates: [{ prLineId: line, rate: 2300 }] });
    expect(q1r.status).toBe(201); expect(q2r.status).toBe(201);
    const po = await store.post(`/procurement/requests/${prId}/order`, { quoteId: q2r.body.quote.id });
    expect(po.status).toBe(201); expect(Number(po.body.order.total)).toBe(23000);
    const over = await store.post(`/procurement/orders/${po.body.order.id}/receive`, { warehouseId: 1, lines: [{ itemId: it, qty: 11 }] });
    expect(over.status).toBe(422);
    const part = await store.post(`/procurement/orders/${po.body.order.id}/receive`, { warehouseId: 1, lines: [{ itemId: it, qty: 4 }] });
    expect(part.status).toBe(201);
    expect((await store.get(`/procurement/orders/${po.body.order.id}`)).body.order.status).toBe('PARTIAL');
    const rest = await store.post(`/procurement/orders/${po.body.order.id}/receive`, { warehouseId: 1, lines: [{ itemId: it, qty: 6 }] });
    expect(rest.status).toBe(201);
    expect((await store.get(`/procurement/orders/${po.body.order.id}`)).body.order.status).toBe('RECEIVED');
  });

  it('reports run and the stock navigation matrix has holders across the top', async () => {
    const s = await as(USERS.store);
    for (const k of ['inventory-summary', 'stock-value', 'low-stock', 'stock-navigation', 'vehicle-inventory', 'vehicle-fitment-matrix', 'parts-replaced', 'tyre-changes', 'fuel-changes', 'purchase-register', 'vendor-purchases', 'vouchers-register']) {
      const r = await s.get(`/inventory/reports/${k}`);
      expect(r.status, k).toBe(200);
      expect(r.body.columns.length, k).toBeGreaterThan(1);
    }
    const nav = (await s.get('/inventory/reports/stock-navigation')).body;
    expect(nav.columns.some((c: any) => /Store/.test(c.label))).toBe(true);
    expect(nav.columns.some((c: any) => /GAS-BZ/.test(c.label))).toBe(true);
    const matrix = (await s.get('/inventory/reports/vehicle-fitment-matrix')).body;
    expect(matrix.rows.length).toBeGreaterThan(5);
  });
});

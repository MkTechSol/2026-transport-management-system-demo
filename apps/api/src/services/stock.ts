import { q, q1, exec, sequelize } from '../db/sequelize';
import { badRequest, notFound, unprocessable } from '../lib/errors';
import type { AuthUser } from '../middleware/auth';
import { audit } from './audit';
import { accountId, fiscalYearFor, postVoucher, type LineInput } from './ledger';

export type HolderType = 'WAREHOUSE' | 'VEHICLE';
export interface Holder { type: HolderType; id: number }
export interface StockLineInput {
  itemId: number; qty: number; unitCost?: number; serialNo?: string; position?: string;
  removeItemId?: number; removeQty?: number; removeSerialNo?: string; removeDisposition?: 'SCRAP' | 'RETURN' | 'RETREAD'; reason?: string;
}
export type StockDocType = 'OPENING' | 'PURCHASE' | 'PURCHASE_RETURN' | 'NAVIGATION' | 'PARTS_REPLACEMENT' | 'ISSUE' | 'ADJUSTMENT';
export interface StockDocInput {
  type: StockDocType; date?: string; from?: Holder | null; to?: Holder | null; vehicleId?: number | null; vendorId?: number | null; poId?: number | null;
  payMode?: 'CREDIT' | 'CASH' | 'BANK'; bankId?: number | null; narration?: string; lines: StockLineInput[];
}

export const STOCK_DOC_LABELS: Record<StockDocType, string> = {
  OPENING: 'Opening stock', PURCHASE: 'Purchase', PURCHASE_RETURN: 'Purchase return', NAVIGATION: 'Navigation (transfer)', PARTS_REPLACEMENT: 'Parts replacement', ISSUE: 'Issue to bowzer', ADJUSTMENT: 'Stock adjustment',
};
const PREFIX: Record<StockDocType, string> = { OPENING: 'OSB', PURCHASE: 'PUR', PURCHASE_RETURN: 'PRT', NAVIGATION: 'NAV', PARTS_REPLACEMENT: 'PRP', ISSUE: 'ISS', ADJUSTMENT: 'ADJ' };
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const today = () => new Date().toISOString().slice(0, 10);

const holderName = async (h: Holder, tx: any) => (h.type === 'WAREHOUSE'
  ? (await q1<any>('SELECT name FROM warehouses WHERE id = :id', { id: h.id }, tx))?.name
  : (await q1<any>('SELECT code FROM vehicles WHERE id = :id', { id: h.id }, tx))?.code) ?? `${h.type} ${h.id}`;

async function checkHolder(h: Holder | null | undefined, label: string, tx: any) {
  if (!h) throw badRequest(`Choose the ${label}.`, { fields: { [label]: 'Required' } });
  const ok = h.type === 'WAREHOUSE' ? await q1('SELECT 1 AS x FROM warehouses WHERE id = :id AND active', { id: h.id }, tx) : await q1('SELECT 1 AS x FROM vehicles WHERE id = :id AND archived_at IS NULL', { id: h.id }, tx);
  if (!ok) throw notFound(h.type === 'WAREHOUSE' ? 'Warehouse' : 'Bowzer');
}

async function move(tx: any, d: { docId: number; date: string; item: any; holder: Holder | { type: 'VENDOR' | 'SCRAP' | 'CONSUMED'; id: number }; qty: number; cost: number; vehicleId?: number | null }) {
  const { item, holder } = d;
  await exec(`INSERT INTO stock_movements (doc_id, item_id, movement_date, holder_type, holder_id, qty, unit_cost, vehicle_id) VALUES (:doc, :item, :date, :ht, :hid, :qty, :cost, :veh)`,
    { doc: d.docId, item: item.id, date: d.date, ht: holder.type, hid: holder.id, qty: d.qty, cost: d.cost, veh: d.vehicleId ?? null }, tx);
  if (holder.type !== 'WAREHOUSE' && holder.type !== 'VEHICLE') return;
  const bal = await q1<any>('SELECT qty::float AS qty FROM stock_balances WHERE item_id = :i AND holder_type = :t AND holder_id = :h FOR UPDATE', { i: item.id, t: holder.type, h: holder.id }, tx);
  const have = bal?.qty ?? 0;
  if (have + d.qty < -0.0004) throw unprocessable(`Not enough stock: ${item.code} ${item.name} has ${r3(have)} ${item.unit} at ${await holderName(holder as Holder, tx)}, but ${r3(-d.qty)} is needed.`, { fields: { qty: 'Exceeds available stock' } });
  await exec(`INSERT INTO stock_balances (item_id, holder_type, holder_id, qty) VALUES (:i, :t, :h, GREATEST(:q, 0)) ON CONFLICT (item_id, holder_type, holder_id) DO UPDATE SET qty = stock_balances.qty + :q, updated_at = now()`,
    { i: item.id, t: holder.type, h: holder.id, q: d.qty }, tx);
}

const expKey = (kind: string) => (kind === 'TYRE' ? 'exp_tyres' : 'exp_parts');

/** GL lines for value moving between holders. Warehouse stock sits in Inventory; stock fitted to a bowzer is charged to that bowzer's account. */
function glFor(from: Holder | null, to: Holder | null, value: number, kind: string): LineInput[] {
  const k = expKey(kind); if (!(value > 0)) return [];
  if (from?.type === 'WAREHOUSE' && to?.type === 'VEHICLE') return [{ accountKey: k, debit: value, vehicleId: to.id }, { accountKey: 'inventory', credit: value }];
  if (from?.type === 'VEHICLE' && to?.type === 'WAREHOUSE') return [{ accountKey: 'inventory', debit: value }, { accountKey: k, credit: value, vehicleId: from.id }];
  if (from?.type === 'VEHICLE' && to?.type === 'VEHICLE' && from.id !== to.id) return [{ accountKey: k, debit: value, vehicleId: to.id }, { accountKey: k, credit: value, vehicleId: from.id }];
  return [];
}

async function serialOps(tx: any, a: { kind: 'RECEIVE' | 'FIT' | 'REMOVE' | 'MOVE' | 'DISCARD'; item: any; serial: string; docId: number; date: string; warehouseId?: number; vehicle?: any; position?: string; cost?: number; disposition?: string; to?: Holder | null; user?: AuthUser | null }) {
  const { item, serial } = a;
  const tyre = await q1<any>('SELECT * FROM tyres WHERE serial_no = :s FOR UPDATE', { s: serial }, tx);
  const ev = (type: string, veh: number | null, odo: number | null, pos: string | null, note?: string) => exec(
    `INSERT INTO tyre_events (tyre_id, vehicle_id, event_type, event_date, odometer, position, doc_id, note, created_by) VALUES (:t, :v, :e, :d, :o, :p, :doc, :n, :u)`,
    { t: tyre?.id ?? (a as any).tyreId, v: veh, e: type, d: a.date, o: odo, p: pos, doc: a.docId, n: note ?? null, u: a.user?.id ?? null }, tx);
  if (a.kind === 'RECEIVE') {
    if (tyre) throw unprocessable(`Serial number ${serial} is already registered.`, { fields: { serialNo: 'Duplicate serial' } });
    const size = item.name.match(/\d{3}\/\d{2}R\d{2}(\.\d)?|\d{2}\.\d{2}R\d{2}|\d{3}R\d{2}(\.\d)?/)?.[0] ?? null;
    const row = a.vehicle
      ? await q1<any>(`INSERT INTO tyres (serial_no, item_id, size, cost, status, vehicle_id, position, fitted_on, odometer_fit) VALUES (:s, :i, :sz, :c, 'FITTED', :v, :p, :d, :o) RETURNING id`, { s: serial, i: item.id, sz: size, c: a.cost ?? 0, v: a.vehicle.id, p: a.position ?? 'W1', d: a.date, o: a.vehicle.odometer_km }, tx)
      : await q1<any>(`INSERT INTO tyres (serial_no, item_id, size, cost, status, warehouse_id) VALUES (:s, :i, :sz, :c, 'IN_STORE', :w) RETURNING id`, { s: serial, i: item.id, sz: size, c: a.cost ?? 0, w: a.warehouseId }, tx);
    (a as any).tyreId = row.id; await exec(`INSERT INTO tyre_events (tyre_id, event_type, event_date, doc_id, created_by) VALUES (:t, 'PURCHASED', :d, :doc, :u)`, { t: row.id, d: a.date, doc: a.docId, u: a.user?.id ?? null }, tx);
    return;
  }
  if (!tyre || tyre.item_id !== item.id) throw unprocessable(`Serial number ${serial} is not a registered ${item.name}.`, { fields: { serialNo: 'Unknown serial' } });
  if (a.kind === 'FIT') {
    if (!['IN_STORE', 'RETREAD'].includes(tyre.status)) throw unprocessable(`Tyre ${serial} is ${tyre.status.toLowerCase().replace('_', ' ')} and cannot be fitted.`);
    if (tyre.warehouse_id !== a.warehouseId) throw unprocessable(`Tyre ${serial} is not in the selected store.`);
    if (!a.position) throw badRequest('Choose the wheel position for the tyre.', { fields: { position: 'Required' } });
    if (await q1('SELECT 1 AS x FROM tyres WHERE vehicle_id = :v AND position = :p AND status = \'FITTED\'', { v: a.vehicle.id, p: a.position }, tx)) throw unprocessable(`Position ${a.position} on ${a.vehicle.code} already has a tyre. Remove it first (or use Parts replacement).`, { fields: { position: 'Occupied' } });
    await exec(`UPDATE tyres SET status = 'FITTED', vehicle_id = :v, position = :p, fitted_on = :d, odometer_fit = :o, warehouse_id = NULL WHERE id = :id`, { v: a.vehicle.id, p: a.position, d: a.date, o: a.vehicle.odometer_km, id: tyre.id }, tx);
    await ev('FIT', a.vehicle.id, a.vehicle.odometer_km, a.position);
  } else if (a.kind === 'MOVE') {
    if (tyre.status !== 'FITTED' || tyre.vehicle_id !== a.vehicle.id) throw unprocessable(`Tyre ${serial} is not fitted on ${a.vehicle.code}.`);
    await exec(`UPDATE tyres SET km_run = km_run + GREATEST(0, :o - COALESCE(odometer_fit, :o)) WHERE id = :id`, { o: a.vehicle.odometer_km, id: tyre.id }, tx);
    await ev('REMOVE', a.vehicle.id, a.vehicle.odometer_km, tyre.position, 'Transferred to another bowzer');
    await exec(`UPDATE tyres SET vehicle_id = :v, position = :p, fitted_on = :d, odometer_fit = :o WHERE id = :id`, { v: a.to!.id, p: a.position ?? tyre.position, d: a.date, o: (await q1<any>('SELECT odometer_km FROM vehicles WHERE id = :id', { id: a.to!.id }, tx))?.odometer_km ?? 0, id: tyre.id }, tx);
    await ev('FIT', a.to!.id, null, a.position ?? tyre.position);
  } else if (a.kind === 'REMOVE') {
    if (tyre.status !== 'FITTED' || tyre.vehicle_id !== a.vehicle.id) throw unprocessable(`Tyre ${serial} is not fitted on ${a.vehicle.code}.`, { fields: { removeSerialNo: 'Not on this bowzer' } });
    const run = Math.max(0, a.vehicle.odometer_km - (tyre.odometer_fit ?? a.vehicle.odometer_km));
    const d = a.disposition ?? 'RETURN';
    const status = d === 'SCRAP' ? 'SCRAPPED' : d === 'RETREAD' ? 'RETREAD' : 'IN_STORE';
    await exec(`UPDATE tyres SET status = :st, vehicle_id = NULL, position = NULL, warehouse_id = :w, km_run = km_run + :run, retread_count = retread_count + :rt WHERE id = :id`, { st: status, w: status === 'SCRAPPED' ? null : a.warehouseId ?? null, run, rt: d === 'RETREAD' ? 1 : 0, id: tyre.id }, tx);
    await ev(d === 'SCRAP' ? 'SCRAP' : d === 'RETREAD' ? 'RETREAD' : 'REMOVE', a.vehicle.id, a.vehicle.odometer_km, tyre.position, `After ${run} km`);
  } else if (a.kind === 'DISCARD') {
    if (tyre.status !== 'IN_STORE') throw unprocessable(`Tyre ${serial} is not in store.`);
    await exec(`UPDATE tyres SET status = 'SCRAPPED', warehouse_id = NULL WHERE id = :id`, { id: tyre.id }, tx);
    await ev('SCRAP', null, null, null, 'Returned to vendor');
  }
}

export async function postStockDoc(user: AuthUser | null, req: any, input: StockDocInput, tx?: any): Promise<any> {
  if (!tx) return sequelize.transaction((t) => postStockDoc(user, req, input, t));
  const date = input.date ?? today();
  await fiscalYearFor(date, tx);
  if (!input.lines.length) throw badRequest('Add at least one item line.');
  const ids = [...new Set(input.lines.flatMap((l) => [l.itemId, l.removeItemId].filter(Boolean) as number[]))];
  const items = await q<any>(`SELECT i.id, i.code, i.name, i.unit, i.avg_cost::float AS avg_cost, i.serialized, c.kind FROM items i JOIN item_categories c ON c.id = i.category_id WHERE i.id IN (:ids) AND i.active`, { ids }, tx);
  const im = new Map(items.map((i: any) => [i.id, i]));
  for (const id of ids) if (!im.has(id)) throw notFound('Item');
  const t = input.type;
  const veh = input.vehicleId ? await q1<any>('SELECT id, code, odometer_km FROM vehicles WHERE id = :id', { id: input.vehicleId }, tx) : null;
  let from = input.from ?? null; let to = input.to ?? null;
  // Normalise holders per document type
  if (t === 'OPENING' || t === 'PURCHASE') { from = null; await checkHolder(to, 'warehouse', tx); if (to!.type !== 'WAREHOUSE' && t === 'PURCHASE') throw badRequest('Stock must be received into a warehouse.'); }
  if (t === 'PURCHASE_RETURN' || t === 'ISSUE' || t === 'ADJUSTMENT') { if (t === 'ADJUSTMENT' && !from && to) from = to; await checkHolder(from, 'warehouse', tx); if (from!.type !== 'WAREHOUSE') throw badRequest('Choose a warehouse.'); to = null; }
  if (t === 'NAVIGATION') { await checkHolder(from, 'from', tx); await checkHolder(to, 'to', tx); if (from!.type === to!.type && from!.id === to!.id) throw badRequest('From and to cannot be the same.', { fields: { to: 'Same as from' } }); }
  if (t === 'PARTS_REPLACEMENT') { if (!veh) throw badRequest('Choose the bowzer being repaired.', { fields: { vehicleId: 'Required' } }); await checkHolder(from, 'warehouse', tx); if (from!.type !== 'WAREHOUSE') throw badRequest('New parts come from a warehouse.'); to = { type: 'VEHICLE', id: veh.id }; }
  if (t === 'ISSUE' && !veh) throw badRequest('Choose the bowzer the items are issued to.', { fields: { vehicleId: 'Required' } });
  if ((t === 'PURCHASE' || t === 'PURCHASE_RETURN') && !input.vendorId) throw badRequest('Choose the vendor.', { fields: { vendorId: 'Required' } });
  const vendor = input.vendorId ? await q1<any>('SELECT id, name FROM vendors WHERE id = :id', { id: input.vendorId }, tx) : null;
  if (input.vendorId && !vendor) throw notFound('Vendor');
  if (t === 'NAVIGATION' && (from!.type === 'VEHICLE' || to!.type === 'VEHICLE')) { /* vehicle holder implied */ }

  const seq = await q1<{ n: number }>(`SELECT nextval('stock_doc_seq')::int AS n`, {}, tx);
  const docNo = `${PREFIX[t]}-${date.slice(2, 4)}-${String(seq!.n).padStart(5, '0')}`;
  const doc = await q1<any>(`INSERT INTO stock_docs (doc_no, type, doc_date, from_type, from_id, to_type, to_id, vehicle_id, vendor_id, po_id, pay_mode, narration, created_by)
    VALUES (:no, :t, :d, :ft, :fid, :tt, :tid, :veh, :ven, :po, :pm, :n, :u) RETURNING *`,
    { no: docNo, t, d: date, ft: from?.type ?? null, fid: from?.id ?? null, tt: to?.type ?? null, tid: to?.id ?? null, veh: veh?.id ?? (to?.type === 'VEHICLE' ? to.id : from?.type === 'VEHICLE' ? from.id : null), ven: vendor?.id ?? null, po: input.poId ?? null, pm: input.payMode ?? null, n: input.narration ?? null, u: user?.id ?? null }, tx);

  const gl: LineInput[] = []; let total = 0; let n = 1;
  const costsByItem = new Map<number, number>();
  for (const l of input.lines) {
    const item = im.get(l.itemId);
    if (item.serialized && Math.abs(l.qty) !== 1) throw badRequest(`${item.name} is tracked by serial number: add one line per unit.`, { fields: { qty: 'Use 1 per serial' } });
    if (item.serialized && !l.serialNo && !['ADJUSTMENT'].includes(t)) throw badRequest(`Enter the serial number for ${item.name}.`, { fields: { serialNo: 'Required' } });
    if (!(t === 'ADJUSTMENT') && !(l.qty > 0)) throw badRequest('Quantities must be above zero.', { fields: { qty: 'Must be above zero' } });
    if (t === 'ADJUSTMENT' && l.qty === 0) throw badRequest('Adjustment quantity cannot be zero.');
    const qty = r3(l.qty);
    const avg = item.avg_cost;
    let cost = l.unitCost ?? avg;
    if (t === 'PURCHASE' || t === 'OPENING') { if (!(l.unitCost! >= 0) || l.unitCost == null) throw badRequest(`Enter the unit cost for ${item.name}.`, { fields: { unitCost: 'Required' } }); cost = l.unitCost; }
    const value = r2(qty * cost);
    let removeValue = 0;
    // ---- stock movements & ledger by type ----
    if (t === 'OPENING' || t === 'PURCHASE') {
      await move(tx, { docId: doc.id, date, item, holder: to!, qty, cost });
      if (to!.type === 'VEHICLE') {
        // opening fitment: already part of the bowzer's carried-forward cost, so no ledger entry and no change to the store's average cost
        if (item.serialized) await serialOps(tx, { kind: 'RECEIVE', item, serial: l.serialNo!, docId: doc.id, date, vehicle: await q1<any>('SELECT id, code, odometer_km FROM vehicles WHERE id = :id', { id: to!.id }, tx), position: l.position, cost, user });
        if (!(avg > 0)) { await exec('UPDATE items SET avg_cost = :a WHERE id = :i', { a: cost, i: item.id }, tx); item.avg_cost = cost; }
        total += 0; costsByItem.set(item.id, cost);
        await exec(`INSERT INTO stock_doc_lines (doc_id, line_no, item_id, qty, unit_cost, line_value, serial_no, position) VALUES (:d, :n, :i, :q, :c, 0, :s, :p)`, { d: doc.id, n: n++, i: item.id, q: qty, c: cost, s: l.serialNo ?? null, p: l.position ?? null }, tx);
        continue;
      }
      if (item.serialized) await serialOps(tx, { kind: 'RECEIVE', item, serial: l.serialNo!, docId: doc.id, date, warehouseId: to!.id, cost, user });
      const onHand = (await q1<any>("SELECT COALESCE(sum(qty), 0)::float AS q FROM stock_balances WHERE item_id = :i AND holder_type = 'WAREHOUSE'", { i: item.id }, tx))!.q - qty;
      const newAvg = onHand + qty > 0 ? r2((Math.max(0, onHand) * avg + qty * cost) / (Math.max(0, onHand) + qty)) : cost;
      await exec('UPDATE items SET avg_cost = :a WHERE id = :i', { a: newAvg, i: item.id }, tx); item.avg_cost = newAvg;
      gl.push({ accountKey: 'inventory', debit: value });
    } else if (t === 'PURCHASE_RETURN') {
      await move(tx, { docId: doc.id, date, item, holder: from!, qty: -qty, cost });
      await move(tx, { docId: doc.id, date, item, holder: { type: 'VENDOR', id: vendor!.id }, qty, cost });
      if (item.serialized) await serialOps(tx, { kind: 'DISCARD', item, serial: l.serialNo!, docId: doc.id, date, user });
      const invValue = r2(qty * avg); const variance = r2(value - invValue);
      gl.push({ accountKey: 'inventory', credit: invValue });
      if (variance > 0) gl.push({ accountKey: 'exp_parts', credit: variance }); else if (variance < 0) gl.push({ accountKey: 'exp_parts', debit: -variance });
    } else if (t === 'ADJUSTMENT') {
      await move(tx, { docId: doc.id, date, item, holder: from!, qty, cost: avg });
      const v = r2(Math.abs(qty) * avg);
      gl.push(qty > 0 ? { accountKey: 'inventory', debit: v } : { accountKey: 'inventory', credit: v }, qty > 0 ? { accountKey: 'exp_parts', credit: v } : { accountKey: 'exp_parts', debit: v });
    } else if (t === 'ISSUE') {
      await move(tx, { docId: doc.id, date, item, holder: from!, qty: -qty, cost: avg, vehicleId: veh!.id });
      await move(tx, { docId: doc.id, date, item, holder: { type: 'CONSUMED', id: veh!.id }, qty, cost: avg, vehicleId: veh!.id });
      gl.push({ accountKey: expKey(item.kind), debit: r2(qty * avg), vehicleId: veh!.id }, { accountKey: 'inventory', credit: r2(qty * avg) });
    } else if (t === 'NAVIGATION') {
      const f = from!, to2 = to!;
      await move(tx, { docId: doc.id, date, item, holder: f, qty: -qty, cost: avg, vehicleId: f.type === 'VEHICLE' ? f.id : to2.type === 'VEHICLE' ? to2.id : null });
      await move(tx, { docId: doc.id, date, item, holder: to2, qty, cost: avg, vehicleId: to2.type === 'VEHICLE' ? to2.id : f.type === 'VEHICLE' ? f.id : null });
      gl.push(...glFor(f, to2, r2(qty * avg), item.kind));
      if (item.serialized) {
        if (f.type === 'WAREHOUSE' && to2.type === 'VEHICLE') { const v = await q1<any>('SELECT id, code, odometer_km FROM vehicles WHERE id = :id', { id: to2.id }, tx); await serialOps(tx, { kind: 'FIT', item, serial: l.serialNo!, docId: doc.id, date, warehouseId: f.id, vehicle: v, position: l.position, user }); }
        else if (f.type === 'VEHICLE' && to2.type === 'WAREHOUSE') { const v = await q1<any>('SELECT id, code, odometer_km FROM vehicles WHERE id = :id', { id: f.id }, tx); await serialOps(tx, { kind: 'REMOVE', item, serial: l.serialNo!, docId: doc.id, date, warehouseId: to2.id, vehicle: v, disposition: 'RETURN', user }); }
        else if (f.type === 'VEHICLE' && to2.type === 'VEHICLE') { const v = await q1<any>('SELECT id, code, odometer_km FROM vehicles WHERE id = :id', { id: f.id }, tx); await serialOps(tx, { kind: 'MOVE', item, serial: l.serialNo!, docId: doc.id, date, vehicle: v, position: l.position, to: to2, user }); }
        else { const tyre = await q1<any>('SELECT id, status, warehouse_id FROM tyres WHERE serial_no = :s', { s: l.serialNo }, tx); if (!tyre || tyre.warehouse_id !== f.id) throw unprocessable(`Tyre ${l.serialNo} is not in the source store.`); await exec('UPDATE tyres SET warehouse_id = :w WHERE id = :id', { w: to2.id, id: tyre.id }, tx); }
      }
    } else if (t === 'PARTS_REPLACEMENT') {
      if (l.removeItemId) {
        const ri = im.get(l.removeItemId); const rq = r3(l.removeQty ?? 1); const disp = l.removeDisposition ?? 'SCRAP';
        if (!(rq > 0)) throw badRequest('Removed quantity must be above zero.');
        if (ri.serialized && !l.removeSerialNo) throw badRequest(`Enter the serial number of the removed ${ri.name}.`, { fields: { removeSerialNo: 'Required' } });
        await move(tx, { docId: doc.id, date, item: ri, holder: { type: 'VEHICLE', id: veh!.id }, qty: -rq, cost: ri.avg_cost, vehicleId: veh!.id });
        if (disp === 'SCRAP') await move(tx, { docId: doc.id, date, item: ri, holder: { type: 'SCRAP', id: veh!.id }, qty: rq, cost: ri.avg_cost, vehicleId: veh!.id });
        else { await move(tx, { docId: doc.id, date, item: ri, holder: from!, qty: rq, cost: ri.avg_cost, vehicleId: veh!.id }); removeValue = r2(rq * ri.avg_cost); gl.push(...glFor({ type: 'VEHICLE', id: veh!.id }, from!, removeValue, ri.kind)); }
        if (ri.serialized) await serialOps(tx, { kind: 'REMOVE', item: ri, serial: l.removeSerialNo!, docId: doc.id, date, warehouseId: from!.id, vehicle: veh, disposition: disp, user });
      }
      await move(tx, { docId: doc.id, date, item, holder: from!, qty: -qty, cost: avg, vehicleId: veh!.id });
      await move(tx, { docId: doc.id, date, item, holder: { type: 'VEHICLE', id: veh!.id }, qty, cost: avg, vehicleId: veh!.id });
      gl.push(...glFor(from!, { type: 'VEHICLE', id: veh!.id }, r2(qty * avg), item.kind));
      if (item.serialized) await serialOps(tx, { kind: 'FIT', item, serial: l.serialNo!, docId: doc.id, date, warehouseId: from!.id, vehicle: veh, position: l.position, user });
    }
    total += value; costsByItem.set(item.id, cost);
    await exec(`INSERT INTO stock_doc_lines (doc_id, line_no, item_id, qty, unit_cost, line_value, serial_no, position, remove_item_id, remove_qty, remove_serial_no, remove_disposition, reason)
      VALUES (:d, :n, :i, :q, :c, :v, :s, :p, :ri, :rq, :rs, :rd, :r)`,
      { d: doc.id, n: n++, i: item.id, q: qty, c: cost, v: value, s: l.serialNo ?? null, p: l.position ?? null, ri: l.removeItemId ?? null, rq: l.removeItemId ? l.removeQty ?? 1 : null, rs: l.removeSerialNo ?? null, rd: l.removeItemId ? l.removeDisposition ?? 'SCRAP' : null, r: l.reason ?? null }, tx);
  }
  total = r2(total);
  // ---- ledger posting ----
  let vtype = 'STOCK'; let lines = gl;
  if (t === 'OPENING') { lines = [...gl, { accountKey: 'capital', credit: total }]; vtype = 'OPENING'; }
  else if (t === 'PURCHASE' || t === 'PURCHASE_RETURN') {
    const mode = input.payMode ?? 'CREDIT'; const isRet = t === 'PURCHASE_RETURN';
    let counter: LineInput;
    if (mode === 'CREDIT') counter = { accountKey: 'payable', partyType: 'VENDOR', partyId: vendor!.id };
    else if (mode === 'CASH') counter = { accountKey: 'cash' };
    else { const b = input.bankId ? await q1<any>('SELECT account_id FROM banks WHERE id = :id', { id: input.bankId }, tx) : null; if (!b) throw badRequest('Choose the bank account used for payment.', { fields: { bankId: 'Required' } }); counter = { accountId: b.account_id }; }
    lines = [...gl, { ...counter, [isRet ? 'debit' : 'credit']: total }]; vtype = isRet ? 'PURCHASE_RETURN' : 'PURCHASE';
  }
  if (t === 'ADJUSTMENT') { /* gl already balanced */ }
  // balance the multi-item docs that mix a debit expense and inventory credit lines: sums already match per item
  const nonzero = lines.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0);
  if (nonzero.length) {
    const v = await postVoucher({ type: vtype, date, narration: `${STOCK_DOC_LABELS[t]} ${docNo}${vendor ? ` — ${vendor.name}` : ''}${input.narration ? ` · ${input.narration}` : ''}`, lines: nonzero, vehicleId: veh?.id ?? null,
      partyType: vendor ? 'VENDOR' : null, partyId: vendor?.id ?? null, sourceType: 'STOCKDOC', sourceId: doc.id, user }, tx);
    await exec('UPDATE stock_docs SET voucher_id = :v, total_value = :t WHERE id = :id', { v: v.id, t: total, id: doc.id }, tx);
    doc.voucher_id = v.id; doc.voucher_no = v.voucher_no;
  } else await exec('UPDATE stock_docs SET total_value = :t WHERE id = :id', { t: total, id: doc.id }, tx);
  // ---- purchase order receipt ----
  if (t === 'PURCHASE' && input.poId) {
    const po = await q1<any>('SELECT id, status, vendor_id FROM purchase_orders WHERE id = :id FOR UPDATE', { id: input.poId }, tx);
    if (!po) throw notFound('Purchase order');
    if (po.vendor_id !== vendor!.id) throw unprocessable('This purchase order belongs to a different vendor.');
    if (po.status === 'CANCELLED') throw unprocessable('This purchase order is cancelled.');
    for (const l of input.lines) await exec(`UPDATE purchase_order_lines SET received_qty = received_qty + :q WHERE id = (SELECT id FROM purchase_order_lines WHERE po_id = :po AND item_id = :i ORDER BY line_no LIMIT 1)`, { q: l.qty, po: po.id, i: l.itemId }, tx);
    const left = await q1<any>('SELECT sum(GREATEST(qty - received_qty, 0))::float AS left, sum(received_qty)::float AS got FROM purchase_order_lines WHERE po_id = :po', { po: po.id }, tx);
    await exec('UPDATE purchase_orders SET status = :s WHERE id = :id', { s: left.left <= 0.0004 ? 'RECEIVED' : left.got > 0 ? 'PARTIAL' : 'OPEN', id: po.id }, tx);
  }
  await audit(req, { action: 'STOCK_DOC_POSTED', entityType: 'STOCK_DOC', entityId: doc.id, entityLabel: `${docNo} · ${STOCK_DOC_LABELS[t]}${total ? ` · PKR ${total}` : ''}`, tx });
  return { ...doc, total_value: total };
}
void accountId;

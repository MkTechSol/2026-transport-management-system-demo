import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, USERS } from './helpers';
import { q, q1 } from '../src/db/sequelize';

const future = (days: number, hour = 6) => { const d = new Date(Date.now() + days * 86_400_000); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };
const originId = async () => (await q1<any>("SELECT id FROM locations WHERE code = 'PLT-OSK'")).id as number;
const dist = async (city: string) => (await q1<any>("SELECT id, location_id FROM distributors WHERE city = :c AND status = 'ACTIVE' ORDER BY id LIMIT 1", { c: city }));

async function readyTrip(stops: any[], extra: Record<string, unknown> = {}, depDay = 9) {
  const d = await as(USERS.dispatcher);
  const created = await d.post('/trips', { originLocationId: await originId(), stops, scheduledDeparture: future(depDay), lpgSource: 'LOCAL', priority: 'NORMAL', submit: true, ...extra });
  return { d, created };
}
async function onTheRoad(d: any, tripId: number, loaded: number) {
  const c = (await d.get(`/trips/${tripId}/candidates`)).body;
  const v = c.vehicles.find((x: any) => x.eligible); const dr = c.drivers.find((x: any) => x.eligible);
  expect((await d.post(`/trips/${tripId}/assign`, { vehicleId: v.id, driverId: dr.id })).status).toBe(200);
  expect((await d.post(`/trips/${tripId}/transition`, { to: 'DISPATCHED' })).status).toBe(200);
  await d.post(`/trips/${tripId}/safety-checks`, { kind: 'PRE_TRIP', items: [{ key: 'a', label: 'Valves', ok: true }] });
  expect((await d.post(`/trips/${tripId}/transition`, { to: 'IN_TRANSIT', loadedMt: loaded })).status).toBe(200);
}

describe('multi-drop trips', () => {
  it('plans a trip A → B, C, D with ordered stops, composite route and summed load', async () => {
    const [b, c, e] = [await dist('Peshawar'), await dist('Mardan'), await dist('Nowshera')];
    const { created } = await readyTrip([{ distributorId: b.id, plannedMt: 5 }, { distributorId: c.id, plannedMt: 4 }, { distributorId: e.id, plannedMt: 5 }]);
    expect(created.status).toBe(201);
    const { trip, stops } = created.body;
    expect(trip.stop_count).toBe(3);
    expect(Number(trip.planned_load_mt)).toBe(14);
    expect(trip.distributor_id).toBe(e.id); // mirrors the final stop so existing reports keep working
    expect(stops.map((s: any) => s.seq)).toEqual([1, 2, 3]);
    expect(stops.map((s: any) => s.distributor_id)).toEqual([b.id, c.id, e.id]);
    const fr = stops.map((s: any) => Number(s.route_frac));
    expect(fr[0]).toBeGreaterThan(0); expect(fr[0]).toBeLessThan(fr[1]); expect(fr[1]).toBeLessThan(fr[2]); expect(fr[2]).toBe(1);
    const etas = stops.map((s: any) => new Date(s.eta_at).getTime());
    expect(etas[0]).toBeLessThan(etas[1]); expect(etas[1]).toBeLessThan(etas[2]);
    expect(new Date(trip.planned_arrival).getTime()).toBeGreaterThanOrEqual(etas[2] - 1000);
    const route = await q1<any>('SELECT kind FROM routes WHERE id = :id', { id: trip.route_id });
    expect(route.kind).toBe('MULTI');
    // direct-route listing is not polluted by composite routes
    const routes = (await (await as(USERS.manager)).get('/routes?pageSize=100')).body;
    expect(routes.data.length).toBeGreaterThan(0);
    expect(routes.data.some((r: any) => String(r.name).includes(' › '))).toBe(false);
  });

  it('validates the stop list', async () => {
    const d = await as(USERS.dispatcher);
    const b = await dist('Peshawar'); const base = { originLocationId: await originId(), scheduledDeparture: future(11), lpgSource: 'LOCAL', priority: 'NORMAL' };
    expect((await d.post('/trips', { ...base, stops: [{ distributorId: b.id, plannedMt: 5 }, { distributorId: b.id, plannedMt: 4 }] })).status).toBe(400); // same place twice
    expect((await d.post('/trips', { ...base, stops: [{ locationId: await originId(), plannedMt: 5 }] })).status).toBe(400); // origin as stop
    expect((await d.post('/trips', { ...base, stops: Array.from({ length: 9 }, () => ({ locationId: b.location_id, plannedMt: 1 })) })).status).toBe(400);
    expect((await d.post('/trips', { ...base, stops: [{ distributorId: b.id, plannedMt: 40 }, { distributorId: (await dist('Mardan')).id, plannedMt: 30 }] })).status).toBe(400); // > 60 MT
    const field = await q1<any>("SELECT id FROM locations WHERE type = 'FIELD' AND status = 'ACTIVE' LIMIT 1");
    const plant = await q1<any>("SELECT id FROM locations WHERE type = 'PLANT' AND status = 'ACTIVE' LIMIT 2");
    const upl = await d.post('/trips', { ...base, originLocationId: field.id, stops: [{ locationId: plant.id, plannedMt: 5 }, { locationId: (await dist('Mardan')).location_id, plannedMt: 5 }] });
    expect(upl.status).toBe(400);
    expect(upl.body.error.message).toMatch(/single destination/);
  });

  it('serves stops in order, tracks load on board, bills each customer and rolls up totals', async () => {
    const [b, c, e] = [await dist('Peshawar'), await dist('Mardan'), await dist('Nowshera')];
    const { d, created } = await readyTrip([{ distributorId: b.id, plannedMt: 5 }, { distributorId: c.id, plannedMt: 4 }, { distributorId: e.id, plannedMt: 5 }], {}, 13);
    const tid = created.body.trip.id; const [s1, s2, s3] = created.body.stops;
    await onTheRoad(d, tid, 14);

    // final stop cannot be reached while drops are open
    const early = await d.post(`/trips/${tid}/transition`, { to: 'ARRIVED' });
    expect(early.status).toBe(422); expect(early.body.error.message).toMatch(/Stop 1/);
    // order is enforced
    expect((await d.post(`/trips/${tid}/stops/${s2.id}/arrive`, {})).status).toBe(422);
    // the final stop uses the trip transitions, not the stop endpoint
    expect((await d.post(`/trips/${tid}/stops/${s3.id}/arrive`, {})).status).toBe(400);

    expect((await d.post(`/trips/${tid}/stops/${s1.id}/arrive`, {})).body.stops[0].status).toBe('ARRIVED');
    expect((await d.post(`/trips/${tid}/stops/${s1.id}/deliver`, { deliveredMt: 20, receivedBy: 'X' })).status).toBe(422); // more than on board
    expect((await d.post(`/trips/${tid}/stops/${s1.id}/deliver`, { deliveredMt: 5 })).status).toBe(400); // receivedBy required
    const d1 = await d.post(`/trips/${tid}/stops/${s1.id}/deliver`, { deliveredMt: 4.9, receivedBy: 'Gul', deliveryNoteNo: 'DN-A' });
    expect(d1.status).toBe(200);
    expect(Number(d1.body.trip.delivered_mt)).toBe(4.9);
    // idempotent offline replay does not double-deliver
    expect((await d.post(`/trips/${tid}/stops/${s1.id}/deliver`, { deliveredMt: 4.9, receivedBy: 'Gul' })).status).toBe(409);

    expect((await d.post(`/trips/${tid}/stops/${s2.id}/skip`, {})).status).toBe(400); // reason needed
    const sk = await d.post(`/trips/${tid}/stops/${s2.id}/skip`, { reason: 'Tank not ready' });
    expect(sk.body.stops[1].status).toBe('SKIPPED');

    expect((await d.post(`/trips/${tid}/transition`, { to: 'ARRIVED' })).body.stops[2].status).toBe('ARRIVED');
    // 14 loaded, 4.9 delivered → at most 9.1 (+0.5 tolerance) can go to the last stop
    expect((await d.post(`/trips/${tid}/transition`, { to: 'DELIVERED', deliveredMt: 10, receivedBy: 'Z' })).status).toBe(422);
    const fin = await d.post(`/trips/${tid}/transition`, { to: 'DELIVERED', deliveredMt: 9, receivedBy: 'Imran', deliveryNoteNo: 'DN-C' });
    expect(fin.status).toBe(200);
    expect(Number(fin.body.trip.delivered_mt)).toBeCloseTo(13.9, 2);
    expect(fin.body.trip.received_by).toBe('Imran');

    expect((await d.post(`/trips/${tid}/transition`, { to: 'RETURNING' })).status).toBe(200);
    expect((await d.post(`/trips/${tid}/transition`, { to: 'COMPLETED' })).status).toBe(200);

    // one invoice per customer that received gas (skipped stop is not billed), line quantities = delivered per stop
    const invs = await q<any>(`SELECT i.customer_id, i.subtotal::float AS subtotal, (SELECT json_agg(l.qty::float ORDER BY l.line_no) FROM sales_invoice_lines l WHERE l.invoice_id = i.id) AS qty FROM sales_invoices i WHERE i.trip_id = :t AND i.kind = 'INVOICE' ORDER BY i.id`, { t: tid });
    expect(invs.map((i: any) => i.customer_id).sort()).toEqual([b.id, e.id].sort());
    expect(invs.find((i: any) => i.customer_id === b.id).qty).toEqual([4.9]);
    expect(invs.find((i: any) => i.customer_id === e.id).qty).toEqual([9]);
    const stopsDb = await q<any>('SELECT seq, freight_per_mt::float AS rate, delivered_mt::float AS mt FROM trip_stops WHERE trip_id = :t ORDER BY seq', { t: tid });
    const expected = Math.round(stopsDb[0].rate * 4.9) + Math.round(stopsDb[2].rate * 9);
    expect(Math.round(invs.reduce((a: number, i: any) => a + i.subtotal, 0))).toBeCloseTo(expected, -1);
    // weighted trip rate × delivered ≈ invoiced freight (rounding of the average rate only)
    const t = await q1<any>('SELECT freight_per_mt::float AS fr, delivered_mt::float AS mt FROM trips WHERE id = :t', { t: tid });
    expect(Math.abs(t.fr * t.mt - invs.reduce((a: number, i: any) => a + i.subtotal, 0))).toBeLessThan(5);
    // ledger stays balanced
    const integ = (await (await as(USERS.superAdmin)).get('/setup/integrity')).body;
    expect(integ.checks.filter((x: any) => !x.ok)).toEqual([]);
  });

  it('shows stops to drivers without freight, and tariffs only to finance roles', async () => {
    const [b, c] = [await dist('Peshawar'), await dist('Mardan')];
    const { created } = await readyTrip([{ distributorId: b.id, plannedMt: 6 }, { distributorId: c.id, plannedMt: 6 }], {}, 15);
    const tid = created.body.trip.id;
    const acct = await as(USERS.accountant);
    const fin = (await acct.get(`/trips/${tid}`)).body;
    expect(fin.stops[0].freight_per_mt).toBeDefined();
    const mgr = (await (await as(USERS.dispatcher)).get(`/trips/${tid}`)).body;
    expect(mgr.stops.length).toBe(2);
    expect(mgr.stops[0].freight_per_mt).toBeUndefined();
    expect(mgr.trip.freight_per_mt).toBeUndefined();
    // drivers cannot operate stops of a trip that is not theirs
    const drv = await as(USERS.driver);
    expect([403, 404, 409, 422]).toContain((await drv.post(`/trips/${tid}/stops/${created.body.stops[0].id}/arrive`, {})).status);
    // preview shows ETA per stop
    const prev = await (await as(USERS.dispatcher)).get(`/trips/route-preview?originId=${await originId()}&stopIds=${b.location_id},${c.location_id}`);
    expect(prev.body.stops.length).toBe(2);
    expect(prev.body.stops[0].etaMin).toBeLessThan(prev.body.stops[1].etaMin);
  });

  it('edits the stops of an unassigned trip and keeps customer stats per drop', async () => {
    const [b, c, e] = [await dist('Peshawar'), await dist('Mardan'), await dist('Nowshera')];
    const { d, created } = await readyTrip([{ distributorId: b.id, plannedMt: 5 }, { distributorId: c.id, plannedMt: 5 }], {}, 17);
    const tid = created.body.trip.id;
    const upd = await d.patch(`/trips/${tid}`, { stops: [{ distributorId: b.id, plannedMt: 5 }, { distributorId: c.id, plannedMt: 5 }, { distributorId: e.id, plannedMt: 3 }] });
    expect(upd.status).toBe(200);
    expect(upd.body.trip.stop_count).toBe(3);
    expect(Number(upd.body.trip.planned_load_mt)).toBe(13);
    expect(upd.body.trip.distributor_id).toBe(e.id);
    // totals on a multi-drop trip are derived from its stops
    expect((await d.patch(`/trips/${tid}`, { plannedLoadMt: 20 })).status).toBe(400);
    const list = (await d.get(`/trips?distributorId=${c.id}&pageSize=100`)).body;
    expect(list.data.some((t: any) => t.id === tid && t.stop_count === 3 && t.stops_label)).toBe(true);
    const cust = (await (await as(USERS.manager)).get(`/distributors/${c.id}`)).body;
    expect(cust.trips.find((t: any) => t.id === tid)).toBeTruthy();
  });

  it('public tracking exposes only city-level stop progress', async () => {
    const [b, c] = [await dist('Peshawar'), await dist('Mardan')];
    const { created } = await readyTrip([{ distributorId: b.id, plannedMt: 5 }, { distributorId: c.id, plannedMt: 5 }], {}, 19);
    const tok = (await q1<any>('SELECT public_token FROM trips WHERE id = :id', { id: created.body.trip.id })).public_token;
    const r = await request(app).get(`/api/v1/public/track/${tok}`);
    expect([200, 404]).toContain(r.status); // DRAFT/CANCELLED hidden; PLANNED visible
    if (r.status === 200) {
      expect(r.body.stops.length).toBe(2);
      expect(JSON.stringify(r.body)).not.toMatch(/received|distributor|freight/i);
    }
  });
});

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, as, USERS } from './helpers';
import { q1 } from '../src/db/sequelize';

const future = (days: number, hour = 6) => { const d = new Date(Date.now() + days * 86_400_000); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };

async function runningTrip() {
  const d = await as(USERS.dispatcher);
  const loc = await q1<any>("SELECT id FROM locations WHERE code = 'PLT-OSK'");
  const dist = await q1<any>('SELECT id FROM distributors WHERE city = :c ORDER BY id LIMIT 1', { c: 'Mardan' });
  const t = (await d.post('/trips', { originLocationId: loc.id, distributorId: dist.id, plannedLoadMt: 6, scheduledDeparture: future(40 + Math.floor(Math.random() * 50)), submit: true })).body.trip;
  const c = (await d.get(`/trips/${t.id}/candidates`)).body;
  const v = c.vehicles.find((x: any) => x.eligible && x.status === 'AVAILABLE'); const dr = c.drivers.find((x: any) => x.eligible && x.status === 'AVAILABLE');
  expect((await d.post(`/trips/${t.id}/assign`, { vehicleId: v.id, driverId: dr.id })).status).toBe(200);
  expect((await d.post(`/trips/${t.id}/transition`, { to: 'DISPATCHED' })).status).toBe(200);
  await d.post(`/trips/${t.id}/safety-checks`, { items: [{ key: 'a', label: 'Valves', ok: true }] });
  const base = (await q1<any>('SELECT odometer_km FROM vehicles WHERE id = :id', { id: v.id })).odometer_km as number;
  const started = await d.post(`/trips/${t.id}/transition`, { to: 'IN_TRANSIT', loadedMt: 6, odometerKm: base, upliftVoucherNo: 'UPL-TEST-1' });
  expect(started.status).toBe(200);
  return { id: t.id as number, vehicleId: v.id as number, code: t.code as string, base };
}

/** Frees the vehicle/driver again so tests do not exhaust the demo fleet. */
async function finish(id: number, odo = 99_999_999) {
  const d = await as(USERS.dispatcher);
  for (const body of [{ to: 'ARRIVED' }, { to: 'DELIVERED', deliveredMt: 5.9, receivedBy: 'Receiver' }, { to: 'RETURNING' }, { to: 'COMPLETED', odometerKm: odo }]) await d.post(`/trips/${id}/transition`, body);
}

describe('trip economics visibility', () => {
  it('shows freight, income and profit only to finance roles', async () => {
    const trip = await q1<any>("SELECT t.id FROM trips t WHERE t.status = 'COMPLETED' AND t.freight_per_mt > 0 AND EXISTS (SELECT 1 FROM trip_expenses x WHERE x.trip_id = t.id AND x.status = 'APPROVED') ORDER BY t.id DESC LIMIT 1");
    const mgr = (await (await as(USERS.manager)).get(`/trips/${trip.id}`)).body;
    expect(mgr.economics.income).toBeGreaterThan(0);
    expect(mgr.economics.profit).toBeDefined();
    expect(Number(mgr.trip.freight_per_mt)).toBeGreaterThan(0);
    const disp = (await (await as(USERS.dispatcher)).get(`/trips/${trip.id}`)).body;
    expect(disp.economics.income).toBeUndefined();
    expect(disp.economics.profit).toBeUndefined();
    expect(disp.trip.freight_per_mt).toBeUndefined();
    expect(disp.economics.expensesApproved).toBeGreaterThan(0); // expense totals are operational data
  });

  it('profitability reports are restricted by permission', async () => {
    expect((await (await as(USERS.dispatcher)).get('/reports/trip-profitability')).status).toBe(403);
    expect((await (await as(USERS.fleet)).get('/reports/owner-pnl')).status).toBe(403);
    const r = await (await as(USERS.manager)).get('/reports/trip-profitability?pageSize=5');
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThan(0);
    const list = (await (await as(USERS.dispatcher)).get('/reports')).body.reports.map((x: any) => x.key);
    expect(list).not.toContain('trip-profitability');
    expect(list).toContain('expense-summary');
    const dash = await (await as(USERS.dispatcher)).get('/dashboard');
    expect(dash.body.finance).toBeUndefined();
    expect((await (await as(USERS.manager)).get('/dashboard')).body.finance.incomeMtd).toBeGreaterThan(0);
  });
});

describe('expenses and approvals', () => {
  it('auto-approves small expenses and routes large ones to the right approver', async () => {
    const trip = await runningTrip();
    const d = await as(USERS.dispatcher);
    const small = await d.post('/expenses', { tripId: trip.id, category: 'TOLL', amount: 2500 });
    expect(small.status).toBe(201);
    expect(small.body.expense.status).toBe('APPROVED');
    const big = await d.post('/expenses', { tripId: trip.id, category: 'REPAIR', amount: 18000, description: 'Air hose' });
    expect(big.body.expense.status).toBe('SUBMITTED');
    const pending = await (await as(USERS.manager)).get('/approvals?status=PENDING&mine=true&pageSize=100');
    const mine = pending.body.data.find((a: any) => a.entity_id === big.body.expense.id);
    expect(mine).toBeTruthy();
    expect(mine.approver_role).toBe('TRANSPORT_MANAGER');
    // dispatcher cannot decide; fleet manager neither
    expect((await d.post(`/approvals/${mine.id}/decide`, { decision: 'APPROVED' })).status).toBe(403);
    // rejecting needs a reason
    expect((await (await as(USERS.manager)).post(`/approvals/${mine.id}/decide`, { decision: 'REJECTED' })).status).toBe(400);
    const ok = await (await as(USERS.manager)).post(`/approvals/${mine.id}/decide`, { decision: 'APPROVED', note: 'ok' });
    expect(ok.status).toBe(200);
    expect((await q1<any>('SELECT status FROM trip_expenses WHERE id = :id', { id: big.body.expense.id })).status).toBe('APPROVED');
    expect((await (await as(USERS.manager)).post(`/approvals/${mine.id}/decide`, { decision: 'APPROVED' })).status).toBe(409); // already decided
    // very large expense goes to the super admin
    const huge = await d.post('/expenses', { tripId: trip.id, category: 'OTHER', amount: 60000 });
    const a = await q1<any>("SELECT approver_role FROM approvals WHERE entity_type = 'TRIP_EXPENSE' AND entity_id = :id", { id: huge.body.expense.id });
    expect(a.approver_role).toBe('SUPER_ADMIN');
    expect((await (await as(USERS.manager)).post(`/approvals/${(await q1<any>("SELECT id FROM approvals WHERE entity_id = :id AND entity_type = 'TRIP_EXPENSE'", { id: huge.body.expense.id })).id}/decide`, { decision: 'APPROVED' })).status).toBe(403);
    await finish(trip.id, trip.base + 500);
  });

  it('validates expense input and trip state', async () => {
    const d = await as(USERS.dispatcher);
    const planned = (await (await as(USERS.superAdmin)).get('/trips?status=PLANNED&pageSize=1')).body.data[0];
    const r = await d.post('/expenses', { tripId: planned.id, category: 'TOLL', amount: 1000 });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/once the trip is dispatched/);
    const trip = await runningTrip();
    expect((await d.post('/expenses', { tripId: trip.id, category: 'TOUR_STAY', amount: 3000 })).status).toBe(400); // nights required
    expect((await d.post('/expenses', { tripId: trip.id, category: 'TOLL', amount: -5 })).status).toBe(400);
    // viewer cannot record
    expect((await (await as(USERS.viewer)).post('/expenses', { tripId: trip.id, category: 'TOLL', amount: 100 })).status).toBe(403);
    await finish(trip.id, trip.base + 500);
  });

  it('drivers can only record expenses for their own trips', async () => {
    const drv = await as(USERS.driver);
    const me = (await drv.get('/auth/me')).body.user;
    const other = (await (await as(USERS.superAdmin)).get('/trips?status=IN_TRANSIT&pageSize=50')).body.data.find((t: any) => t.driver_id !== me.driverId);
    expect((await drv.post('/expenses', { tripId: other.id, category: 'TOLL', amount: 500 })).status).toBe(403);
  });
});

describe('fuel validation', () => {
  it('flags fills far above the fuel norm and links an approval-gated expense', async () => {
    const trip = await runningTrip();
    const d = await as(USERS.dispatcher);
    const first = await d.post('/fuel', { vehicleId: trip.vehicleId, tripId: trip.id, litres: 100, ratePerL: 280, odometerKm: trip.base + 100, paymentMode: 'CASH' });
    expect(first.status).toBe(201);
    // 300 km later it should take about 115 L (2.6 km/L); 260 L is clearly excessive
    const bad = await d.post('/fuel', { vehicleId: trip.vehicleId, tripId: trip.id, litres: 260, ratePerL: 280, odometerKm: trip.base + 400, paymentMode: 'CASH' });
    expect(bad.body.fuel.status).toBe('FLAGGED');
    expect(bad.body.fuel.flag_reason).toMatch(/above the .* L expected for 300 km/);
    expect(Number(bad.body.fuel.variance_pct)).toBeGreaterThan(20);
    const exp = await q1<any>('SELECT status FROM trip_expenses WHERE fuel_entry_id = :id', { id: bad.body.fuel.id });
    expect(exp.status).toBe('SUBMITTED');
    const good = await d.post('/fuel', { vehicleId: trip.vehicleId, tripId: trip.id, litres: 115, ratePerL: 280, odometerKm: trip.base + 700, paymentMode: 'CARD' });
    expect(good.body.fuel.status).toBe('VALIDATED');
    // odometer going backwards is flagged
    const back = await d.post('/fuel', { vehicleId: trip.vehicleId, litres: 50, ratePerL: 280, odometerKm: trip.base - 5000, paymentMode: 'CASH' });
    expect(back.body.fuel.status).toBe('FLAGGED');
    // manager review
    const rev = await (await as(USERS.manager)).post(`/fuel/${bad.body.fuel.id}/review`, { note: 'receipt checked', accept: false });
    expect(rev.status).toBe(200);
    expect((await q1<any>('SELECT status FROM trip_expenses WHERE fuel_entry_id = :id', { id: bad.body.fuel.id })).status).toBe('REJECTED');
    expect((await (await as(USERS.viewer)).post('/fuel', { vehicleId: trip.vehicleId, litres: 10, ratePerL: 280 })).status).toBe(403);
    await finish(trip.id, trip.base + 800);
  });
});

describe('odometer, uplifting trips and tracking links', () => {
  it('rejects a completion odometer lower than the start reading and records the km run', async () => {
    const trip = await runningTrip();
    const d = await as(USERS.dispatcher);
    await d.post(`/trips/${trip.id}/transition`, { to: 'ARRIVED' });
    await d.post(`/trips/${trip.id}/transition`, { to: 'DELIVERED', deliveredMt: 5.9, receivedBy: 'Receiver' });
    await d.post(`/trips/${trip.id}/transition`, { to: 'RETURNING' });
    const bad = await d.post(`/trips/${trip.id}/transition`, { to: 'COMPLETED', odometerKm: trip.base - 1000 });
    expect(bad.status).toBe(422);
    expect(bad.body.error.message).toMatch(/cannot be lower than the start reading/);
    const ok = await d.post(`/trips/${trip.id}/transition`, { to: 'COMPLETED', odometerKm: trip.base + 260 });
    expect(ok.body.trip.odometer_start).toBe(trip.base);
    expect(ok.body.trip.odometer_end).toBe(trip.base + 260);
    expect(ok.body.trip.uplift_voucher_no).toBe('UPL-TEST-1');
    expect(ok.body.economics.km).toBe(260);
    expect((await q1<any>('SELECT odometer_km FROM vehicles WHERE id = :id', { id: trip.vehicleId })).odometer_km).toBeGreaterThanOrEqual(trip.base + 260);
  });

  it('creates an uplifting trip from a gas field and exposes route freight', async () => {
    const d = await as(USERS.dispatcher);
    const field = await q1<any>("SELECT id FROM locations WHERE code = 'FLD-NSH'");
    const plant = await q1<any>("SELECT id FROM locations WHERE code = 'PLT-OSK'");
    const prev = await d.get(`/trips/route-preview?originId=${field.id}&destinationId=${plant.id}`);
    expect(prev.body.route.freightPerMt).toBeGreaterThan(0);
    const r = await d.post('/trips', { originLocationId: field.id, destinationLocationId: plant.id, plannedLoadMt: 14, scheduledDeparture: future(70), submit: true });
    expect(r.status).toBe(201);
    expect(r.body.trip.trip_type).toBe('UPLIFTING');
    expect(r.body.trip.distributor_id).toBeNull();
  });

  it('serves a privacy-safe public tracking page by token', async () => {
    const live = (await (await as(USERS.superAdmin)).get('/trips?status=IN_TRANSIT&pageSize=1')).body.data[0];
    const detail = (await (await as(USERS.superAdmin)).get(`/trips/${live.id}`)).body.trip;
    const pub = await request(app).get(`/api/v1/public/track/${detail.public_token}`);
    expect(pub.status).toBe(200);
    const text = JSON.stringify(pub.body);
    expect(pub.body.trip.code).toBe(live.code);
    expect(text).not.toMatch(/driver|phone|freight|customer_id|employee/i);
    expect(pub.body.trip.id).toBeUndefined();
    expect((await request(app).get('/api/v1/public/track/not-a-real-token-123456789')).status).toBe(404);
    const draft = (await (await as(USERS.superAdmin)).get('/trips?status=DRAFT&pageSize=1')).body.data[0];
    const dTok = (await (await as(USERS.superAdmin)).get(`/trips/${draft.id}`)).body.trip.public_token;
    expect((await request(app).get(`/api/v1/public/track/${dTok}`)).status).toBe(404); // drafts are not public
  });
});

describe('settings and routes', () => {
  it('lets admins change thresholds that the engine then honours', async () => {
    const mgr = await as(USERS.manager); const admin = await as(USERS.superAdmin);
    expect((await (await as(USERS.dispatcher)).patch('/settings', { 'expense.autoApproveLimit': 99999 })).status).toBe(403);
    expect((await admin.patch('/settings', { 'expense.autoApproveLimit': 'lots' })).status).toBe(400);
    expect((await admin.patch('/settings', { 'nonexistent.key': 1 })).status).toBe(400);
    expect((await admin.patch('/settings', { 'expense.autoApproveLimit': 20000 })).status).toBe(200);
    const trip = await runningTrip();
    const d = await as(USERS.dispatcher);
    expect((await d.post('/expenses', { tripId: trip.id, category: 'REPAIR', amount: 15000 })).body.expense.status).toBe('APPROVED');
    await admin.patch('/settings', { 'expense.autoApproveLimit': 5000 });
    expect((await d.post('/expenses', { tripId: trip.id, category: 'REPAIR', amount: 15000 })).body.expense.status).toBe('SUBMITTED');
    expect((await mgr.get('/settings')).body.data.length).toBeGreaterThan(5);
    await finish(trip.id, trip.base + 500);
  });

  it('manages route definitions with freight per MT', async () => {
    const a = await as(USERS.accountant ?? USERS.manager);
    const o = await q1<any>("SELECT id FROM locations WHERE code = 'DEP-PSH'"); const dd = await q1<any>("SELECT id FROM locations WHERE code = 'DEP-LHR'");
    const created = await a.post('/routes', { originLocationId: o.id, destinationLocationId: dd.id, freightPerMt: 8200 });
    expect([201, 409]).toContain(created.status);
    const list = await a.get('/routes?q=Peshawar&pageSize=5');
    const row = list.body.data.find((x: any) => x.origin_name.includes('Peshawar') && x.destination_name.includes('Lahore'));
    expect(row).toBeTruthy();
    expect((await a.patch(`/routes/${row.id}`, { freightPerMt: 8500 })).body.route.freight_per_mt).toBe(8500);
    expect((await (await as(USERS.dispatcher)).patch(`/routes/${row.id}`, { freightPerMt: 1 })).status).toBe(403);
  });
});

describe('trip completion feeds finance', () => {
  it('raises the freight invoice and ledger entries when a trip completes', async () => {
    const trip = await runningTrip();
    await finish(trip.id, trip.base + 500);
    const t = await q1<any>('SELECT status, invoice_id FROM trips WHERE id = :id', { id: trip.id });
    expect(t.status).toBe('COMPLETED');
    expect(t.invoice_id).toBeGreaterThan(0);
    const v = await q1<any>("SELECT count(*)::int AS n FROM voucher_lines WHERE trip_id = :id AND credit > 0 AND account_id IN (SELECT id FROM accounts WHERE type = 'INCOME')", { id: trip.id });
    expect(v.n).toBe(1);
  });
});

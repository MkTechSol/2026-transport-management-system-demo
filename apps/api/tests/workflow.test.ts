import { describe, expect, it } from 'vitest';
import { as, USERS } from './helpers';
import { sequelize, q1 } from '../src/db/sequelize';

const future = (days: number, hour = 6) => { const d = new Date(Date.now() + days * 86_400_000); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };

async function bestCandidates(tripId: number) {
  const d = await as(USERS.dispatcher);
  const c = (await d.get(`/trips/${tripId}/candidates`)).body;
  return { vehicle: c.vehicles.find((v: any) => v.eligible), driver: c.drivers.find((x: any) => x.eligible), all: c };
}
const originId = async () => (await q1<any>("SELECT id FROM locations WHERE code = 'PLT-OSK'")).id as number;
const distributorId = async (city: string) => (await q1<any>('SELECT id FROM distributors WHERE city = :c ORDER BY id LIMIT 1', { c: city })).id as number;

describe('vehicle & driver management', () => {
  it('creates, validates, rejects duplicates and edits a vehicle', async () => {
    const f = await as(USERS.fleet);
    const bad = await f.post('/vehicles', { code: 'T', registrationNo: '', fleetType: 'OWNED', capacityMt: -3 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields).toBeTruthy();
    const ok = await f.post('/vehicles', { code: 'GAS-BZ-901', registrationNo: 'DEM-9901', fleetType: 'OWNED', capacityMt: 18, make: 'Hino', homePlantId: await originId() });
    expect(ok.status).toBe(201);
    expect(ok.body.vehicle.status).toBe('AVAILABLE');
    expect((await f.post('/vehicles', { code: 'gas-bz-901', registrationNo: 'DEM-9902', fleetType: 'OWNED', capacityMt: 18 })).status).toBe(409);
    const upd = await f.patch(`/vehicles/${ok.body.vehicle.id}`, { capacityMt: 20, make: 'Isuzu' });
    expect(upd.status).toBe(200);
    expect(Number(upd.body.vehicle.capacity_mt)).toBe(20);
    const detail = await f.get(`/vehicles/${ok.body.vehicle.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.documents).toEqual([]);
  });

  it('creates and edits a driver, blocks duplicate employee ids', async () => {
    const f = await as(USERS.fleet);
    const r = await f.post('/drivers', { employeeId: 'GM-D-9001', fullName: 'Test Driver One', licenseNo: 'DEMO-LIC-9001', experienceYears: 4, phone: '0300-5550000' });
    expect(r.status).toBe(201);
    expect((await f.post('/drivers', { employeeId: 'gm-d-9001', fullName: 'Dup Driver', licenseNo: 'x-1234' })).status).toBe(409);
    expect((await f.patch(`/drivers/${r.body.driver.id}`, { experienceYears: 5 })).body.driver.experience_years).toBe(5);
    expect((await f.patch(`/drivers/${r.body.driver.id}`, { status: 'ON_TRIP' })).status).toBe(409);
  });
});

describe('trip planning, assignment rules and dispatch', () => {
  it('runs a trip through the complete lifecycle and updates the dashboard', async () => {
    const d = await as(USERS.dispatcher);
    const admin = await as(USERS.superAdmin);
    const before = (await admin.get('/dashboard')).body.kpis;

    const created = await d.post('/trips', { originLocationId: await originId(), distributorId: await distributorId('Peshawar'), plannedLoadMt: 9, scheduledDeparture: future(6), priority: 'HIGH', lpgSource: 'LOCAL', submit: true });
    expect(created.status).toBe(201);
    const tripId = created.body.trip.id;
    expect(created.body.trip.status).toBe('PLANNED');
    expect(created.body.trip.code).toMatch(/^TRP-\d{4}-\d{4}$/);

    const { vehicle, driver } = await bestCandidates(tripId);
    expect(vehicle && driver).toBeTruthy();
    const assigned = await d.post(`/trips/${tripId}/assign`, { vehicleId: vehicle.id, driverId: driver.id });
    expect(assigned.status).toBe(200);
    expect(assigned.body.trip.status).toBe('ASSIGNED');

    // invalid transition is refused with a readable message
    const bad = await d.post(`/trips/${tripId}/transition`, { to: 'IN_TRANSIT' });
    expect(bad.status).toBe(409);
    expect(bad.body.error.message).toMatch(/cannot move from Assigned to In Transit/);

    // Dispatch requires the vehicle & driver to be available *now* (departure is days away but status is AVAILABLE)
    const dispatched = await d.post(`/trips/${tripId}/transition`, { to: 'DISPATCHED' });
    expect(dispatched.status).toBe(200);
    expect(dispatched.body.trip.status).toBe('DISPATCHED');
    const vState = await q1<any>('SELECT status FROM vehicles WHERE id = :id', { id: vehicle.id });
    const dState = await q1<any>('SELECT status FROM drivers WHERE id = :id', { id: driver.id });
    expect(vState.status).toBe('ON_TRIP');
    expect(dState.status).toBe('ON_TRIP');
    const mid = (await admin.get('/dashboard')).body.kpis;
    expect(mid.activeVehicles).toBe(before.activeVehicles + 1);
    expect(mid.availableVehicles).toBe(before.availableVehicles - 1);

    // start requires a passed pre-trip safety check
    const noCheck = await d.post(`/trips/${tripId}/transition`, { to: 'IN_TRANSIT' });
    expect(noCheck.status).toBe(422);
    expect(noCheck.body.error.message).toMatch(/pre-trip safety check/i);
    const failed = await d.post(`/trips/${tripId}/safety-checks`, { kind: 'PRE_TRIP', items: [{ key: 'a', label: 'Valves', ok: true }, { key: 'b', label: 'Fire extinguishers', ok: false }] });
    expect(failed.status).toBe(201);
    expect((await d.post(`/trips/${tripId}/transition`, { to: 'IN_TRANSIT' })).status).toBe(422); // FAIL does not count
    await d.post(`/trips/${tripId}/safety-checks`, { kind: 'PRE_TRIP', items: [{ key: 'a', label: 'Valves', ok: true }, { key: 'b', label: 'Fire extinguishers', ok: true }] });

    const started = await d.post(`/trips/${tripId}/transition`, { to: 'IN_TRANSIT', loadedMt: 9 });
    expect(started.status).toBe(200);
    expect(started.body.trip.departed_at).toBeTruthy();
    const arrived = await d.post(`/trips/${tripId}/transition`, { to: 'ARRIVED' });
    expect(arrived.body.trip.status).toBe('ARRIVED');

    const tooMuch = await d.post(`/trips/${tripId}/transition`, { to: 'DELIVERED', deliveredMt: 12, receivedBy: 'Gul Rehman' });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error.message).toMatch(/cannot exceed the loaded quantity/);
    expect((await d.post(`/trips/${tripId}/transition`, { to: 'DELIVERED', deliveredMt: 8.9 })).status).toBe(400); // receivedBy missing
    const delivered = await d.post(`/trips/${tripId}/transition`, { to: 'DELIVERED', deliveredMt: 8.9, receivedBy: 'Gul Rehman', deliveryNoteNo: 'DN-T1' });
    expect(delivered.body.trip.status).toBe('DELIVERED');
    expect(Number(delivered.body.trip.delivered_mt)).toBe(8.9);

    expect((await d.post(`/trips/${tripId}/transition`, { to: 'RETURNING' })).body.trip.status).toBe('RETURNING');
    const done = await d.post(`/trips/${tripId}/transition`, { to: 'COMPLETED' });
    expect(done.body.trip.status).toBe('COMPLETED');
    expect(done.body.trip.completed_at).toBeTruthy();
    expect(done.body.actions).toEqual([]); // terminal

    // resources released
    expect((await q1<any>('SELECT status FROM vehicles WHERE id = :id', { id: vehicle.id })).status).toBe('AVAILABLE');
    expect((await q1<any>('SELECT status FROM drivers WHERE id = :id', { id: driver.id })).status).toBe('AVAILABLE');
    // timeline & audit
    const events = done.body.events.map((e: any) => e.to_status).filter(Boolean);
    expect(events).toEqual(expect.arrayContaining(['DRAFT', 'PLANNED', 'ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'RETURNING', 'COMPLETED']));
    const audit = await admin.get(`/audit-logs?entityType=TRIP&entityId=${tripId}&pageSize=50`);
    expect(audit.body.data.map((a: any) => a.action)).toEqual(expect.arrayContaining(['CREATE', 'ASSIGN', 'DISPATCH', 'COMPLETE']));
    // dashboard reflects completion (cache busted on write)
    const after = (await admin.get('/dashboard')).body.kpis;
    expect(after.completedToday).toBe(before.completedToday + 1);
    expect(after.activeVehicles).toBe(before.activeVehicles);
    expect(after.lpgDeliveredMtdMt).toBeCloseTo(before.lpgDeliveredMtdMt + 8.9, 1);
  });

  it('prevents obviously invalid assignments with clear messages', async () => {
    const d = await as(USERS.dispatcher);
    const mk = async (load: number, days = 8) => (await d.post('/trips', { originLocationId: await originId(), distributorId: await distributorId('Mardan'), plannedLoadMt: load, scheduledDeparture: future(days), submit: true })).body.trip.id as number;
    const driver = (await bestCandidates(await mk(5))).driver;

    // vehicle in maintenance
    const maint = await q1<any>("SELECT id, code FROM vehicles WHERE status = 'MAINTENANCE' LIMIT 1");
    const t1 = await mk(5);
    const r1 = await d.post(`/trips/${t1}/assign`, { vehicleId: maint.id, driverId: driver.id });
    expect(r1.status).toBe(422);
    expect(r1.body.error.message).toBe(`Vehicle ${maint.code} is currently in maintenance.`);

    // capacity
    const small = await q1<any>("SELECT id, code, capacity_mt FROM vehicles WHERE status = 'AVAILABLE' AND capacity_mt <= 10 AND archived_at IS NULL LIMIT 1");
    const t2 = await mk(19);
    const r2 = await d.post(`/trips/${t2}/assign`, { vehicleId: small.id, driverId: driver.id });
    expect(r2.status).toBe(422);
    expect(r2.body.error.details.violations.map((v: any) => v.code)).toContain('CAPACITY');

    // missing documents on a brand-new vehicle
    const f = await as(USERS.fleet);
    const nv = (await f.post('/vehicles', { code: 'GAS-BZ-902', registrationNo: 'DEM-9902', fleetType: 'OWNED', capacityMt: 20 })).body.vehicle;
    const t3 = await mk(5);
    const r3 = await d.post(`/trips/${t3}/assign`, { vehicleId: nv.id, driverId: driver.id });
    expect(r3.status).toBe(422);
    expect(r3.body.error.message).toMatch(/has no Insurance on record|has no Registration on record/);

    // expired driver document (medical is not required; LPG handling cert is) -> create an expired one on a new driver
    const nd = (await f.post('/drivers', { employeeId: 'GM-D-9002', fullName: 'Expired Docs Driver', licenseNo: 'DEMO-LIC-9002' })).body.driver;
    await f.post('/documents', { driverId: nd.id, docType: 'LICENSE', expiresOn: '2020-01-01' });
    await f.post('/documents', { driverId: nd.id, docType: 'LPG_HANDLING_CERT', expiresOn: new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10) });
    const vOk = (await bestCandidates(t3)).vehicle;
    const r4 = await d.post(`/trips/${t3}/assign`, { vehicleId: vOk.id, driverId: nd.id });
    expect(r4.status).toBe(422);
    expect(r4.body.error.message).toMatch(/Driving License expired on/);

    // double booking: assign the same vehicle to two overlapping trips
    const tA = await mk(5, 9); const tB = await mk(5, 9);
    const cand = await bestCandidates(tA);
    expect((await d.post(`/trips/${tA}/assign`, { vehicleId: cand.vehicle.id, driverId: cand.driver.id })).status).toBe(200);
    const clash = await d.post(`/trips/${tB}/assign`, { vehicleId: cand.vehicle.id, driverId: (await bestCandidates(tB)).driver.id });
    expect(clash.status).toBe(422);
    expect(clash.body.error.message).toMatch(new RegExp(`Vehicle ${cand.vehicle.code} is already assigned to Trip TRP-`));
    const clashDriver = await d.post(`/trips/${tB}/assign`, { vehicleId: (await bestCandidates(tB)).vehicle.id, driverId: cand.driver.id });
    expect(clashDriver.status).toBe(422);
    expect(clashDriver.body.error.message).toMatch(/is already assigned to Trip/);
  });

  it('cannot dispatch a vehicle that is already on an active trip and rejects concurrent double-dispatch', async () => {
    const d = await as(USERS.dispatcher);
    const mk = async (days: number) => (await d.post('/trips', { originLocationId: await originId(), distributorId: await distributorId('Nowshera'), plannedLoadMt: 5, scheduledDeparture: future(days), submit: true })).body.trip.id as number;
    const a = await mk(12); const b = await mk(20);
    const ca = await bestCandidates(a);
    await d.post(`/trips/${a}/assign`, { vehicleId: ca.vehicle.id, driverId: ca.driver.id });
    await d.post(`/trips/${b}/assign`, { vehicleId: ca.vehicle.id, driverId: ca.driver.id }); // different window -> allowed
    const [r1, r2] = await Promise.all([d.post(`/trips/${a}/transition`, { to: 'DISPATCHED' }), d.post(`/trips/${b}/transition`, { to: 'DISPATCHED' })]);
    const codes = [r1.status, r2.status].sort();
    expect(codes[0]).toBe(200);
    expect(codes[1]).toBeGreaterThanOrEqual(409); // one wins, the other gets a clear conflict, never two dispatched
    const active = await q1<any>("SELECT count(*)::int AS n FROM trips WHERE vehicle_id = :v AND status = 'DISPATCHED'", { v: ca.vehicle.id });
    expect(active.n).toBe(1);
  });

  it('supports hold/resume and cancel with mandatory reasons', async () => {
    const d = await as(USERS.dispatcher);
    const id = (await d.post('/trips', { originLocationId: await originId(), distributorId: await distributorId('Swabi'), plannedLoadMt: 5, scheduledDeparture: future(15), submit: true })).body.trip.id;
    expect((await d.post(`/trips/${id}/transition`, { to: 'ON_HOLD' })).status).toBe(400);
    const hold = await d.post(`/trips/${id}/transition`, { to: 'ON_HOLD', reason: 'Plant loading bay closed' });
    expect(hold.body.trip.status).toBe('ON_HOLD');
    const resume = await d.post(`/trips/${id}/transition`, { to: 'PLANNED' });
    expect(resume.body.trip.status).toBe('PLANNED');
    expect((await d.post(`/trips/${id}/transition`, { to: 'CANCELLED' })).status).toBe(400);
    const cancel = await d.post(`/trips/${id}/transition`, { to: 'CANCELLED', reason: 'Customer postponed' });
    expect(cancel.body.trip.status).toBe('CANCELLED');
    expect((await d.post(`/trips/${id}/transition`, { to: 'PLANNED' })).status).toBe(409);
    expect((await d.patch(`/trips/${id}`, { notes: 'x' })).status).toBe(409);
  });

  it('is idempotent for offline mobile clients (clientEventId)', async () => {
    const dr = await as(USERS.driver);
    const me = (await dr.get('/auth/me')).body.user;
    const trip = (await dr.get('/trips?status=DISPATCHED')).body.data[0];
    expect(trip).toBeTruthy();
    expect(trip.driver_id).toBe(me.driverId);
    await dr.post(`/trips/${trip.id}/safety-checks`, { items: [{ key: 'a', label: 'Valves', ok: true }] });
    const body = { to: 'IN_TRANSIT', clientEventId: 'mobile-evt-0001' };
    const r1 = await dr.post(`/trips/${trip.id}/transition`, body);
    expect(r1.status).toBe(200);
    const r2 = await dr.post(`/trips/${trip.id}/transition`, body);
    expect(r2.status).toBe(200); // replay is a no-op, not an error
    const n = await q1<any>("SELECT count(*)::int AS n FROM trip_events WHERE trip_id = :id AND to_status = 'IN_TRANSIT'", { id: trip.id });
    expect(n.n).toBe(1);
    // drivers cannot cancel or dispatch
    expect((await dr.post(`/trips/${trip.id}/transition`, { to: 'CANCELLED', reason: 'no' })).status).toBe(403);
    // GPS batch ingestion + duplicate suppression
    const pos = { tripId: trip.id, lat: 34.0, lng: 71.9, speedKmh: 50, recordedAt: new Date().toISOString() };
    const p1 = await dr.post('/tracking/positions', { positions: [pos] });
    expect(p1.body.accepted).toBe(1);
    expect((await dr.post('/tracking/positions', { positions: [pos] })).body.accepted).toBe(0);
  });
});

describe('dashboard & reports are computed from live data', () => {
  it('fleet KPIs match the database', async () => {
    const admin = await as(USERS.superAdmin);
    const k = (await admin.get('/dashboard')).body.kpis;
    const row = await q1<any>("SELECT count(*)::int AS total, count(*) FILTER (WHERE status='ON_TRIP')::int AS on_trip, count(*) FILTER (WHERE status='AVAILABLE')::int AS available, count(*) FILTER (WHERE fleet_type='HIRED')::int AS hired FROM vehicles WHERE archived_at IS NULL");
    expect(k.totalFleet).toBe(row.total);
    expect(k.activeVehicles).toBe(row.on_trip);
    expect(k.availableVehicles).toBe(row.available);
    expect(k.hiredFleet).toBe(row.hired);
    const tr = await q1<any>("SELECT count(*) FILTER (WHERE status='DELAYED')::int AS delayed, count(*) FILTER (WHERE status IN ('PLANNED','ASSIGNED'))::int AS scheduled FROM trips");
    expect(k.delayedTrips).toBe(tr.delayed);
    expect(k.scheduledTrips).toBe(tr.scheduled);
  });

  it('document expiry buckets (expiring soon / expired) are correct', async () => {
    const admin = await as(USERS.superAdmin);
    const list = await admin.get('/documents?pageSize=100&status=EXPIRED,EXPIRING_SOON');
    expect(list.status).toBe(200);
    for (const d of list.body.data) {
      expect(['EXPIRED', 'EXPIRING_SOON']).toContain(d.status);
      if (d.status === 'EXPIRED') expect(d.days_left).toBeLessThan(0);
      else { expect(d.days_left).toBeGreaterThanOrEqual(0); expect(d.days_left).toBeLessThanOrEqual(30); }
    }
    expect(list.body.summary.expired).toBeGreaterThan(0);
    expect(list.body.summary.expiring).toBeGreaterThan(0);
  });

  it('reports query the database, filter, and export CSV only for permitted roles', async () => {
    const m = await as(USERS.viewer);
    const r = await m.get('/reports/fleet-utilization');
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThan(5);
    const filtered = await m.get('/reports/trips?status=COMPLETED&pageSize=100');
    expect(filtered.body.data.every((t: any) => t.status === 'COMPLETED')).toBe(true);
    const csv = await m.get('/reports/completed-trips?format=csv');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\n').length).toBeGreaterThan(5);
    expect((await (await as(USERS.dispatcher)).get('/reports/trips?format=csv')).status).toBe(403);
    expect((await m.get('/reports/not-a-report')).status).toBe(400);
  });

  it('lists support search, filtering, sorting and pagination', async () => {
    const a = await as(USERS.superAdmin);
    const p1 = await a.get('/trips?pageSize=10&page=1&sort=departure&dir=asc');
    const p2 = await a.get('/trips?pageSize=10&page=2&sort=departure&dir=asc');
    expect(p1.body.meta.total).toBeGreaterThan(100);
    expect(p1.body.data).toHaveLength(10);
    expect(p1.body.data[0].id).not.toBe(p2.body.data[0].id);
    expect(new Date(p1.body.data[0].scheduled_departure) <= new Date(p1.body.data[9].scheduled_departure)).toBe(true);
    const s = await a.get('/trips?q=Gilgit');
    expect(s.body.data.length).toBeGreaterThan(0);
    expect(s.body.data.every((t: any) => JSON.stringify(t).includes('Gilgit'))).toBe(true);
    const v = await a.get('/vehicles?fleetType=HIRED');
    expect(v.body.meta.total).toBe(6);
    expect((await a.get('/vehicles?pageSize=1000')).status).toBe(400);
  });
});

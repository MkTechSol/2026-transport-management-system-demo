import bcrypt from 'bcryptjs';
import { sequelize, q, q1 } from '../db/sequelize';
import { DEMO_PASSWORD } from './data';
import { makeRng } from './rng';

const MIN = 60_000; const DAY = 86_400_000;

async function bulk(table: string, rows: Record<string, any>[]) {
  const qi = sequelize.getQueryInterface();
  for (let i = 0; i < rows.length; i += 1000) await qi.bulkInsert(table, rows.slice(i, i + 1000));
}

/** Performance / scale fixture: thousands of users & drivers and tens of thousands of historical trips. NOT part of the client demo. */
export async function seedLoad(o: { users: number; drivers: number; vehicles: number; trips: number }) {
  const rng = makeRng(777);
  const now = Date.now();
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const max = async (t: string) => (await q1<any>(`SELECT COALESCE(max(id),0)::int AS m FROM ${t}`)).m as number;
  const [d0, v0, u0, t0, e0, doc0] = await Promise.all([max('drivers'), max('vehicles'), max('users'), max('trips'), max('trip_events'), max('documents')]);
  const routes = await q<any>('SELECT id, origin_location_id, destination_location_id, est_duration_min FROM routes');
  const dists = await q<any>('SELECT id, location_id FROM distributors');

  const drivers = Array.from({ length: o.drivers }, (_, i) => ({ id: d0 + i + 1, employee_id: `LD-${String(i + 1).padStart(6, '0')}`, full_name: `Load Driver ${i + 1}`, phone: `0301-000${String(i).padStart(4, '0')}`, national_id_demo: `DEMO-LOAD-${i}`, license_no: `DEMO-LIC-L-${i}`, license_class: 'HTV', status: 'AVAILABLE', experience_years: rng.int(1, 20), home_plant_id: 1 + (i % 2), safety_score: rng.int(75, 99), joined_on: '2020-01-01', archived_at: null }));
  const vehicles = Array.from({ length: o.vehicles }, (_, i) => ({ id: v0 + i + 1, code: `LD-BZ-${String(i + 1).padStart(4, '0')}`, registration_no: `LDM-${10000 + i}`, fleet_type: i % 4 === 0 ? 'HIRED' : 'OWNED', category: 'BOWZER', capacity_mt: [10, 12, 15, 18, 20][i % 5], make: 'Hino', model: '700', year: 2020, status: 'AVAILABLE', home_plant_id: 1 + (i % 2), default_driver_id: null, vendor_name: null, odometer_km: rng.int(1000, 300000), last_lat: 33.5, last_lng: 72.5, last_speed_kmh: 0, last_position_at: new Date(now), last_location_id: 1 + (i % 2), archived_at: null }));
  const users = Array.from({ length: o.users }, (_, i) => {
    const role = i % 25 === 0 ? 'FLEET_MANAGER' : i % 11 === 0 ? 'DISPATCHER' : i % 13 === 0 ? 'MANAGEMENT_VIEWER' : 'DRIVER';
    return { id: u0 + i + 1, email: `load.user${i + 1}@gasman-demo.local`, password_hash: hash, full_name: `Load User ${i + 1}`, role, phone: null, driver_id: role === 'DRIVER' ? d0 + 1 + (i % o.drivers) : null, status: 'ACTIVE', failed_logins: 0, locked_until: null, last_login_at: null };
  });
  await bulk('drivers', drivers); await bulk('vehicles', vehicles); await bulk('users', users);
  const docs: any[] = []; let did = doc0;
  const exp = (d: number) => new Date(now + d * DAY).toISOString().slice(0, 10);
  vehicles.forEach((v) => ['REGISTRATION', 'INSURANCE', 'FITNESS', 'TANK_PRESSURE_TEST'].forEach((t) => docs.push({ id: ++did, vehicle_id: v.id, driver_id: null, doc_type: t, doc_number: `X-${v.id}`, issued_on: exp(-100), expires_on: exp(rng.int(-20, 400)), issuer: 'Load' })));
  drivers.forEach((d) => ['LICENSE', 'LPG_HANDLING_CERT'].forEach((t) => docs.push({ id: ++did, vehicle_id: null, driver_id: d.id, doc_type: t, doc_number: `X-${d.id}`, issued_on: exp(-100), expires_on: exp(rng.int(-20, 400)), issuer: 'Load' })));
  await bulk('documents', docs);

  const trips: any[] = []; const events: any[] = []; let eid = e0; const allV = [...vehicles]; const allD = [...drivers];
  for (let i = 0; i < o.trips; i++) {
    const r = rng.pick(routes); const dist = dists.find((d) => d.location_id === r.destination_location_id);
    const dep = new Date(now - rng.int(2, 365) * DAY + rng.int(0, 600) * MIN);
    const arr = new Date(dep.getTime() + r.est_duration_min * MIN); const done = new Date(arr.getTime() + (r.est_duration_min + 60) * MIN);
    const v = rng.pick(allV); const d = rng.pick(allD); const load = Math.min(v.capacity_mt, 10);
    const id = t0 + i + 1; const delay = rng.chance(0.15) ? rng.int(20, 120) : rng.int(0, 10);
    trips.push({ id, code: `LT-${dep.getUTCFullYear()}-${String(id).padStart(6, '0')}`, status: 'COMPLETED', status_before_hold: null, priority: 'NORMAL', origin_location_id: r.origin_location_id, destination_location_id: r.destination_location_id, distributor_id: dist?.id ?? null, route_id: r.id, vehicle_id: v.id, driver_id: d.id, lpg_source: 'LOCAL', planned_load_mt: load, loaded_mt: load, delivered_mt: load, scheduled_departure: dep, planned_arrival: arr, dispatched_at: dep, departed_at: dep, arrived_at: new Date(arr.getTime() + delay * MIN), delivered_at: arr, return_started_at: arr, completed_at: done, cancelled_at: null, delay_minutes: delay, hold_reason: null, cancel_reason: null, delivery_note_no: null, received_by: 'Load', pod_notes: null, notes: null, progress_pct: 100, cur_lat: 33.5, cur_lng: 72.5, cur_speed_kmh: 0, eta_at: arr, last_position_at: done, created_by: 3, created_at: dep, updated_at: done });
    for (const [t, ts, m] of [['DRAFT', new Date(dep.getTime() - DAY), 'Trip created'], ['IN_TRANSIT', dep, 'Departed'], ['COMPLETED', done, 'Completed']] as const)
      events.push({ id: ++eid, trip_id: id, type: 'STATUS_CHANGE', from_status: null, to_status: t, message: m, actor_user_id: 3, lat: null, lng: null, client_event_id: null, occurred_at: ts });
  }
  await bulk('trips', trips); await bulk('trip_events', events);
  await sequelize.query(`
    SELECT setval(pg_get_serial_sequence('drivers','id'), (SELECT max(id) FROM drivers));
    SELECT setval(pg_get_serial_sequence('vehicles','id'), (SELECT max(id) FROM vehicles));
    SELECT setval(pg_get_serial_sequence('users','id'), (SELECT max(id) FROM users));
    SELECT setval(pg_get_serial_sequence('documents','id'), (SELECT max(id) FROM documents));
    SELECT setval(pg_get_serial_sequence('trips','id'), (SELECT max(id) FROM trips));
    SELECT setval(pg_get_serial_sequence('trip_events','id'), (SELECT max(id) FROM trip_events));`);
  await sequelize.query('ANALYZE');
  return { users: users.length, drivers: drivers.length, vehicles: vehicles.length, trips: trips.length };
}

/** Finance & inventory scale fixture: balanced vouchers with bowzer / party dimensions and stock movements. */
export async function seedLoadFinance(o: { vouchers: number; invoices: number }) {
  const rng = makeRng(4242);
  const accs = await q<any>(`SELECT id, system_key FROM accounts WHERE system_key IN ('cash','receivable','freight_delivery','exp_FUEL','exp_TOLL','exp_maintenance','payable','exp_parts')`);
  const key = (k: string) => accs.find((a: any) => a.system_key === k).id as number;
  const veh = (await q<any>('SELECT id FROM vehicles ORDER BY id')).map((v: any) => v.id as number);
  const custs = (await q<any>('SELECT id FROM distributors ORDER BY id')).map((v: any) => v.id as number);
  const fy = (await q1<any>(`SELECT id, starts_on::text AS s FROM fiscal_years WHERE status = 'OPEN' ORDER BY starts_on DESC LIMIT 1`))!;
  const v0 = (await q1<any>('SELECT COALESCE(max(id), 0)::int AS m FROM vouchers'))!.m as number;
  const l0 = (await q1<any>('SELECT COALESCE(max(id), 0)::bigint AS m FROM voucher_lines'))!.m as number;
  const start = new Date(fy.s).getTime(); const span = Math.max(DAY, Date.now() - start);
  const vouchers: any[] = []; const lines: any[] = []; let lid = l0;
  for (let i = 0; i < o.vouchers; i++) {
    const id = v0 + i + 1; const date = new Date(start + rng.int(0, Math.floor(span / DAY)) * DAY).toISOString().slice(0, 10);
    const vh = rng.pick(veh); const amt = rng.int(1, 400) * 500; const kind = i % 5;
    const [type, dr, cr, party]: [string, number, number, number | null] = kind === 0 ? ['SALE_INVOICE', key('receivable'), key('freight_delivery'), rng.pick(custs)] : kind === 1 ? ['CASH_RECEIPT', key('cash'), key('receivable'), rng.pick(custs)] : kind === 2 ? ['TRIP_EXPENSE', key('exp_FUEL'), key('cash'), null] : kind === 3 ? ['TRIP_EXPENSE', key('exp_TOLL'), key('cash'), null] : ['BOWZER_EXPENSE', key('exp_maintenance'), key('payable'), null];
    vouchers.push({ id, voucher_no: `LD-${String(id).padStart(8, '0')}`, type, voucher_date: date, fiscal_year_id: fy.id, narration: 'Load test voucher', total: amt, vehicle_id: vh, party_type: party ? 'CUSTOMER' : null, party_id: party, trip_id: null, source_type: null, source_id: null, status: 'POSTED', void_reason: null, created_by: 1, created_at: new Date() });
    lines.push({ id: ++lid, voucher_id: id, line_no: 1, account_id: dr, debit: amt, credit: 0, vehicle_id: vh, party_type: kind === 0 ? 'CUSTOMER' : null, party_id: kind === 0 ? party : null, trip_id: null, memo: null });
    lines.push({ id: ++lid, voucher_id: id, line_no: 2, account_id: cr, debit: 0, credit: amt, vehicle_id: vh, party_type: kind === 1 ? 'CUSTOMER' : null, party_id: kind === 1 ? party : null, trip_id: null, memo: null });
  }
  await sequelize.query('ALTER TABLE voucher_lines DISABLE TRIGGER trg_voucher_balance'); // bulk load: skip the deferred balance trigger (rows are balanced by construction)
  await bulk('vouchers', vouchers); await bulk('voucher_lines', lines);
  await sequelize.query('ALTER TABLE voucher_lines ENABLE TRIGGER trg_voucher_balance');
  await sequelize.query(`SELECT setval(pg_get_serial_sequence('vouchers','id'), (SELECT max(id) FROM vouchers)), setval(pg_get_serial_sequence('voucher_lines','id'), (SELECT max(id) FROM voucher_lines))`);
  await sequelize.query(`TRUNCATE account_balances, party_balances;
    INSERT INTO account_balances (account_id, debit, credit) SELECT l.account_id, sum(l.debit), sum(l.credit) FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED' GROUP BY 1;
    INSERT INTO party_balances (party_type, party_id, account_id, debit, credit) SELECT l.party_type, l.party_id, l.account_id, sum(l.debit), sum(l.credit) FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED' WHERE l.party_id IS NOT NULL GROUP BY 1, 2, 3;`);
  await sequelize.query('ANALYZE');
  return { vouchers: vouchers.length, lines: lines.length };
}

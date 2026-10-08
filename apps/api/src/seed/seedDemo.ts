import bcrypt from 'bcryptjs';
import { config } from '../config';
import { sequelize, q } from '../db/sequelize';
import { LatLng, buildSyntheticRoute, haversineKm, pointAt } from '../lib/geo';
import { logger } from '../logger';
import { generateComplianceAlerts } from '../services/alerts';
import {
  DEMO_PASSWORD, DISTRIBUTORS, HIRED_VENDORS, LOCATIONS, MAINT_JOBS, MAINT_VENDORS, PRETRIP_ITEMS, VEHICLE_MAKES, driverNames,
} from './data';
import { makeRng } from './rng';
import { economicsPass } from './economics';
import { demoFreightPerMt } from '../lib/geo';
import { PARTNER_OWNERS } from './data';
import { seedSettings } from '../services/settings';
import { seedFinance } from './financeSeed';
import { seedStops } from './multiDrop';
import { seedInventory } from './inventorySeed';
import { seedHr } from './hrSeed';

const MIN = 60_000;
const DAY = 86_400_000;

async function bulk(table: string, rows: Record<string, any>[]) {
  if (!rows.length) return;
  const qi = sequelize.getQueryInterface();
  for (let i = 0; i < rows.length; i += 400) await qi.bulkInsert(table, rows.slice(i, i + 400));
}
const J = (v: unknown) => JSON.stringify(v);

export interface SeedSummary { users: number; vehicles: number; drivers: number; distributors: number; trips: number; events: number; documents: number }

export async function truncateAll() {
  await sequelize.query(`TRUNCATE notification_reads, notifications, audit_logs, trip_positions, trip_events, safety_checks, incidents, maintenance_records, documents,
    trip_expenses, fuel_entries, approvals, approval_rules, settings,
    voucher_allocations, voucher_lines, vouchers, voucher_counters, account_balances, party_balances, sales_invoice_lines, sales_invoices, sales_order_lines, sales_orders, banks, vendors,
    stock_movements, stock_balances, stock_doc_lines, stock_docs, tyre_events, tyres, purchase_order_lines, purchase_orders, rfq_quote_lines, rfq_quotes, purchase_request_lines, purchase_requests, items, item_subcategories, item_categories, brands, warehouses, payroll_lines, payroll_runs, leave_requests, attendance, employees, departments, exception_acks,
    trip_stops, trips, refresh_tokens, users, custom_roles, vehicles, drivers, routes, distributors, locations RESTART IDENTITY CASCADE`);
  await sequelize.query(`DELETE FROM accounts WHERE system_key IS NULL AND code LIKE '1120-%'; ALTER SEQUENCE invoice_no_seq RESTART; ALTER SEQUENCE sales_order_no_seq RESTART; ALTER SEQUENCE stock_doc_seq RESTART; ALTER SEQUENCE pr_no_seq RESTART; ALTER SEQUENCE po_no_seq RESTART;`);
}

export async function seedDemo(opts: { anchor?: Date; log?: boolean } = {}): Promise<SeedSummary> {
  const log = opts.log ?? true;
  const anchor = opts.anchor ?? (config.SEED_ANCHOR_DATE ? new Date(config.SEED_ANCHOR_DATE) : new Date());
  anchor.setSeconds(0, 0);
  const NOW = anchor.getTime();
  const at = (minOffset: number) => new Date(NOW + minOffset * MIN);
  /** day offset + PKT hour -> Date (PKT = UTC+5) */
  const dayAt = (dayOffset: number, hourPkt: number, min = 0) => {
    const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
    return new Date(d.getTime() + dayOffset * DAY + (hourPkt - 5) * 3600_000 + min * MIN);
  };
  const dateStr = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString().slice(0, 10);
  const rng = makeRng(20261008);

  await truncateAll();
  if (log) logger.info('seeding demo data…');

  // ---------------------------------------------------------------- locations & distributors
  const locations: any[] = LOCATIONS.map((l, i) => ({ id: i + 1, code: l.code, name: l.name, type: l.type, city: l.city, region: l.region, address: l.address, lat: l.lat, lng: l.lng, storage_capacity_mt: l.cap || null, contact_phone: `051-555-01${10 + i}`, status: 'ACTIVE' }));
  const plants = locations.filter((l) => l.type === 'PLANT');
  const osk = locations[0]; const dhn = locations[1]; const pqi = locations[2];
  const nashpa = locations[5]; const makori = locations[6]; const sher = locations[7]; const kotal = locations[8];
  const CUST_NTN = (i: number) => `DEMO-NTN-${String(7000000 + i * 137).slice(-7)}-${i % 9}`;
  const distributors: any[] = [];
  DISTRIBUTORS.forEach((d, i) => {
    const locId = locations.length + 1;
    const code = `DEMO-${d.region === 'GILGIT_BALTISTAN' ? 'GB' : d.region === 'ISLAMABAD' ? 'ISB' : d.region}-${String(i + 1).padStart(3, '0')}`;
    locations.push({ id: locId, code: `LOC-${code}`, name: d.name, type: 'DISTRIBUTOR', city: d.city, region: d.region, address: `${d.city} (synthetic demo address)`, lat: d.at[0], lng: d.at[1], storage_capacity_mt: null as any, contact_phone: `0300-555${String(1000 + i * 37).slice(-4)}`, status: 'ACTIVE' });
    distributors.push({
      id: i + 1, code, name: d.name, city: d.city, region: d.region, address: `Main Road, ${d.city} (synthetic demo address)`, contact_name: d.contact,
      phone: `0300-555${String(1000 + i * 37).slice(-4)}`, location_id: locId,
      status: i === 11 ? 'ON_HOLD' : 'ACTIVE', credit_status: i === 11 ? 'BLOCKED' : i % 9 === 4 ? 'WATCH' : 'GOOD',
      customer_type: 'DISTRIBUTOR', credit_limit_pkr: [1_500_000, 2_500_000, 4_000_000, 6_000_000][i % 4], credit_alert_pct: 80, whatsapp: `0300-555${String(3000 + i * 41).slice(-4)}`, email: `accounts${i + 1}@demo-distributor.example`, ntn: CUST_NTN(i),
    });
  });
  // Marketers are billed for plant-to-plant uplifting freight (they never appear as delivery destinations).
  const marketers: any[] = [];
  ['Demo LPG Marketing Co. (Marketer)', 'Demo Energy Marketing Ltd. (Marketer)'].forEach((name, i) => {
    const locId = locations.length + 1;
    locations.push({ id: locId, code: `LOC-DEMO-MKT-${i + 1}`, name, type: 'DISTRIBUTOR', city: 'Islamabad', region: 'ISLAMABAD', address: 'Blue Area, Islamabad (synthetic)', lat: 33.71 + i * 0.01, lng: 73.06, storage_capacity_mt: null as any, contact_phone: `051-555-02${i}0`, status: 'ACTIVE' });
    marketers.push({ id: DISTRIBUTORS.length + i + 1, code: `DEMO-MKT-${String(i + 1).padStart(3, '0')}`, name, city: 'Islamabad', region: 'ISLAMABAD', address: 'Blue Area, Islamabad (synthetic)', contact_name: i ? 'Operations Desk' : 'Commercial Desk', phone: `051-555-02${i}0`, location_id: locId,
      status: 'ACTIVE', credit_status: 'GOOD', customer_type: 'MARKETER', credit_limit_pkr: 25_000_000, credit_alert_pct: 85, whatsapp: null, email: `billing${i + 1}@demo-marketer.example`, ntn: CUST_NTN(90 + i) });
  });
  await bulk('locations', locations);
  await bulk('distributors', [...distributors, ...marketers]);

  // ---------------------------------------------------------------- routes (lazy, synthetic)
  const routes = new Map<string, any>();
  const routeFor = (originId: number, destId: number) => {
    const key = `${originId}:${destId}`;
    let r = routes.get(key);
    if (!r) {
      const o = locations.find((l) => l.id === originId)!; const d = locations.find((l) => l.id === destId)!;
      const built = buildSyntheticRoute([o.lat, o.lng], [d.lat, d.lng], originId * 31 + destId);
      r = { id: routes.size + 1, code: `RT-${o.code}-${d.code}`.slice(0, 40), origin_location_id: originId, destination_location_id: destId, distance_km: built.distanceKm, est_duration_min: built.estDurationMin, path: built.path, checkpoints: built.checkpoints, freight_per_mt: demoFreightPerMt(built.distanceKm, ((originId * 7 + destId * 3) % 9 - 4) / 100), name: `${o.name} – ${d.name}`.slice(0, 150), active: true };
      routes.set(key, r);
    }
    return r;
  };

  // ---------------------------------------------------------------- drivers
  const NAMES = driverNames(36);
  const drivers = NAMES.map((name, i) => {
    const status = i === 32 ? 'SUSPENDED' : i === 30 || i === 31 ? 'ON_LEAVE' : i >= 33 ? 'OFF_DUTY' : 'AVAILABLE';
    return {
      id: i + 1, employee_id: `GM-D-${String(i + 1).padStart(4, '0')}`, full_name: name, phone: `0300-555${String(2000 + i * 53).slice(-4)}`,
      national_id_demo: `DEMO-${35201 + (i % 7)}-${String(1000000 + i * 7919).slice(-7)}-${(i % 9) + 1}`,
      license_no: `DEMO-LIC-HTV-${String(i + 1).padStart(4, '0')}`, license_class: i % 5 === 0 ? 'HTV+HAZ' : 'HTV', status,
      experience_years: i < 8 ? rng.int(12, 22) : rng.int(2, 14), home_plant_id: i % 2 === 0 ? osk.id : dhn.id,
      safety_score: i === 32 ? 61 : rng.int(82, 99), joined_on: dateStr(-rng.int(300, 3900)), archived_at: null as any,
      created_at: at(-60 * 24 * 200), updated_at: at(-60 * 24 * 2),
    };
  });

  // ---------------------------------------------------------------- vehicles
  const vehicles: any[] = Array.from({ length: 26 }, (_, i) => {
    const n = i + 1; const hired = n > 20; const mk = VEHICLE_MAKES[i % VEHICLE_MAKES.length];
    return {
      id: n, code: `GAS-BZ-${String(n).padStart(3, '0')}`, registration_no: `DEM-${1000 + n * 7}`, fleet_type: hired ? 'HIRED' : 'OWNED', category: 'BOWZER',
      capacity_mt: [10, 12, 15, 18, 20, 22][i % 6], make: mk.make, model: mk.model, year: hired ? rng.int(2015, 2020) : rng.int(2017, 2024),
      status: 'AVAILABLE', home_plant_id: i % 2 === 0 ? osk.id : dhn.id, default_driver_id: n <= 26 ? n : null, vendor_name: hired ? HIRED_VENDORS[(n - 21) % 3] : null,
      bowzer_no: `B-${100 + n * 3}`, chassis_no: `DEMO-CH-${String(900000 + n * 311)}`, engine_no: `DEMO-EN-${String(15000 + n * 17)}`, wheels: [10, 12, 14][i % 3], owner_name: hired ? HIRED_VENDORS[(n - 21) % 3] : n % 7 === 0 ? PARTNER_OWNERS[0] : n % 7 === 3 ? PARTNER_OWNERS[1] : n % 7 === 5 ? PARTNER_OWNERS[2] : 'GasMan (Company)', fuel_norm_kmpl: [2.5, 2.6, 2.7, 2.8, 2.4, 2.9][i % 6],
      odometer_km: rng.int(60_000, 460_000), last_lat: null as any, last_lng: null as any, last_speed_kmh: 0, last_position_at: null as any, last_location_id: null as any,
      archived_at: null as any, created_at: at(-60 * 24 * 250), updated_at: at(-60 * 24),
    };
  });
  // Drivers 0..25 are each vehicle's regular driver, except special-status ones which stay in the pool.
  const regularDriverIdx = (vi: number) => (vi + 0) % 26;
  vehicles.forEach((v, i) => { v.default_driver_id = regularDriverIdx(i) + 1; });
  const byCode = (c: number) => vehicles[c - 1];
  const RESERVED = new Set([5, 9, 14, 17, 22, 26]);
  byCode(5).status = 'MAINTENANCE'; byCode(17).status = 'MAINTENANCE'; byCode(26).status = 'INACTIVE';
  const SPECIAL_DRIVERS = new Set([6, 11, 30, 31, 32, 33, 34, 35]);
  vehicles.forEach((v) => { if (SPECIAL_DRIVERS.has(v.default_driver_id - 1)) v.default_driver_id = null as any; });

  // ---------------------------------------------------------------- documents
  const documents: any[] = [];
  let docId = 1;
  const addDoc = (o: { vehicle_id?: number; driver_id?: number; doc_type: string; days: number; number?: string; issuer: string; validDays?: number }) => {
    const exp = dateStr(o.days); const iss = dateStr(o.days - (o.validDays ?? 365));
    documents.push({ id: docId++, vehicle_id: o.vehicle_id ?? null, driver_id: o.driver_id ?? null, doc_type: o.doc_type, doc_number: o.number ?? null, issued_on: iss, expires_on: exp, issuer: o.issuer, notes: null, created_at: at(-60 * 24 * 100), updated_at: at(-60 * 24 * 100) });
  };
  const VOV: Record<string, number> = { '9:INSURANCE': 12, '14:FITNESS': 5, '17:ROUTE_PERMIT': -10, '22:TANK_PRESSURE_TEST': 21, '26:INSURANCE': -34, '5:TANK_PRESSURE_TEST': 44 };
  vehicles.forEach((v) => {
    const ov = (t: string, d: number) => VOV[`${v.id}:${t}`] ?? d;
    addDoc({ vehicle_id: v.id, doc_type: 'REGISTRATION', days: rng.int(200, 1400), number: `REG-${v.registration_no}`, issuer: 'Excise & Taxation (demo)', validDays: 1825 });
    addDoc({ vehicle_id: v.id, doc_type: 'INSURANCE', days: ov('INSURANCE', rng.int(70, 330)), number: `POL-DEMO-${String(v.id).padStart(4, '0')}`, issuer: 'Demo Insurance Co.' });
    addDoc({ vehicle_id: v.id, doc_type: 'FITNESS', days: ov('FITNESS', rng.int(60, 340)), number: `FIT-${v.id}-26`, issuer: 'Vehicle Inspection Centre (demo)' });
    addDoc({ vehicle_id: v.id, doc_type: 'ROUTE_PERMIT', days: ov('ROUTE_PERMIT', rng.int(90, 700)), number: `PRM-${v.id}`, issuer: 'Provincial Transport Authority (demo)', validDays: 730 });
    addDoc({ vehicle_id: v.id, doc_type: 'TANK_PRESSURE_TEST', days: ov('TANK_PRESSURE_TEST', rng.int(120, 1000)), number: `HYD-${v.id}`, issuer: 'Certified Pressure Test Lab (demo)', validDays: 1095 });
  });
  const DOV: Record<string, number> = { '6:LICENSE': 18, '11:LPG_HANDLING_CERT': 9, '30:MEDICAL': -22 };
  drivers.forEach((d, i) => {
    const ov = (t: string, def: number) => DOV[`${i}:${t}`] ?? def;
    addDoc({ driver_id: d.id, doc_type: 'LICENSE', days: ov('LICENSE', rng.int(120, 1500)), number: d.license_no, issuer: 'Licensing Authority (demo)', validDays: 1825 });
    addDoc({ driver_id: d.id, doc_type: 'MEDICAL', days: ov('MEDICAL', rng.int(60, 330)), number: `MED-${i + 1}`, issuer: 'Demo Medical Board' });
    addDoc({ driver_id: d.id, doc_type: 'LPG_HANDLING_CERT', days: ov('LPG_HANDLING_CERT', rng.int(90, 700)), number: `LPGC-${i + 1}`, issuer: 'LPG Safety Training Institute (demo)', validDays: 730 });
  });
  // a couple of renewed documents so history exists (older doc superseded by newer)
  addDoc({ vehicle_id: 3, doc_type: 'INSURANCE', days: -40, number: 'POL-DEMO-0003-OLD', issuer: 'Demo Insurance Co.' });
  addDoc({ driver_id: 8, doc_type: 'MEDICAL', days: -15, number: 'MED-8-OLD', issuer: 'Demo Medical Board' });

  // ---------------------------------------------------------------- trips
  const trips: any[] = []; const events: any[] = []; const checks: any[] = []; const positions: any[] = [];
  const driverUserId = 5; const DISPATCHER = 3; const TM = 2;
  const vBusy = new Map<number, number>(); const dBusy = new Map<number, number>();
  const pool = (used: Set<number>) => vehicles.filter((v) => !RESERVED.has(v.id) && !used.has(v.id));
  const nearestPlant = (d: any) => [osk, dhn, sher, kotal].reduce((b, p) => (haversineKm([p.lat, p.lng], [d.lat, d.lng]) < haversineKm([b.lat, b.lng], [d.lat, d.lng]) ? p : b));
  const distLoc = (dist: any) => locations.find((l) => l.id === dist.location_id)!;
  const loadFor = (v: any) => Math.round(v.capacity_mt * rng.float(0.86, 0.99) * 10) / 10;
  const CHECK_ITEMS = (ok = true, failKey?: string) => PRETRIP_ITEMS.map((it) => ({ ...it, ok: failKey ? it.key !== failKey : ok }));
  let eventId = 1; let checkId = 1; let posId = 1;
  const ev = (trip_id: number, type: string, message: string, when: Date, extra: Record<string, any> = {}) =>
    events.push({ id: eventId++, trip_id, type, from_status: extra.from ?? null, to_status: extra.to ?? null, message, actor_user_id: extra.actor ?? null, lat: extra.lat ?? null, lng: extra.lng ?? null, client_event_id: null, occurred_at: when });

  interface Spec {
    status: string; dist?: any; destLoc?: any; origin?: any; vehicle?: any; driver?: any; load?: number; source?: string; dep: Date; priority?: string; notes?: string;
    progress?: number; speed?: number; delayMin?: number; reason?: string; cancelFrom?: string; hold?: boolean; driverActs?: boolean; precheck?: boolean; deliveredAgoMin?: number; arrivedAgoMin?: number;
  }
  const specs: Spec[] = [];

  // ----- historical completed + cancelled
  const histVehicles = vehicles.filter((v) => v.id !== 26);
  let imported = 0;
  for (let day = -90; day <= -1; day++) {
    const k = rng.chance(0.96) ? rng.int(3, 6) : 0;
    for (let j = 0; j < k; j++) {
      const isUplift = rng.chance(0.28);
      const dist = distributors[(rng.int(0, distributors.length - 1) * 5 + rng.int(0, 3)) % distributors.length];
      const upPlant = rng.pick([osk, sher, kotal]);
      const dl = isUplift ? upPlant : distLoc(dist);
      const useImport = !isUplift && imported < 2 && (day === -38 || day === -12) && j === 0;
      const origin = isUplift ? rng.pick([nashpa, makori]) : useImport ? pqi : nearestPlant(dl);
      const destDist = isUplift ? { id: null as any, contact_name: 'Plant receiving officer', name: upPlant.name } : useImport ? distributors.find((d) => d.city === 'Lahore')! : dist;
      const destLoc = useImport ? distLoc(destDist) : dl;
      if (useImport) imported++;
      const dep = dayAt(day, rng.int(5, 14), rng.pick([0, 15, 30, 45]));
      const route = routeFor(origin.id, destLoc.id);
      const need = Math.round(route.est_duration_min * 2 + 240) * MIN;
      const cands = histVehicles.filter((v) => (vBusy.get(v.id) ?? 0) <= dep.getTime() - 60 * MIN);
      if (!cands.length) continue;
      const hiredBias = useImport ? cands.filter((v) => v.fleet_type === 'HIRED') : cands;
      const v = rng.pick((hiredBias.length ? hiredBias : cands));
      let d = drivers.find((x) => x.id === v.default_driver_id && x.status !== 'SUSPENDED' && (dBusy.get(x.id) ?? 0) <= dep.getTime() - 60 * MIN);
      if (!d) { const dc = drivers.filter((x) => x.id <= 30 && (dBusy.get(x.id) ?? 0) <= dep.getTime() - 60 * MIN); if (!dc.length) continue; d = rng.pick(dc); }
      vBusy.set(v.id, dep.getTime() + need); dBusy.set(d.id, dep.getTime() + need);
      const cancelled = rng.chance(0.022);
      specs.push({ status: cancelled ? 'CANCELLED' : 'COMPLETED', origin, dist: destDist, destLoc, vehicle: v, driver: d, load: loadFor(v), source: useImport ? 'IMPORTED' : 'LOCAL', dep,
        priority: rng.pick(['NORMAL', 'NORMAL', 'NORMAL', 'HIGH', 'LOW']), cancelFrom: cancelled ? rng.pick(['PLANNED', 'ASSIGNED']) : undefined,
        reason: cancelled ? rng.pick(['Customer postponed delivery', 'Distributor tank not ready', 'Plant loading schedule changed', 'Replaced by consolidated trip']) : undefined });
    }
  }

  // ----- trips completed earlier today (short runs), so "Completed today" is never zero
  [['Peshawar', 600], ['Nowshera', 520], ['Haripur', 460]].forEach(([city, minsAgo], i) => {
    const dist = distributors.find((d) => d.city === city)!; const dl = distLoc(dist); const origin = nearestPlant(dl);
    const v = histVehicles.filter((x) => !RESERVED.has(x.id))[20 - i - 1] ?? histVehicles[i];
    const d = drivers[28 - i];
    specs.push({ status: 'COMPLETED', origin, dist, destLoc: dl, vehicle: v, driver: d, load: loadFor(v), source: 'LOCAL', dep: at(-(minsAgo as number)), priority: 'NORMAL' });
    vBusy.set(v.id, NOW); dBusy.set(d.id, NOW);
  });

  // ----- live / active trips (hand-crafted story)
  const used = new Set<number>(); const usedD = new Set<number>();
  const pickV = (prefer?: number) => { const v = prefer ? byCode(prefer) : pool(used)[0]; used.add(v.id); return v; };
  const pickD = (v: any) => { let d = drivers.find((x) => x.id === v.default_driver_id && !usedD.has(x.id) && x.status === 'AVAILABLE' && !SPECIAL_DRIVERS.has(x.id - 1)); if (!d) d = drivers.find((x) => !usedD.has(x.id) && x.status === 'AVAILABLE' && !SPECIAL_DRIVERS.has(x.id - 1) && x.id <= 30)!; usedD.add(d.id); return d; };
  const dByCity = (city: string, nth = 0) => distributors.filter((d) => d.city === city)[nth];
  const live = (status: string, city: string, o: Partial<Spec> & { nth?: number; origin?: any }) => {
    const dist = dByCity(city, o.nth ?? 0); const dl = distLoc(dist); const v = pickV(); const d = pickD(v);
    specs.push({ status, dist, destLoc: dl, origin: o.origin ?? nearestPlant(dl), vehicle: v, driver: d, load: loadFor(v), source: 'LOCAL', dep: at(0), ...o });
  };
  live('IN_TRANSIT', 'Mardan', { origin: osk, progress: 64, speed: 52, priority: 'HIGH', notes: 'Priority refill for Mardan distributor', nth: 0 });
  live('IN_TRANSIT', 'Abbottabad', { progress: 33, speed: 47, origin: dhn });
  live('IN_TRANSIT', 'Mingora', { progress: 48, speed: 44, nth: 0 });
  live('IN_TRANSIT', 'Rawalpindi', { progress: 82, speed: 58, nth: 1 });
  live('IN_TRANSIT', 'Muzaffarabad', { progress: 38, speed: 41, origin: dhn });
  live('IN_TRANSIT', 'Gilgit', { progress: 21, speed: 49, origin: dhn, priority: 'HIGH', notes: 'Long-haul northern areas run' });
  live('DELAYED', 'Lahore', { progress: 41, speed: 31, delayMin: 55, origin: dhn, notes: 'Heavy traffic on GT Road' });
  live('DELAYED', 'Mansehra', { progress: 58, speed: 29, delayMin: 38, origin: dhn });
  live('IN_TRANSIT', 'Mingora', { progress: 55, speed: 0, hold: true, nth: 1, reason: 'Road closure near Malakand — awaiting clearance' });
  live('RETURNING', 'Peshawar', { progress: 35, speed: 53, nth: 0 });
  live('RETURNING', 'Islamabad', { progress: 70, speed: 57, nth: 0, origin: dhn });
  live('ARRIVED', 'Nowshera', { arrivedAgoMin: 18, nth: 0, origin: osk });
  live('DELIVERED', 'Jhelum', { deliveredAgoMin: 22, nth: 0, origin: dhn });
  live('DISPATCHED', 'Swabi', { dep: at(45), precheck: true, nth: 0, origin: osk, priority: 'HIGH' });
  // This dispatched trip belongs to the demo driver account: pre-trip check not yet done, ready for the driver demo.
  live('DISPATCHED', 'Kohat', { dep: at(95), precheck: false, driverActs: true, nth: 0, origin: osk });
  // assigned (upcoming)
  const assigned: [string, number, number, number | undefined, number?][] = [['Peshawar', 1, 3 * 60, 9], ['Nowshera', 0, 6 * 60, undefined], ['Abbottabad', 1, 22 * 60, 14], ['Faisalabad', 0, 30 * 60, 22], ['Mansehra', 0, 52 * 60, undefined]];
  assigned.forEach(([city, nth, minsAhead, vCode]) => {
    const dl = distLoc(dByCity(city, nth)); const v = pickV(vCode); const d = pickD(v);
    specs.push({ status: 'ASSIGNED', dist: dByCity(city, nth), destLoc: dl, origin: nearestPlant(dl), vehicle: v, driver: d, load: Math.min(loadFor(v), v.capacity_mt), source: 'LOCAL', dep: at(minsAhead) });
  });
  [['Kotli', 0, 26 * 60], ['Skardu', 0, 40 * 60], ['Sargodha', 0, 60 * 60], ['Chitral', 0, 70 * 60]].forEach(([city, , minsAhead], i) => {
    const dist = i === 3 ? dByCity('Bannu') : dByCity(city as string); const dl = distLoc(dist);
    specs.push({ status: 'PLANNED', dist, destLoc: dl, origin: nearestPlant(dl), load: [12, 18, 15, 10][i], source: 'LOCAL', dep: at(minsAhead as number), priority: i === 1 ? 'HIGH' : 'NORMAL' });
  });
  [['Mirpur', 0, 90 * 60], ['Gujrat', 0, 100 * 60]].forEach(([city, , minsAhead]) => {
    const dl = distLoc(dByCity(city as string)); specs.push({ status: 'DRAFT', dist: dByCity(city as string), destLoc: dl, origin: nearestPlant(dl), load: 14, source: 'LOCAL', dep: at(minsAhead as number) });
  });
  { const dl = distLoc(dByCity('Gilgit', 1)); const v = byCode(9); specs.push({ status: 'CANCELLED', dist: dByCity('Gilgit', 1), destLoc: dl, origin: dhn, vehicle: v, driver: pickD(v), load: 12, source: 'LOCAL', dep: at(8 * 60), cancelFrom: 'ASSIGNED', reason: 'Distributor requested postponement to next week' }); }

  // sort chronologically, assign ids / codes
  specs.sort((a, b) => a.dep.getTime() - b.dep.getTime());
  const driverAccountDriver = specs.find((s) => s.driverActs)!.driver;

  let seq = 0;
  const lastKnown = new Map<number, { lat: number; lng: number; locId: number | null; at: number }>();
  specs.forEach((s) => {
    const id = ++seq; const origin = s.origin; const destLoc = s.destLoc; const route = routeFor(origin.id, destLoc.id);
    const dur = route.est_duration_min; const code = `TRP-${s.dep.getUTCFullYear()}-${String(id).padStart(4, '0')}`;
    const planned_arrival = new Date(s.dep.getTime() + dur * MIN);
    const created = new Date(s.dep.getTime() - rng.int(1, 4) * DAY - rng.int(0, 5) * 3600_000);
    const t: any = {
      id, code, status: s.status, status_before_hold: null, priority: s.priority ?? 'NORMAL', origin_location_id: origin.id, destination_location_id: destLoc.id, distributor_id: s.dist?.id ?? null, route_id: route.id,
      vehicle_id: s.vehicle?.id ?? null, driver_id: s.driver?.id ?? null, lpg_source: s.source ?? 'LOCAL', planned_load_mt: s.load, loaded_mt: null, delivered_mt: null,
      scheduled_departure: s.dep, planned_arrival, dispatched_at: null, departed_at: null, arrived_at: null, delivered_at: null, return_started_at: null, completed_at: null, cancelled_at: null,
      delay_minutes: 0, hold_reason: null, cancel_reason: null, delivery_note_no: null, received_by: null, pod_notes: null, notes: s.notes ?? null,
      progress_pct: 0, cur_lat: origin.lat, cur_lng: origin.lng, cur_speed_kmh: 0, eta_at: null, last_position_at: null, created_by: rng.chance(0.5) ? DISPATCHER : TM, created_at: created, updated_at: created,
    };
    const actor = s.driverActs ? driverUserId : DISPATCHER;
    ev(id, 'STATUS_CHANGE', `Trip ${code} created`, created, { to: 'DRAFT', actor: t.created_by });
    const planAt = new Date(created.getTime() + 10 * MIN);
    const reached = (st: string) => ['PLANNED', 'ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'DELAYED', 'ON_HOLD', 'ARRIVED', 'DELIVERED', 'RETURNING', 'COMPLETED'].indexOf(st) >= 0;
    if (s.status !== 'DRAFT') ev(id, 'STATUS_CHANGE', 'Confirm plan: Draft → Planned', planAt, { from: 'DRAFT', to: 'PLANNED', actor: t.created_by });
    const vcode = s.vehicle?.code; const dname = s.driver?.full_name;
    const assignAt = new Date(planAt.getTime() + rng.int(20, 180) * MIN);
    const wasAssigned = s.vehicle && (s.status !== 'PLANNED' && s.status !== 'DRAFT' && (s.status !== 'CANCELLED' || s.cancelFrom !== 'PLANNED'));
    if (wasAssigned) ev(id, 'ASSIGNMENT', `Assigned vehicle ${vcode} and driver ${dname}`, assignAt, { from: 'PLANNED', to: 'ASSIGNED', actor: DISPATCHER });
    if (s.status === 'CANCELLED') {
      t.cancelled_at = new Date(Math.min(NOW - 5 * MIN, s.dep.getTime() - rng.int(30, 300) * MIN)); t.cancel_reason = s.reason;
      if (!wasAssigned) { t.vehicle_id = null; t.driver_id = null; }
      ev(id, 'STATUS_CHANGE', `Cancelled: ${s.reason}`, t.cancelled_at, { from: s.cancelFrom ?? 'PLANNED', to: 'CANCELLED', actor: TM });
      trips.push(t); return;
    }
    // execution timeline
    const execStatuses = ['DISPATCHED', 'IN_TRANSIT', 'DELAYED', 'ON_HOLD', 'ARRIVED', 'DELIVERED', 'RETURNING', 'COMPLETED'];
    if (!execStatuses.includes(s.status)) { trips.push(t); return; }
    t.dispatched_at = new Date((s.status === 'DISPATCHED' ? NOW - 30 * MIN : s.dep.getTime() - rng.int(60, 150) * MIN));
    ev(id, 'STATUS_CHANGE', `Dispatched with ${vcode} / ${dname}`, t.dispatched_at, { from: 'ASSIGNED', to: 'DISPATCHED', actor: DISPATCHER });
    const withCheck = s.status !== 'DISPATCHED' || s.precheck;
    if (withCheck) {
      const when = new Date(t.dispatched_at.getTime() + rng.int(15, 40) * MIN);
      if (s.status === 'COMPLETED' && rng.chance(0.07)) {
        const failAt = new Date(when.getTime() - 12 * MIN);
        checks.push({ id: checkId++, trip_id: id, vehicle_id: s.vehicle.id, driver_id: s.driver.id, kind: 'PRE_TRIP', result: 'FAIL', items: J(CHECK_ITEMS(true, 'fire_ext')), notes: 'Fire extinguisher pressure low — replaced', completed_by: actor, completed_at: failAt });
        ev(id, 'CHECK', 'Pre-trip safety check FAILED: Fire extinguishers (2x) charged', failAt, { actor });
      }
      checks.push({ id: checkId++, trip_id: id, vehicle_id: s.vehicle.id, driver_id: s.driver.id, kind: 'PRE_TRIP', result: 'PASS', items: J(CHECK_ITEMS()), notes: null, completed_by: actor, completed_at: when });
      ev(id, 'CHECK', 'Pre-trip safety check passed', when, { actor });
      t.__checkAt = when;
    }
    if (s.status === 'DISPATCHED') { t.updated_at = t.dispatched_at; trips.push(t); return; }

    const actualFactor = s.status === 'COMPLETED' ? (rng.chance(0.14) ? rng.float(1.18, 1.5) : rng.float(0.88, 1.03)) : 1;
    let outboundMin = dur * actualFactor;
    const loaded = Math.round(s.load! * rng.float(0.985, 1) * 100) / 100; t.loaded_mt = loaded;
    const path: LatLng[] = route.path;
    const cps = route.checkpoints as { name: string; at: number }[];
    const trail = (fromT: number, frac: number, reversed: boolean, spanMin: number) => {
      const n = Math.max(4, Math.min(70, Math.round(spanMin / 9)));
      for (let k = 0; k <= n; k++) {
        const f = (frac * k) / n; const { point, heading } = pointAt(reversed ? [...path].reverse() : path, f);
        positions.push({ id: posId++, trip_id: id, lat: point[0], lng: point[1], speed_kmh: k === n ? t.cur_speed_kmh : rng.int(38, 62), heading, recorded_at: new Date(fromT + (spanMin * MIN * k) / n) });
      }
    };
    const setLive = (frac: number, reversed: boolean, speed: number, etaMin: number) => {
      const { point } = pointAt(reversed ? [...path].reverse() : path, frac);
      Object.assign(t, { cur_lat: point[0], cur_lng: point[1], cur_speed_kmh: speed, progress_pct: Math.round(frac * 1000) / 10, eta_at: at(Math.round(etaMin)), last_position_at: at(-rng.int(0, 1)) });
    };

    if (s.status === 'IN_TRANSIT' || s.status === 'DELAYED') {
      const frac = s.progress! / 100;
      const slow = s.status === 'DELAYED' ? 1.45 : 1;
      const elapsed = dur * frac * slow;
      t.departed_at = at(-Math.round(elapsed)); t.scheduled_departure = new Date(t.departed_at.getTime() - rng.int(5, 18) * MIN); t.planned_arrival = new Date(t.scheduled_departure.getTime() + dur * MIN);
      t.dispatched_at = new Date(t.scheduled_departure.getTime() - 80 * MIN);
      ev(id, 'STATUS_CHANGE', `Departed with ${loaded} MT LPG`, t.departed_at, { from: 'DISPATCHED', to: 'IN_TRANSIT', actor });
      for (const cp of cps) if (frac >= cp.at) ev(id, 'CHECKPOINT', `Passed ${cp.name}`, new Date(t.departed_at.getTime() + elapsed * (cp.at / frac) * MIN), { lat: pointAt(path, cp.at).point[0], lng: pointAt(path, cp.at).point[1] });
      const etaMin = (dur * (1 - frac)) * (s.status === 'DELAYED' ? 1.3 : 1);
      setLive(frac, false, s.speed!, etaMin);
      if (s.status === 'DELAYED') {
        t.delay_minutes = s.delayMin!;
        t.planned_arrival = new Date(t.eta_at.getTime() - s.delayMin! * MIN);
        ev(id, 'STATUS_CHANGE', `Mark delayed: projected ${s.delayMin} min behind plan — ${s.notes ?? 'slow traffic'}`, at(-25), { from: 'IN_TRANSIT', to: 'DELAYED', actor: DISPATCHER });
      }
      if (s.hold) {
        t.status = 'ON_HOLD'; t.status_before_hold = 'IN_TRANSIT'; t.hold_reason = s.reason; t.cur_speed_kmh = 0;
        ev(id, 'STATUS_CHANGE', `Put on hold: ${s.reason}`, at(-35), { from: 'IN_TRANSIT', to: 'ON_HOLD', actor: DISPATCHER });
      }
      trail(t.departed_at.getTime(), frac, false, elapsed);
    } else if (s.status === 'ARRIVED' || s.status === 'DELIVERED') {
      const arrAgo = s.status === 'ARRIVED' ? s.arrivedAgoMin! : (s.deliveredAgoMin! + 50);
      t.arrived_at = at(-arrAgo); t.departed_at = new Date(t.arrived_at.getTime() - Math.round(dur * 1.02) * MIN); t.scheduled_departure = new Date(t.departed_at.getTime() - 10 * MIN); t.planned_arrival = new Date(t.scheduled_departure.getTime() + dur * MIN);
      t.dispatched_at = new Date(t.scheduled_departure.getTime() - 80 * MIN);
      t.delay_minutes = Math.max(0, Math.round((t.arrived_at.getTime() - t.planned_arrival.getTime()) / MIN));
      ev(id, 'STATUS_CHANGE', `Departed with ${loaded} MT LPG`, t.departed_at, { from: 'DISPATCHED', to: 'IN_TRANSIT', actor });
      for (const cp of cps) ev(id, 'CHECKPOINT', `Passed ${cp.name}`, new Date(t.departed_at.getTime() + dur * cp.at * MIN), { lat: pointAt(path, cp.at).point[0], lng: pointAt(path, cp.at).point[1] });
      ev(id, 'STATUS_CHANGE', `Arrived at ${destLoc.name}`, t.arrived_at, { from: 'IN_TRANSIT', to: 'ARRIVED', actor });
      Object.assign(t, { cur_lat: destLoc.lat, cur_lng: destLoc.lng, cur_speed_kmh: 0, progress_pct: 100, eta_at: t.arrived_at, last_position_at: at(-1) });
      if (s.status === 'DELIVERED') {
        t.delivered_at = at(-s.deliveredAgoMin!); t.delivered_mt = Math.round(loaded * 0.996 * 100) / 100; t.received_by = `${s.dist.contact_name}`; t.delivery_note_no = `DN-${code.slice(-4)}`;
        ev(id, 'STATUS_CHANGE', `Delivered ${t.delivered_mt} MT, received by ${t.received_by}`, t.delivered_at, { from: 'ARRIVED', to: 'DELIVERED', actor });
      }
      trail(t.departed_at.getTime(), 1, false, dur);
    } else if (s.status === 'RETURNING') {
      const frac = s.progress! / 100; const retElapsed = dur * frac;
      t.return_started_at = at(-Math.round(retElapsed)); t.delivered_at = new Date(t.return_started_at.getTime() - 15 * MIN); t.arrived_at = new Date(t.delivered_at.getTime() - 55 * MIN);
      t.departed_at = new Date(t.arrived_at.getTime() - Math.round(dur * 1.03) * MIN); t.scheduled_departure = new Date(t.departed_at.getTime() - 8 * MIN); t.planned_arrival = new Date(t.scheduled_departure.getTime() + dur * MIN);
      t.dispatched_at = new Date(t.scheduled_departure.getTime() - 80 * MIN); t.delay_minutes = Math.max(0, Math.round((t.arrived_at.getTime() - t.planned_arrival.getTime()) / MIN));
      t.delivered_mt = Math.round(loaded * 0.997 * 100) / 100; t.received_by = s.dist.contact_name; t.delivery_note_no = `DN-${code.slice(-4)}`;
      ev(id, 'STATUS_CHANGE', `Departed with ${loaded} MT LPG`, t.departed_at, { from: 'DISPATCHED', to: 'IN_TRANSIT', actor });
      ev(id, 'STATUS_CHANGE', `Arrived at ${destLoc.name}`, t.arrived_at, { from: 'IN_TRANSIT', to: 'ARRIVED', actor });
      ev(id, 'STATUS_CHANGE', `Delivered ${t.delivered_mt} MT, received by ${t.received_by}`, t.delivered_at, { from: 'ARRIVED', to: 'DELIVERED', actor });
      ev(id, 'STATUS_CHANGE', 'Vehicle started return to plant', t.return_started_at, { from: 'DELIVERED', to: 'RETURNING', actor });
      setLive(frac, true, s.speed!, dur * (1 - frac));
      trail(t.return_started_at.getTime(), frac, true, retElapsed);
    } else if (s.status === 'COMPLETED') {
      t.departed_at = new Date(s.dep.getTime() + rng.int(0, 10) * MIN);
      t.arrived_at = new Date(t.departed_at.getTime() + Math.round(outboundMin) * MIN);
      t.delay_minutes = Math.max(0, Math.round((t.arrived_at.getTime() - planned_arrival.getTime()) / MIN));
      t.delivered_at = new Date(t.arrived_at.getTime() + rng.int(35, 85) * MIN);
      t.return_started_at = new Date(t.delivered_at.getTime() + 15 * MIN);
      t.completed_at = new Date(t.return_started_at.getTime() + Math.round(dur * rng.float(0.92, 1.1)) * MIN);
      t.delivered_mt = Math.round(loaded * rng.float(0.992, 1) * 100) / 100; t.received_by = s.dist.contact_name; t.delivery_note_no = `DN-${code.slice(-4)}`;
      t.progress_pct = 100; t.last_position_at = t.completed_at; t.updated_at = t.completed_at; t.eta_at = t.arrived_at;
      ev(id, 'STATUS_CHANGE', `Departed with ${loaded} MT LPG`, t.departed_at, { from: 'DISPATCHED', to: 'IN_TRANSIT', actor });
      for (const cp of cps) ev(id, 'CHECKPOINT', `Passed ${cp.name}`, new Date(t.departed_at.getTime() + outboundMin * cp.at * MIN), { lat: pointAt(path, cp.at).point[0], lng: pointAt(path, cp.at).point[1] });
      ev(id, 'STATUS_CHANGE', `Arrived at ${destLoc.name}${t.delay_minutes > 15 ? ` (${t.delay_minutes} min late)` : ''}`, t.arrived_at, { from: 'IN_TRANSIT', to: 'ARRIVED', actor });
      ev(id, 'STATUS_CHANGE', `Delivered ${t.delivered_mt} MT, received by ${t.received_by}`, t.delivered_at, { from: 'ARRIVED', to: 'DELIVERED', actor });
      ev(id, 'STATUS_CHANGE', 'Vehicle started return to plant', t.return_started_at, { from: 'DELIVERED', to: 'RETURNING', actor });
      ev(id, 'STATUS_CHANGE', 'Complete trip: Returning → Completed', t.completed_at, { from: 'RETURNING', to: 'COMPLETED', actor });
      t.cur_lat = origin.lat; t.cur_lng = origin.lng;
      if (rng.chance(0.2)) checks.push({ id: checkId++, trip_id: id, vehicle_id: s.vehicle.id, driver_id: s.driver.id, kind: 'POST_TRIP', result: 'PASS', items: J(CHECK_ITEMS()), notes: null, completed_by: actor, completed_at: new Date(t.completed_at.getTime() + 10 * MIN) });
    }
    t.updated_at = t.updated_at > t.created_at ? t.updated_at : at(-2);
    if (s.vehicle && ['IN_TRANSIT', 'DELAYED', 'ON_HOLD', 'ARRIVED', 'DELIVERED', 'RETURNING'].includes(t.status)) lastKnown.set(s.vehicle.id, { lat: t.cur_lat, lng: t.cur_lng, locId: null, at: NOW });
    trips.push(t);
  });
  // strip helper field
  trips.forEach((t) => delete t.__checkAt);
  // Phase A: trip economics, odometers, fuel, expenses, approvals
  const routesById = new Map<number, any>([...routes.values()].map((r) => [r.id, r]));
  const econ = economicsPass({ trips, vehicles, routesById, locations, marketerIds: marketers.map((m) => m.id), rng, NOW, autoLimit: 5000 });

  // vehicle / driver live state
  const execSet = new Set(['DISPATCHED', 'IN_TRANSIT', 'DELAYED', 'ON_HOLD', 'ARRIVED', 'DELIVERED', 'RETURNING']);
  const lastDone = new Map<number, any>();
  trips.filter((t) => t.status === 'COMPLETED').forEach((t) => lastDone.set(t.vehicle_id, t));
  const execV = new Set(trips.filter((t) => execSet.has(t.status)).map((t) => t.vehicle_id));
  const execD = new Set(trips.filter((t) => execSet.has(t.status)).map((t) => t.driver_id));
  vehicles.forEach((v) => {
    const lt = trips.find((t) => execSet.has(t.status) && t.vehicle_id === v.id);
    if (lt) { v.status = 'ON_TRIP'; v.last_lat = lt.cur_lat; v.last_lng = lt.cur_lng; v.last_speed_kmh = lt.cur_speed_kmh ?? 0; v.last_position_at = lt.last_position_at ?? at(-2); v.last_location_id = lt.status === 'DISPATCHED' ? lt.origin_location_id : null; }
    else {
      const home = locations.find((l) => l.id === v.home_plant_id)!;
      v.last_lat = home.lat; v.last_lng = home.lng; v.last_location_id = home.id; v.last_position_at = lastDone.get(v.id)?.completed_at ?? at(-60 * 24 * 3);
    }
  });
  drivers.forEach((d) => { if (execD.has(d.id)) d.status = 'ON_TRIP'; });
  // a few drivers off-duty today among the pool for realism handled above

  // ---------------------------------------------------------------- maintenance
  const maint: any[] = []; let mId = 1;
  vehicles.forEach((v) => {
    const history = rng.int(1, 3);
    for (let h = 0; h < history; h++) {
      const job = rng.pick(MAINT_JOBS); const daysAgo = rng.int(20, 170); const when = dateStr(-daysAgo);
      maint.push({ id: mId++, vehicle_id: v.id, type: job.type, status: 'COMPLETED', title: job.title, description: null, scheduled_on: when, started_at: new Date(Date.parse(when) + 4 * 3600_000), completed_at: new Date(Date.parse(when) + 28 * 3600_000), odometer_km: Math.max(1000, v.odometer_km - daysAgo * 90), cost_pkr: rng.int(job.cost[0], job.cost[1]), vendor: rng.pick(MAINT_VENDORS), created_by: 4, created_at: new Date(Date.parse(when) - 5 * DAY), updated_at: new Date(Date.parse(when) + DAY) });
    }
  });
  const sched = (vid: number, days: number, job: (typeof MAINT_JOBS)[number], status = 'SCHEDULED', extra: any = {}) =>
    maint.push({ id: mId++, vehicle_id: vid, type: job.type, status, title: job.title, description: null, scheduled_on: dateStr(days), started_at: null, completed_at: null, odometer_km: null, cost_pkr: null, vendor: rng.pick(MAINT_VENDORS), created_by: 4, created_at: at(-60 * 24 * 6), updated_at: at(-60 * 24 * 2), ...extra });
  sched(5, -2, MAINT_JOBS[3], 'IN_PROGRESS', { started_at: at(-60 * 20) });
  sched(17, -4, MAINT_JOBS[1], 'IN_PROGRESS', { started_at: at(-60 * 70), description: 'Brake overhaul — front axle' });
  sched(3, 2, MAINT_JOBS[0]); sched(8, 4, MAINT_JOBS[2]); sched(12, 6, MAINT_JOBS[6]); sched(16, -3, MAINT_JOBS[0]);
  sched(2, 12, MAINT_JOBS[1]); sched(6, 18, MAINT_JOBS[3]); sched(10, 25, MAINT_JOBS[0]); sched(19, 9, MAINT_JOBS[2]); sched(23, 15, MAINT_JOBS[0]);

  // ---------------------------------------------------------------- incidents
  const incidents: any[] = []; let incId = 1;
  const completed = trips.filter((t) => t.status === 'COMPLETED');
  const inc = (cat: string, sev: string, status: string, desc: string, resolution: string | null, ref: any, ago: number) => {
    const reported = at(-ago * 60 * 24); incidents.push({ id: incId++, code: `INC-${reported.getUTCFullYear()}-${String(incId - 1).padStart(4, '0')}`, trip_id: ref?.id ?? null, vehicle_id: ref?.vehicle_id ?? null, driver_id: ref?.driver_id ?? null, category: cat, severity: sev, status, description: desc, resolution, lat: ref?.cur_lat ?? null, lng: ref?.cur_lng ?? null, reported_by: 3, reported_at: reported, closed_at: status === 'CLOSED' ? new Date(reported.getTime() + 2 * DAY) : null });
  };
  inc('BREAKDOWN', 'MEDIUM', 'CLOSED', 'Air-brake pressure drop reported near Nowshera; vehicle held at roadside for inspection.', 'Compressor governor replaced at workshop; vehicle returned to service.', completed[Math.floor(completed.length * 0.2)], 61);
  inc('GAS_LEAK', 'HIGH', 'CLOSED', 'Minor LPG seepage detected at unloading hose coupling during delivery. Unloading stopped, area isolated.', 'Hose coupling replaced, leak test passed, crew re-briefed on coupling inspection.', completed[Math.floor(completed.length * 0.4)], 44);
  inc('DELAY', 'LOW', 'CLOSED', 'Two-hour delay due to protest blocking highway.', 'Rerouted; no cargo impact.', completed[Math.floor(completed.length * 0.55)], 33);
  inc('ACCIDENT', 'MEDIUM', 'CLOSED', 'Minor side-swipe by a car at a toll plaza, no injuries, cosmetic damage to mudguard.', 'Repaired; insurance report filed.', completed[Math.floor(completed.length * 0.7)], 21);
  inc('ROUTE_BLOCKED', 'LOW', 'INVESTIGATING', 'Landslide debris partially blocking road, single lane open.', null, completed[Math.floor(completed.length * 0.9)], 4);
  const heldTrip = trips.find((t) => t.status === 'ON_HOLD');
  if (heldTrip) inc('ROUTE_BLOCKED', 'MEDIUM', 'OPEN', 'Road closure near Malakand; vehicle parked at designated safe halt, driver and cargo secure. Awaiting clearance from local authorities.', null, heldTrip, 0);
  const delayedTrip = trips.find((t) => t.status === 'DELAYED');
  if (delayedTrip) inc('DELAY', 'LOW', 'OPEN', 'Heavy congestion, estimated one-hour delay.', null, delayedTrip, 0);

  // ---------------------------------------------------------------- users
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users = [
    { id: 1, email: 'superadmin@gasman-demo.local', full_name: 'Muhammad Ali', role: 'SUPER_ADMIN', driver_id: null },
    { id: 2, email: 'transport.manager@gasman-demo.local', full_name: 'Ahsan Raza', role: 'TRANSPORT_MANAGER', driver_id: null },
    { id: 3, email: 'dispatcher@gasman-demo.local', full_name: 'Bilal Ahmed', role: 'DISPATCHER', driver_id: null },
    { id: 4, email: 'fleet.manager@gasman-demo.local', full_name: 'Tariq Mehmood', role: 'FLEET_MANAGER', driver_id: null },
    { id: 5, email: 'driver@gasman-demo.local', full_name: driverAccountDriver.full_name, role: 'DRIVER', driver_id: driverAccountDriver.id },
    { id: 6, email: 'management@gasman-demo.local', full_name: 'Saleem Qureshi', role: 'MANAGEMENT_VIEWER', driver_id: null },
    { id: 7, email: 'dispatcher2@gasman-demo.local', full_name: 'Hina Farooq', role: 'DISPATCHER', driver_id: null },
    { id: 8, email: 'accountant@gasman-demo.local', full_name: 'Rukhsana Iqbal', role: 'ACCOUNTANT', driver_id: null },
    { id: 9, email: 'store.manager@gasman-demo.local', full_name: 'Naveed Anjum', role: 'STORE_MANAGER', driver_id: null },
    { id: 10, email: 'hr.manager@gasman-demo.local', full_name: 'Saima Aslam', role: 'HR_MANAGER', driver_id: null },
  ].map((u) => ({ ...u, password_hash: hash, phone: `0300-555${String(9000 + u.id)}`, status: 'ACTIVE', failed_logins: 0, locked_until: null, last_login_at: at(-60 * 3 * u.id), created_at: at(-60 * 24 * 200), updated_at: at(-60 * 24 * 200) }));

  // ---------------------------------------------------------------- persist
  await bulk('drivers', drivers);
  await bulk('users', users);
  await bulk('vehicles', vehicles);
  // routes referenced by trips (all that were generated)
  await bulk('routes', [...routes.values()].map((r) => ({ ...r, path: J(r.path), checkpoints: J(r.checkpoints), created_at: at(-60 * 24 * 100) })));
  await bulk('documents', documents);
  await bulk('maintenance_records', maint);
  await bulk('trips', trips);
  await bulk('fuel_entries', econ.fuel);
  await bulk('trip_expenses', econ.expenses);
  await bulk('approvals', econ.approvals);
  await bulk('approval_rules', [
    { id: 1, entity_type: 'TRIP_EXPENSE', min_amount: 0, approver_role: 'TRANSPORT_MANAGER', active: true, note: 'Expenses above the auto-approval limit' },
    { id: 2, entity_type: 'TRIP_EXPENSE', min_amount: 50000, approver_role: 'SUPER_ADMIN', active: true, note: 'High-value expenses' },
    { id: 3, entity_type: 'PURCHASE_REQUISITION', min_amount: 0, approver_role: 'TRANSPORT_MANAGER', active: true, note: null },
    { id: 4, entity_type: 'PURCHASE_ORDER', min_amount: 0, approver_role: 'TRANSPORT_MANAGER', active: true, note: null },
    { id: 5, entity_type: 'PURCHASE_ORDER', min_amount: 250000, approver_role: 'SUPER_ADMIN', active: true, note: 'Large purchases' },
    { id: 6, entity_type: 'LEAVE', min_amount: 0, approver_role: 'HR_MANAGER', active: true, note: null },
    { id: 7, entity_type: 'PAYROLL', min_amount: 0, approver_role: 'SUPER_ADMIN', active: true, note: 'Monthly payroll run' },
  ]);
  await seedSettings();
  await bulk('trip_events', events);
  await bulk('safety_checks', checks);
  await bulk('trip_positions', positions);
  await bulk('incidents', incidents);

  // notifications (hand-written story over last 3 days) + derived compliance alerts
  const nrows: any[] = [];
  const n = (minsAgo: number, roles: string[] | null, userId: number | null, type: string, severity: string, title: string, body: string | null, et: string | null, eid: number | null) =>
    nrows.push({ user_id: userId, roles: roles ? `{${roles.join(',')}}` : null, type, severity, title, body, entity_type: et, entity_id: eid, dedupe_key: null, created_at: at(-minsAgo) });
  const OPS = ['SUPER_ADMIN', 'TRANSPORT_MANAGER', 'DISPATCHER'];
  trips.filter((t) => ['DELAYED', 'ON_HOLD'].includes(t.status)).forEach((t, i) => n(25 + i * 10, OPS, null, t.status === 'DELAYED' ? 'TRIP_DELAYED' : 'TRIP_ON_HOLD', 'WARNING', t.status === 'DELAYED' ? `Trip ${t.code} is delayed` : `Trip ${t.code} put on hold`, t.status === 'DELAYED' ? `Projected ${t.delay_minutes} min behind plan` : t.hold_reason, 'TRIP', t.id));
  trips.filter((t) => t.status === 'DISPATCHED').forEach((t, i) => n(30 + i * 5, OPS, null, 'TRIP_DISPATCHED', 'INFO', `Trip ${t.code} dispatched`, null, 'TRIP', t.id));
  const myTrip = trips.find((t) => t.status === 'DISPATCHED' && t.driver_id === driverAccountDriver.id)!;
  n(28, null, 5, 'TRIP_ASSIGNED', 'INFO', `New trip ${myTrip.code} assigned to you`, 'Complete the pre-trip safety check and start the trip when loaded.', 'TRIP', myTrip.id);
  trips.filter((t) => t.status === 'COMPLETED').slice(-5).forEach((t, i) => n(120 + i * 180, OPS, null, 'TRIP_COMPLETED', 'SUCCESS', `Trip ${t.code} completed`, `Delivered ${t.delivered_mt} MT`, 'TRIP', t.id));
  const openInc = incidents.filter((i) => i.status !== 'CLOSED');
  openInc.forEach((i, k) => n(40 + k * 15, ['SUPER_ADMIN', 'TRANSPORT_MANAGER', 'DISPATCHER', 'FLEET_MANAGER', 'MANAGEMENT_VIEWER'], null, 'INCIDENT_REPORTED', 'WARNING', `Safety incident ${i.code}: ${i.category.replace('_', ' ').toLowerCase()}`, i.description.slice(0, 160), 'INCIDENT', i.id));
  for (const row of nrows) await sequelize.query(
    `INSERT INTO notifications (user_id, roles, type, severity, title, body, entity_type, entity_id, dedupe_key, created_at) VALUES (:user_id, :roles, :type, :severity, :title, :body, :entity_type, :entity_id, :dedupe_key, :created_at)`, { replacements: row });

  // audit trail: derive from trip events + logins + master-data actions
  const audits: any[] = []; let aId = 1;
  const emailOf = (id: number | null) => users.find((u) => u.id === id)?.email ?? 'system';
  events.filter((e) => e.type !== 'CHECKPOINT' && e.occurred_at.getTime() > NOW - 30 * DAY).forEach((e) => {
    const t = trips[e.trip_id - 1]; const act = e.type === 'ASSIGNMENT' ? 'ASSIGN' : e.to_status === 'DISPATCHED' ? 'DISPATCH' : e.to_status === 'COMPLETED' ? 'COMPLETE' : e.to_status === 'CANCELLED' ? 'CANCEL' : e.type === 'CHECK' ? 'SAFETY_CHECK' : e.to_status === 'DRAFT' ? 'CREATE' : 'STATUS_CHANGE';
    audits.push({ id: 0, user_id: e.actor_user_id, user_email: emailOf(e.actor_user_id), action: act, entity_type: 'TRIP', entity_id: t.id, entity_label: t.code, ip: '10.0.0.' + (10 + (t.id % 40)), meta: e.to_status ? J({ from: e.from_status, to: e.to_status }) : null, created_at: e.occurred_at });
  });
  for (let i = 0; i < 70; i++) { const u = users[i % users.length]; audits.push({ id: 0, user_id: u.id, user_email: u.email, action: 'LOGIN', entity_type: 'USER', entity_id: u.id, entity_label: u.full_name, ip: '10.0.0.' + (10 + (i % 30)), meta: null, created_at: at(-Math.floor((i + 1) * 77 + rng.int(0, 40))) }); }
  [['CREATE', 'VEHICLE', 'GAS-BZ-024', 4, 70], ['UPDATE', 'DRIVER', 'Imran Khan', 4, 50], ['DOCUMENT_ADDED', 'VEHICLE', 'GAS-BZ-003: INSURANCE', 4, 40], ['CREATE', 'DISTRIBUTOR', 'Baltistan LPG Supply', 2, 30], ['UPDATE', 'VEHICLE', 'GAS-BZ-017', 4, 4]]
    .forEach(([a, et, label, uid, daysAgo]) => audits.push({ id: 0, user_id: uid, user_email: emailOf(uid as number), action: a, entity_type: et, entity_id: null, entity_label: label, ip: '10.0.0.21', meta: null, created_at: at(-(daysAgo as number) * 60 * 24) }));
  audits.sort((a, b) => a.created_at.getTime() - b.created_at.getTime()).forEach((a, i) => (a.id = i + 1));
  await bulk('audit_logs', audits);

  // sequences continue after seeded ids
  await sequelize.query(`
    SELECT setval(pg_get_serial_sequence('locations','id'), (SELECT max(id) FROM locations));
    SELECT setval(pg_get_serial_sequence('distributors','id'), (SELECT max(id) FROM distributors));
    SELECT setval(pg_get_serial_sequence('routes','id'), (SELECT max(id) FROM routes));
    SELECT setval(pg_get_serial_sequence('drivers','id'), (SELECT max(id) FROM drivers));
    SELECT setval(pg_get_serial_sequence('vehicles','id'), (SELECT max(id) FROM vehicles));
    SELECT setval(pg_get_serial_sequence('users','id'), (SELECT max(id) FROM users));
    SELECT setval(pg_get_serial_sequence('documents','id'), (SELECT max(id) FROM documents));
    SELECT setval(pg_get_serial_sequence('trips','id'), (SELECT max(id) FROM trips));
    SELECT setval(pg_get_serial_sequence('trip_events','id'), (SELECT max(id) FROM trip_events));
    SELECT setval(pg_get_serial_sequence('trip_positions','id'), (SELECT max(id) FROM trip_positions));
    SELECT setval(pg_get_serial_sequence('safety_checks','id'), (SELECT max(id) FROM safety_checks));
    SELECT setval(pg_get_serial_sequence('incidents','id'), (SELECT max(id) FROM incidents));
    SELECT setval(pg_get_serial_sequence('maintenance_records','id'), (SELECT max(id) FROM maintenance_records));
    SELECT setval(pg_get_serial_sequence('audit_logs','id'), (SELECT max(id) FROM audit_logs));
    SELECT setval(pg_get_serial_sequence('notifications','id'), (SELECT max(id) FROM notifications));
    SELECT setval(pg_get_serial_sequence('fuel_entries','id'), (SELECT GREATEST(max(id),1) FROM fuel_entries));
    SELECT setval(pg_get_serial_sequence('trip_expenses','id'), (SELECT GREATEST(max(id),1) FROM trip_expenses));
    SELECT setval(pg_get_serial_sequence('approvals','id'), (SELECT GREATEST(max(id),1) FROM approvals));
    SELECT setval(pg_get_serial_sequence('approval_rules','id'), (SELECT max(id) FROM approval_rules));
    SELECT setval('trip_code_seq', ${trips.length});
    SELECT setval('incident_code_seq', ${incidents.length});`);
  await seedStops({ rng, NOW, log: log ? (m) => logger.info(m) : undefined });
  await seedFinance({ rng, NOW, log: log ? (m) => logger.info(m) : undefined });
  await sequelize.query(`UPDATE fiscal_years SET status = 'OPEN'`);
  await seedInventory({ rng, NOW, log: log ? (m) => logger.info(m) : undefined });
  await seedHr({ rng, NOW, log: log ? (m) => logger.info(m) : undefined });
  await sequelize.query(`UPDATE fiscal_years SET status = 'CLOSED' WHERE ends_on < CURRENT_DATE`);
  await generateComplianceAlerts();
  const summary = { users: users.length, vehicles: vehicles.length, drivers: drivers.length, distributors: distributors.length, trips: trips.length, events: events.length, documents: documents.length };
  if (log) logger.info(summary, 'demo seed complete');
  return summary;
}

export { q };

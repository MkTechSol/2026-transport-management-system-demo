import type { Request } from 'express';
import {
  allowedTransitions, findTransition, roleCanTarget, REQUIRED_DRIVER_DOCS, REQUIRED_VEHICLE_DOCS, DOC_TYPE_LABELS,
  TRIP_STATUS_LABELS, TripStatus, Role, Transition,
} from '@gasman/shared';
import { q, q1, exec, sequelize } from '../db/sequelize';
import { AppError, conflict, forbidden, notFound, unprocessable, badRequest } from '../lib/errors';
import crypto from 'node:crypto';
import { buildSyntheticRoute, demoFreightPerMt, haversineKm, LatLng } from '../lib/geo';
import { addEvent, assertEarlierStopsResolved, deliveredSoFar, listStops, recomputeTotals } from './tripStops';
import { can, LOADING_LOCATION_TYPES } from '@gasman/shared';
import { postHooks } from './hooks';
import { setting } from './settings';
import { tripEconomics } from './expenses';
import { config } from '../config';
import { audit } from './audit';
import { AUDIENCE, notify } from './notify';
import type { AuthUser } from '../middleware/auth';

export { addEvent };

export const fmtDate = (d: string | Date) =>
  new Date(typeof d === 'string' ? d.slice(0, 10) + 'T00:00:00Z' : d).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });

export const TRIP_LIST_SELECT = `
  t.id, t.code, t.status, t.priority, t.lpg_source, t.planned_load_mt, t.loaded_mt, t.delivered_mt,
  t.scheduled_departure, t.planned_arrival, t.departed_at, t.arrived_at, t.delivered_at, t.completed_at, t.delay_minutes,
  t.progress_pct, t.eta_at, t.cur_speed_kmh, t.last_position_at, t.cur_lat, t.cur_lng,
  t.vehicle_id, v.code AS vehicle_code, v.registration_no, t.driver_id, d.full_name AS driver_name,
  t.origin_location_id, o.name AS origin_name, o.code AS origin_code,
  t.destination_location_id, dl.name AS destination_name, dl.city AS destination_city, dl.region AS destination_region,
  t.distributor_id, di.name AS distributor_name, t.stop_count,
  (SELECT string_agg(sl.name, ' › ' ORDER BY ss.seq) FROM trip_stops ss JOIN locations sl ON sl.id = ss.location_id WHERE ss.trip_id = t.id AND t.stop_count > 1) AS stops_label,
  (SELECT count(*)::int FROM trip_stops ss WHERE ss.trip_id = t.id AND ss.status IN ('DELIVERED','SKIPPED')) AS stops_done`;
export const TRIP_LIST_FROM = `
  FROM trips t
  JOIN locations o  ON o.id = t.origin_location_id
  JOIN locations dl ON dl.id = t.destination_location_id
  LEFT JOIN vehicles v ON v.id = t.vehicle_id
  LEFT JOIN drivers d  ON d.id = t.driver_id
  LEFT JOIN distributors di ON di.id = t.distributor_id`;

// ---------- Routes ----------

export async function getOrCreateRoute(originId: number, destId: number, tx?: any) {
  const existing = await q1<any>("SELECT * FROM routes WHERE origin_location_id = :o AND destination_location_id = :d AND kind = 'DIRECT'", { o: originId, d: destId }, tx);
  if (existing) return existing;
  const o = await q1<any>('SELECT code, name, lat, lng FROM locations WHERE id = :id', { id: originId }, tx);
  const d = await q1<any>('SELECT code, name, lat, lng FROM locations WHERE id = :id', { id: destId }, tx);
  if (!o || !d) throw notFound('Origin or destination');
  const r = buildSyntheticRoute([o.lat, o.lng], [d.lat, d.lng], originId * 31 + destId);
  return q1<any>(
    `INSERT INTO routes (code, name, origin_location_id, destination_location_id, distance_km, est_duration_min, path, checkpoints, freight_per_mt)
     VALUES (:code, :name, :o, :d, :km, :min, :path, :cps, :fr)
     ON CONFLICT (origin_location_id, destination_location_id) WHERE kind = 'DIRECT' DO UPDATE SET code = routes.code
     RETURNING *`,
    { code: `RT-${o.code}-${d.code}`.length <= 40 ? `RT-${o.code}-${d.code}` : `RT-${originId}-${destId}`, name: `${o.name} – ${d.name}`.slice(0, 150), o: originId, d: destId, km: r.distanceKm, min: r.estDurationMin, path: JSON.stringify(r.path), cps: JSON.stringify(r.checkpoints), fr: demoFreightPerMt(r.distanceKm) },
    tx,
  ).then((rows) => rows ?? q1<any>("SELECT * FROM routes WHERE origin_location_id = :o AND destination_location_id = :d AND kind = 'DIRECT'", { o: originId, d: destId }, tx));
}

// ---------- Multi-drop planning ----------

export interface StopInput { locationId?: number; distributorId?: number; plannedMt: number; freightPerMt?: number; billToId?: number }
export const MAX_STOPS = 8;

const arcKm = (path: LatLng[]) => { let t = 0; for (let i = 1; i < path.length; i++) t += haversineKm(path[i - 1], path[i]); return t; };

/** Composite route origin -> s1 -> s2 ... built from the direct legs. Cached by the location chain. */
async function getOrCreateMultiRoute(originId: number, locIds: number[], tx: any) {
  const chain = [originId, ...locIds];
  const legs: any[] = [];
  for (let i = 0; i < chain.length - 1; i++) legs.push(await getOrCreateRoute(chain[i], chain[i + 1], tx));
  const dwell = Number(await setting<number>('trip.stopDwellMin'));
  const legArc = legs.map((l) => arcKm(l.path as LatLng[]));
  const totalArc = legArc.reduce((a, b) => a + b, 0) || 1;
  const path: LatLng[] = []; const checkpoints: { name: string; at: number }[] = []; const fracs: number[] = []; const driveMin: number[] = [];
  let cum = 0; let cumMin = 0;
  legs.forEach((l, i) => {
    const lp = l.path as LatLng[];
    path.push(...(i === 0 ? lp : lp.slice(1)));
    for (const cp of (l.checkpoints ?? []) as { name: string; at: number }[]) if (!checkpoints.some((c) => c.name === cp.name)) checkpoints.push({ name: cp.name, at: Math.round(((cum + cp.at * legArc[i]) / totalArc) * 1000) / 1000 });
    cum += legArc[i]; cumMin += Number(l.est_duration_min);
    fracs.push(Math.min(1, cum / totalArc)); driveMin.push(cumMin);
  });
  fracs[fracs.length - 1] = 1;
  const code = `RT-M-${crypto.createHash('sha1').update(chain.join('-')).digest('hex').slice(0, 14)}`;
  const names = await q<any>('SELECT id, name FROM locations WHERE id IN (:ids)', { ids: chain }, tx);
  const nm = new Map(names.map((n: any) => [n.id, n.name]));
  const distance = Math.round(legs.reduce((a, l) => a + Number(l.distance_km), 0) * 10) / 10;
  const total = cumMin + dwell * (locIds.length - 1);
  const route = (await q1<any>(
    `INSERT INTO routes (code, name, kind, origin_location_id, destination_location_id, distance_km, est_duration_min, path, checkpoints, freight_per_mt)
     VALUES (:code, :name, 'MULTI', :o, :d, :km, :min, :path, :cps, 0) ON CONFLICT (code) DO NOTHING RETURNING *`,
    { code, name: chain.map((id) => nm.get(id)).join(' › ').slice(0, 150), o: originId, d: locIds[locIds.length - 1], km: distance, min: total, path: JSON.stringify(path), cps: JSON.stringify(checkpoints) }, tx,
  )) ?? (await q1<any>('SELECT * FROM routes WHERE code = :c', { c: code }, tx));
  return { route, fracs, driveMin, dwell };
}

export interface PlannedStops {
  route: any; destId: number; distributorId: number | null; load: number; rate: number; billToId: number | null; durationMin: number;
  rows: { seq: number; locationId: number; distributorId: number | null; plannedMt: number; routeFrac: number; etaMin: number; freightPerMt: number; billToId: number | null }[];
}

/** Validates and resolves a stop list into route, ETAs, rates and trip-level mirrors. Pure planning: writes nothing. */
export async function planStops(tx: any, originId: number, stops: StopInput[], opts: { requireActiveDistributor: boolean }): Promise<PlannedStops> {
  if (!stops.length) throw badRequest('Choose a destination or a distributor.', { fields: { destinationLocationId: 'Required' } });
  if (stops.length > MAX_STOPS) throw badRequest(`A trip can have at most ${MAX_STOPS} delivery stops.`);
  const resolved: { locationId: number; distributorId: number | null; plannedMt: number; freightPerMt?: number; billToId: number | null }[] = [];
  for (const [i, st] of stops.entries()) {
    let locationId = st.locationId; let distributorId: number | null = st.distributorId ?? null;
    if (distributorId) {
      const dist = await q1<any>('SELECT id, location_id, status, name FROM distributors WHERE id = :id', { id: distributorId }, tx);
      if (!dist) throw notFound('Distributor');
      if (opts.requireActiveDistributor && dist.status !== 'ACTIVE') throw unprocessable(`Distributor ${dist.name} is not active, so new trips cannot be created for it.`);
      locationId = dist.location_id;
    }
    if (!locationId) throw badRequest(`Stop ${i + 1}: choose a destination or a distributor.`, { fields: { destinationLocationId: 'Required' } });
    if (!(st.plannedMt > 0)) throw badRequest(`Stop ${i + 1}: enter the quantity to deliver.`);
    resolved.push({ locationId, distributorId, plannedMt: st.plannedMt, freightPerMt: st.freightPerMt, billToId: st.billToId ?? distributorId });
  }
  const ids = resolved.map((r) => r.locationId);
  if (ids.includes(originId)) throw badRequest('Origin and destination must be different.', { fields: { destinationLocationId: 'Must differ from origin' } });
  if (new Set(ids).size !== ids.length) throw badRequest('The same location cannot appear twice on one trip.');
  const load = Math.round(resolved.reduce((a, r) => a + r.plannedMt, 0) * 100) / 100;
  if (load > 60) throw badRequest('Total planned load cannot exceed 60 MT.', { fields: { plannedLoadMt: 'Too large' } });

  let route: any; let fracs = [1]; let etaMin: number[]; let durationMin: number;
  if (resolved.length === 1) {
    route = await getOrCreateRoute(originId, ids[0], tx);
    etaMin = [route.est_duration_min]; durationMin = route.est_duration_min;
  } else {
    const m = await getOrCreateMultiRoute(originId, ids, tx);
    route = m.route; fracs = m.fracs; durationMin = route.est_duration_min;
    etaMin = m.driveMin.map((d, i) => d + m.dwell * i);
  }
  const rows: PlannedStops['rows'] = [];
  for (const [i, r] of resolved.entries()) {
    const rate = r.freightPerMt ?? (resolved.length === 1 ? Number(route.freight_per_mt ?? 0) : Number((await getOrCreateRoute(originId, r.locationId, tx)).freight_per_mt ?? 0));
    rows.push({ seq: i + 1, locationId: r.locationId, distributorId: r.distributorId, plannedMt: r.plannedMt, routeFrac: fracs[i], etaMin: etaMin[i], freightPerMt: rate, billToId: r.billToId });
  }
  const last = rows[rows.length - 1];
  const rate = Math.round((rows.reduce((a, r) => a + r.plannedMt * r.freightPerMt, 0) / load) * 100) / 100;
  return { route, destId: last.locationId, distributorId: last.distributorId, load, rate, billToId: last.billToId ?? rows.find((r) => r.billToId)?.billToId ?? null, durationMin, rows };
}

async function writeStops(tx: any, tripId: number, dep: Date, plan: PlannedStops) {
  await exec('DELETE FROM trip_stops WHERE trip_id = :id', { id: tripId }, tx);
  for (const r of plan.rows)
    await exec(`INSERT INTO trip_stops (trip_id, seq, location_id, distributor_id, planned_mt, route_frac, eta_at, freight_per_mt, bill_to_id) VALUES (:t, :seq, :loc, :dist, :mt, :frac, :eta, :fr, :bill)`,
      { t: tripId, seq: r.seq, loc: r.locationId, dist: r.distributorId, mt: r.plannedMt, frac: r.routeFrac, eta: new Date(dep.getTime() + r.etaMin * 60_000).toISOString(), fr: r.freightPerMt, bill: r.billToId }, tx);
}

// ---------- Assignment validation (single source of truth, used by validation, candidates & dispatch) ----------

export interface Violation {
  resource: 'vehicle' | 'driver';
  code: string;
  message: string;
}

interface TripWindow {
  id: number | null;
  scheduled_departure: Date;
  planned_arrival: Date;
  planned_load_mt: number;
}

const windowOf = (t: TripWindow) => {
  const start = new Date(t.scheduled_departure);
  const dur = new Date(t.planned_arrival).getTime() - start.getTime();
  // Occupancy = outbound + return leg + 2h turnaround (demo assumption).
  return { start, end: new Date(start.getTime() + 2 * dur + 2 * 3600_000) };
};

async function docFacts(col: 'vehicle_id' | 'driver_id', ids: number[], tx?: any) {
  if (!ids.length) return new Map<number, Map<string, string>>();
  const rows = await q<any>(
    `SELECT ${col} AS rid, doc_type, max(expires_on) AS expires_on FROM documents WHERE ${col} IN (:ids) GROUP BY ${col}, doc_type`,
    { ids }, tx,
  );
  const m = new Map<number, Map<string, string>>();
  for (const r of rows) {
    if (!m.has(r.rid)) m.set(r.rid, new Map());
    m.get(r.rid)!.set(r.doc_type, r.expires_on);
  }
  return m;
}

async function conflictFacts(col: 'vehicle_id' | 'driver_id', ids: number[], trip: TripWindow, tx?: any) {
  const m = new Map<number, { id: number; code: string; status: string }>();
  if (!ids.length) return m;
  const { start, end } = windowOf(trip);
  const rows = await q<any>(
    `SELECT t.id, t.code, t.status, t.${col} AS rid FROM trips t
      WHERE t.${col} IN (:ids) AND (:tid::int IS NULL OR t.id <> :tid::int)
        AND t.status IN ('ASSIGNED','DISPATCHED','IN_TRANSIT','DELAYED','ON_HOLD','ARRIVED','DELIVERED','RETURNING')
        AND t.scheduled_departure < :wend
        AND (t.scheduled_departure + 2 * (t.planned_arrival - t.scheduled_departure) + interval '2 hours') > :wstart
      ORDER BY t.scheduled_departure`,
    { ids, tid: trip.id, wstart: start.toISOString(), wend: end.toISOString() }, tx,
  );
  for (const r of rows) if (!m.has(r.rid)) m.set(r.rid, r);
  return m;
}

function docViolations(resource: 'vehicle' | 'driver', label: string, required: readonly string[], docs: Map<string, string> | undefined, tripEnd: Date): Violation[] {
  const out: Violation[] = [];
  const endDay = tripEnd.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  for (const type of required) {
    const exp = docs?.get(type);
    const name = DOC_TYPE_LABELS[type] ?? type;
    if (!exp) out.push({ resource, code: 'DOC_MISSING', message: `${label} has no ${name} on record.` });
    else if (exp < today) out.push({ resource, code: 'DOC_EXPIRED', message: `${label}: ${name} expired on ${fmtDate(exp)}.` });
    else if (exp < endDay) out.push({ resource, code: 'DOC_EXPIRES_DURING_TRIP', message: `${label}: ${name} expires on ${fmtDate(exp)}, before this trip ends.` });
  }
  return out;
}

export function evaluateVehicle(trip: TripWindow, v: any, docs: Map<string, string> | undefined, conflictTrip?: { code: string }): Violation[] {
  const label = `Vehicle ${v.code}`;
  const out: Violation[] = [];
  if (v.archived_at) out.push({ resource: 'vehicle', code: 'ARCHIVED', message: `${label} is archived.` });
  if (v.status === 'INACTIVE') out.push({ resource: 'vehicle', code: 'INACTIVE', message: `${label} is inactive.` });
  if (v.status === 'MAINTENANCE') out.push({ resource: 'vehicle', code: 'IN_MAINTENANCE', message: `${label} is currently in maintenance.` });
  if (conflictTrip) out.push({ resource: 'vehicle', code: 'DOUBLE_BOOKED', message: `${label} is already assigned to Trip ${conflictTrip.code}.` });
  if (Number(trip.planned_load_mt) > Number(v.capacity_mt))
    out.push({ resource: 'vehicle', code: 'CAPACITY', message: `${label} capacity (${v.capacity_mt} MT) is below the planned load (${trip.planned_load_mt} MT).` });
  out.push(...docViolations('vehicle', label, REQUIRED_VEHICLE_DOCS, docs, windowOf(trip).end));
  return out;
}

export function evaluateDriver(trip: TripWindow, d: any, docs: Map<string, string> | undefined, conflictTrip?: { code: string }): Violation[] {
  const label = `Driver ${d.full_name}`;
  const out: Violation[] = [];
  if (d.archived_at) out.push({ resource: 'driver', code: 'ARCHIVED', message: `${label} is archived.` });
  if (d.status === 'SUSPENDED') out.push({ resource: 'driver', code: 'SUSPENDED', message: `${label} is suspended.` });
  if (d.status === 'ON_LEAVE') out.push({ resource: 'driver', code: 'ON_LEAVE', message: `${label} is on leave.` });
  if (conflictTrip) out.push({ resource: 'driver', code: 'DOUBLE_BOOKED', message: `${label} is already assigned to Trip ${conflictTrip.code}.` });
  out.push(...docViolations('driver', label, REQUIRED_DRIVER_DOCS, docs, windowOf(trip).end));
  return out;
}

export async function validateAssignment(trip: TripWindow, vehicleId: number, driverId: number, tx?: any): Promise<Violation[]> {
  // Sequential on purpose: a transaction owns a single connection and must not run concurrent queries.
  const v = await q1<any>('SELECT * FROM vehicles WHERE id = :id', { id: vehicleId }, tx);
  const d = await q1<any>('SELECT * FROM drivers WHERE id = :id', { id: driverId }, tx);
  if (!v) throw notFound('Vehicle');
  if (!d) throw notFound('Driver');
  const vDocs = await docFacts('vehicle_id', [vehicleId], tx);
  const dDocs = await docFacts('driver_id', [driverId], tx);
  const vConf = await conflictFacts('vehicle_id', [vehicleId], trip, tx);
  const dConf = await conflictFacts('driver_id', [driverId], trip, tx);
  return [
    ...evaluateVehicle(trip, v, vDocs.get(vehicleId), vConf.get(vehicleId)),
    ...evaluateDriver(trip, d, dDocs.get(driverId), dConf.get(driverId)),
  ];
}

/** Ranked eligible vehicles & drivers for a trip (dispatcher "recommended assignment" panel). */
export async function candidates(tripId: number) {
  const trip = await q1<any>('SELECT * FROM trips WHERE id = :id', { id: tripId });
  if (!trip) throw notFound('Trip');
  const [vehicles, drivers] = await Promise.all([
    q<any>(`SELECT v.*, l.name AS last_location_name, dd.full_name AS default_driver_name FROM vehicles v
            LEFT JOIN locations l ON l.id = v.last_location_id LEFT JOIN drivers dd ON dd.id = v.default_driver_id
            WHERE v.archived_at IS NULL AND v.status <> 'INACTIVE' ORDER BY v.code`),
    q<any>(`SELECT d.*, (SELECT count(*)::int FROM trips t WHERE t.driver_id = d.id AND t.status = 'COMPLETED') AS completed_trips
            FROM drivers d WHERE d.archived_at IS NULL ORDER BY d.full_name`),
  ]);
  const vIds = vehicles.map((v) => v.id);
  const dIds = drivers.map((d) => d.id);
  const [vDocs, dDocs, vConf, dConf] = await Promise.all([
    docFacts('vehicle_id', vIds), docFacts('driver_id', dIds), conflictFacts('vehicle_id', vIds, trip), conflictFacts('driver_id', dIds, trip),
  ]);
  const vehicleRows = vehicles.map((v) => {
    const violations = evaluateVehicle(trip, v, vDocs.get(v.id), vConf.get(v.id));
    let score = 0;
    const why: string[] = [];
    if (v.home_plant_id === trip.origin_location_id) { score += 30; why.push('Home plant matches origin'); }
    if (v.status === 'AVAILABLE') { score += 20; why.push('Available now'); }
    const slack = Number(v.capacity_mt) - Number(trip.planned_load_mt);
    if (slack >= 0) { score += Math.max(0, 20 - slack * 2); why.push(`Capacity ${v.capacity_mt} MT fits ${trip.planned_load_mt} MT load`); }
    if (v.fleet_type === 'OWNED') score += 5;
    return {
      id: v.id, code: v.code, registrationNo: v.registration_no, fleetType: v.fleet_type, capacityMt: v.capacity_mt, status: v.status,
      lastLocation: v.last_location_name, defaultDriverId: v.default_driver_id, defaultDriverName: v.default_driver_name,
      eligible: violations.length === 0, violations: violations.map((x) => x.message), score: violations.length ? 0 : score, why,
    };
  });
  const driverRows = drivers.map((d) => {
    const violations = evaluateDriver(trip, d, dDocs.get(d.id), dConf.get(d.id));
    let score = 0;
    const why: string[] = [];
    if (d.status === 'AVAILABLE') { score += 20; why.push('Available now'); }
    if (d.home_plant_id === trip.origin_location_id) { score += 20; why.push('Based at origin plant'); }
    score += Math.min(15, d.experience_years); if (d.experience_years >= 8) why.push(`${d.experience_years} yrs experience`);
    score += Math.round((d.safety_score - 80) / 2);
    return {
      id: d.id, employeeId: d.employee_id, name: d.full_name, status: d.status, experienceYears: d.experience_years, safetyScore: d.safety_score,
      eligible: violations.length === 0, violations: violations.map((x) => x.message), score: violations.length ? 0 : score, why,
    };
  });
  vehicleRows.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
  driverRows.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
  return { vehicles: vehicleRows, drivers: driverRows };
}

// ---------- Trip creation / update ----------

export interface CreateTripInput {
  originLocationId: number;
  destinationLocationId?: number;
  distributorId?: number;
  /** Multi-drop: ordered delivery stops (origin -> stops[0] -> stops[1] ...). When present it replaces destinationLocationId / distributorId / plannedLoadMt. */
  stops?: StopInput[];
  lpgSource: 'LOCAL' | 'IMPORTED';
  plannedLoadMt?: number;
  scheduledDeparture: string;
  plannedArrival?: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  notes?: string;
  vehicleId?: number;
  driverId?: number;
  submit?: boolean;
  freightPerMt?: number;
  billToId?: number;
}

/** Single-destination fields (legacy API) become a one-stop list; an explicit `stops` array wins. */
function stopsFromInput(i: Partial<CreateTripInput>, fallbackLoad?: number): StopInput[] {
  if (i.stops?.length) return i.stops;
  const load = i.plannedLoadMt ?? fallbackLoad;
  if (!load) throw badRequest('Enter the planned load.', { fields: { plannedLoadMt: 'Required' } });
  return [{ locationId: i.destinationLocationId, distributorId: i.distributorId, plannedMt: load, freightPerMt: i.freightPerMt, billToId: i.billToId }];
}

export async function createTrip(user: AuthUser, req: Request, input: CreateTripInput) {
  return sequelize.transaction(async (tx) => {
    const origin = await q1<any>("SELECT id, name, type FROM locations WHERE id = :id AND status = 'ACTIVE'", { id: input.originLocationId }, tx);
    if (!origin) throw notFound('Origin location');
    if (!(LOADING_LOCATION_TYPES as readonly string[]).includes(origin.type)) throw badRequest('Trips must start from a plant, terminal, depot or gas field (uplift point).', { fields: { originLocationId: 'Not a loading point' } });
    const tripType = origin.type === 'FIELD' ? 'UPLIFTING' : 'DELIVERY';
    const stops = stopsFromInput(input);
    if (tripType === 'UPLIFTING' && stops.length > 1) throw badRequest('Uplifting trips have a single destination (the receiving plant).');
    const plan = await planStops(tx, input.originLocationId, stops, { requireActiveDistributor: true });
    const dep = new Date(input.scheduledDeparture);
    const arr = input.plannedArrival ? new Date(input.plannedArrival) : new Date(dep.getTime() + plan.durationMin * 60_000);
    if (arr <= dep) throw badRequest('Planned arrival must be after departure.', { fields: { plannedArrival: 'Must be after departure' } });

    const [{ n }] = await q<any>("SELECT nextval('trip_code_seq')::int AS n", {}, tx);
    const code = `TRP-${dep.getUTCFullYear()}-${String(n).padStart(4, '0')}`;
    const row = await q1<any>(
      `INSERT INTO trips (code, status, priority, origin_location_id, destination_location_id, distributor_id, route_id, lpg_source,
          planned_load_mt, scheduled_departure, planned_arrival, notes, created_by, cur_lat, cur_lng, trip_type, freight_per_mt, bill_to_id, public_token, stop_count)
       SELECT :code, 'DRAFT', :prio, :o, :d, :dist, :rid, :src, :load, :dep, :arr, :notes, :uid, l.lat, l.lng, :tt, :fr, :bill, :tok, :sc FROM locations l WHERE l.id = :o
       RETURNING *`,
      { code, prio: input.priority, o: input.originLocationId, d: plan.destId, dist: plan.distributorId, rid: plan.route.id, src: input.lpgSource, load: plan.load, dep: dep.toISOString(), arr: arr.toISOString(), notes: input.notes ?? null, uid: user.id,
        tt: tripType, fr: plan.rate, bill: plan.billToId, tok: crypto.randomBytes(18).toString('base64url'), sc: plan.rows.length },
      tx,
    );
    await writeStops(tx, row.id, dep, plan);
    await addEvent(tx, row.id, { type: 'STATUS_CHANGE', toStatus: 'DRAFT', message: plan.rows.length > 1 ? `Trip ${code} created with ${plan.rows.length} delivery stops` : `Trip ${code} created`, actor: user.id });
    await audit(req, { action: 'CREATE', entityType: 'TRIP', entityId: row.id, entityLabel: code, meta: plan.rows.length > 1 ? { stops: plan.rows.length } : undefined, tx });
    if (input.submit || input.vehicleId) await doTransition(tx, user, req, row, 'PLANNED', {});
    if (input.vehicleId && input.driverId) await doAssign(tx, user, req, row.id, input.vehicleId, input.driverId);
    else if (input.vehicleId || input.driverId) throw badRequest('Select both a vehicle and a driver, or neither.');
    return row.id as number;
  });
}

export async function updateTrip(user: AuthUser, req: Request, id: number, patch: Partial<CreateTripInput>) {
  return sequelize.transaction(async (tx) => {
    const t = await lockTrip(tx, id);
    if (!['DRAFT', 'PLANNED', 'ASSIGNED'].includes(t.status))
      throw conflict(`Trip ${t.code} is ${TRIP_STATUS_LABELS[t.status as TripStatus].toLowerCase()} and can no longer be edited.`);
    const routeChange = !!(patch.stops || patch.destinationLocationId || patch.distributorId || patch.originLocationId);
    if (routeChange && t.status === 'ASSIGNED') throw conflict('Unassign the vehicle and driver before changing the route.');
    const sets: string[] = [];
    const r: Record<string, unknown> = { id };
    // On a multi-drop trip the totals / rates are derived from the stops, so the trip-level fields are not patched directly.
    const multi = t.stop_count > 1 && !patch.stops;
    const map: [keyof CreateTripInput, string, (v: any) => unknown][] = [
      ['priority', 'priority', (v) => v], ['notes', 'notes', (v) => v], ['lpgSource', 'lpg_source', (v) => v],
      ['scheduledDeparture', 'scheduled_departure', (v) => new Date(v).toISOString()], ['plannedArrival', 'planned_arrival', (v) => new Date(v).toISOString()],
      ...(multi ? [] : [['plannedLoadMt', 'planned_load_mt', (v: any) => v], ['freightPerMt', 'freight_per_mt', (v: any) => v], ['billToId', 'bill_to_id', (v: any) => v]] as [keyof CreateTripInput, string, (v: any) => unknown][]),
    ];
    for (const [k, col, f] of map) if (patch[k] !== undefined) { sets.push(`${col} = :${col}`); r[col] = f(patch[k]); }
    if (multi && (patch.plannedLoadMt !== undefined || patch.freightPerMt !== undefined)) throw badRequest('This trip has several stops — edit the quantity and rate on each stop instead.');
    if (sets.length) { sets.push('updated_at = now()'); await exec(`UPDATE trips SET ${sets.join(', ')} WHERE id = :id`, r, tx); }
    let updated = await q1<any>('SELECT * FROM trips WHERE id = :id', { id }, tx);

    if (routeChange || patch.plannedLoadMt !== undefined || patch.freightPerMt !== undefined || patch.billToId !== undefined || patch.scheduledDeparture) {
      const origin = patch.originLocationId ?? t.origin_location_id;
      let stops: StopInput[];
      if (patch.stops || patch.destinationLocationId || patch.distributorId) {
        stops = stopsFromInput({ ...patch, plannedLoadMt: patch.plannedLoadMt ?? Number(updated.planned_load_mt), freightPerMt: patch.freightPerMt ?? Number(updated.freight_per_mt), billToId: patch.billToId ?? updated.bill_to_id ?? undefined });
      } else {
        const cur = await listStops(id, tx);
        stops = cur.map((s: any) => ({ locationId: s.location_id, distributorId: s.distributor_id ?? undefined, plannedMt: Number(s.planned_mt), freightPerMt: Number(s.freight_per_mt), billToId: s.bill_to_id ?? undefined }));
        if (stops.length === 1) {
          if (patch.plannedLoadMt !== undefined) stops[0].plannedMt = patch.plannedLoadMt;
          if (patch.freightPerMt !== undefined) stops[0].freightPerMt = patch.freightPerMt;
          if (patch.billToId !== undefined) stops[0].billToId = patch.billToId;
        }
      }
      if (patch.originLocationId) {
        const o = await q1<any>("SELECT type FROM locations WHERE id = :id AND status = 'ACTIVE'", { id: origin }, tx);
        if (!o) throw notFound('Origin location');
        if (!(LOADING_LOCATION_TYPES as readonly string[]).includes(o.type)) throw badRequest('Trips must start from a plant, terminal, depot or gas field (uplift point).');
      }
      if (t.trip_type === 'UPLIFTING' && stops.length > 1) throw badRequest('Uplifting trips have a single destination (the receiving plant).');
      const plan = await planStops(tx, origin, stops, { requireActiveDistributor: !!(patch.stops || patch.distributorId) });
      const dep = new Date(updated.scheduled_departure);
      const arr = patch.plannedArrival ? new Date(patch.plannedArrival) : routeChange || patch.scheduledDeparture ? new Date(dep.getTime() + plan.durationMin * 60_000) : new Date(updated.planned_arrival);
      await writeStops(tx, id, dep, plan);
      updated = await q1<any>(
        `UPDATE trips SET origin_location_id = :o, destination_location_id = :d, distributor_id = :dist, route_id = :rid, planned_load_mt = :load, freight_per_mt = :fr, bill_to_id = :bill, planned_arrival = :arr, stop_count = :sc, updated_at = now() WHERE id = :id RETURNING *`,
        { id, o: origin, d: plan.destId, dist: plan.distributorId, rid: plan.route.id, load: plan.load, fr: plan.rate, bill: plan.billToId, arr: arr.toISOString(), sc: plan.rows.length }, tx);
    }
    if (new Date(updated.planned_arrival) <= new Date(updated.scheduled_departure)) throw badRequest('Planned arrival must be after departure.');
    if (updated.vehicle_id && updated.driver_id) {
      const v = await validateAssignment(updated, updated.vehicle_id, updated.driver_id, tx);
      if (v.length) throw unprocessable(v[0].message, { violations: v });
    }
    await addEvent(tx, id, { type: 'NOTE', message: 'Trip details updated', actor: user.id });
    await audit(req, { action: 'UPDATE', entityType: 'TRIP', entityId: id, entityLabel: t.code, tx });
    return id;
  });
}

// ---------- Assignment ----------

async function lockTrip(tx: any, id: number) {
  const t = await q1<any>('SELECT * FROM trips WHERE id = :id FOR UPDATE', { id }, tx);
  if (!t) throw notFound('Trip');
  return t;
}

async function doAssign(tx: any, user: AuthUser, req: Request, tripId: number, vehicleId: number, driverId: number) {
  const t = await lockTrip(tx, tripId);
  if (!['DRAFT', 'PLANNED', 'ASSIGNED'].includes(t.status))
    throw conflict(`Trip ${t.code} is ${TRIP_STATUS_LABELS[t.status as TripStatus].toLowerCase()}; vehicle and driver can only be assigned before dispatch.`);
  // Fixed lock order (vehicle, then driver) prevents deadlocks between concurrent dispatchers.
  await q('SELECT id FROM vehicles WHERE id = :id FOR UPDATE', { id: vehicleId }, tx);
  await q('SELECT id FROM drivers WHERE id = :id FOR UPDATE', { id: driverId }, tx);
  const violations = await validateAssignment(t, vehicleId, driverId, tx);
  if (violations.length) throw unprocessable(violations[0].message, { violations });
  const v = await q1<any>('SELECT code, default_driver_id FROM vehicles WHERE id = :id', { id: vehicleId }, tx);
  const d = await q1<any>('SELECT full_name FROM drivers WHERE id = :id', { id: driverId }, tx);
  await exec(`UPDATE trips SET vehicle_id = :v, driver_id = :d, status = 'ASSIGNED', status_before_hold = NULL, updated_at = now() WHERE id = :id`, { v: vehicleId, d: driverId, id: tripId }, tx);
  await addEvent(tx, tripId, {
    type: 'ASSIGNMENT', fromStatus: t.status, toStatus: 'ASSIGNED', actor: user.id,
    message: `Assigned vehicle ${v.code} and driver ${d.full_name}`,
  });
  await audit(req, { action: 'ASSIGN', entityType: 'TRIP', entityId: tripId, entityLabel: t.code, meta: { vehicleId, driverId }, tx });
}

export async function assignTrip(user: AuthUser, req: Request, tripId: number, vehicleId: number, driverId: number) {
  await sequelize.transaction((tx) => doAssign(tx, user, req, tripId, vehicleId, driverId));
}

// ---------- Status transitions ----------

export interface TransitionPayload {
  reason?: string;
  note?: string;
  loadedMt?: number;
  deliveredMt?: number;
  receivedBy?: string;
  deliveryNoteNo?: string;
  podNotes?: string;
  lat?: number;
  lng?: number;
  clientEventId?: string;
  odometerKm?: number;
  upliftVoucherNo?: string;
}

/** Actor = null means the system (simulator / scheduled job). */
export async function transitionTrip(user: AuthUser | null, req: Request | undefined, id: number, to: TripStatus, payload: TransitionPayload = {}) {
  return sequelize.transaction(async (tx) => {
    const t = await lockTrip(tx, id);
    if (payload.clientEventId) {
      const seen = await q1<any>('SELECT 1 AS x FROM trip_events WHERE trip_id = :id AND client_event_id = :c', { id, c: payload.clientEventId }, tx);
      if (seen) return t.id as number; // idempotent replay from an offline-first client
    }
    await doTransition(tx, user, req, t, to, payload);
    return id;
  });
}

const OPS_ROLES: Role[] = ['SUPER_ADMIN', 'TRANSPORT_MANAGER', 'DISPATCHER'];

async function doTransition(tx: any, user: AuthUser | null, req: Request | undefined, t: any, to: TripStatus, p: TransitionPayload) {
  const from = t.status as TripStatus;
  const label = (s: string) => TRIP_STATUS_LABELS[s as TripStatus] ?? s;
  if (user && !roleCanTarget(to, user.role) && !(from === 'ON_HOLD' && to === t.status_before_hold && OPS_ROLES.includes(user.role)))
    throw forbidden(`Your role is not allowed to move a trip to ${label(to)}.`);
  let tr: Transition | undefined = findTransition(from, to);
  const isResume = from === 'ON_HOLD' && to === t.status_before_hold;
  if (isResume) tr = { from, to, roles: OPS_ROLES, label: 'Resume' };
  if (!tr) throw conflict(`Trip ${t.code} cannot move from ${label(from)} to ${label(to)}.`);
  if (user && !tr.roles.includes(user.role)) throw forbidden(`Your role is not allowed to ${tr.label.toLowerCase()}.`);
  if (user?.role === 'DRIVER' && t.driver_id !== user.driverId) throw forbidden('You can only update trips assigned to you.');
  if ((to === 'ON_HOLD' || to === 'CANCELLED') && !p.reason?.trim()) throw badRequest(`Please give a reason to ${to === 'CANCELLED' ? 'cancel' : 'hold'} this trip.`, { fields: { reason: 'Required' } });
  if (to === 'ASSIGNED') throw badRequest('Use the assignment action to assign a vehicle and driver.');
  if (to === 'PLANNED' && from === 'DRAFT') {
    if (!t.origin_location_id || !t.destination_location_id) throw unprocessable('Origin and destination are required.');
  }

  const sets: string[] = ['status = :to', 'updated_at = now()'];
  const r: Record<string, unknown> = { id: t.id, to };
  let msg = `${tr.label}: ${label(from)} → ${label(to)}`;

  if (to === 'ON_HOLD') { sets.push('status_before_hold = :sbh', 'hold_reason = :reason'); r.sbh = from; r.reason = p.reason; msg = `Put on hold: ${p.reason}`; }
  if (isResume) { sets.push('status_before_hold = NULL', 'hold_reason = NULL'); msg = `Resumed to ${label(to)}`; }
  if (to === 'CANCELLED') { sets.push('cancel_reason = :reason', 'cancelled_at = now()'); r.reason = p.reason; msg = `Cancelled: ${p.reason}`; }
  if (to === 'PLANNED' && from === 'ASSIGNED') { sets.push('vehicle_id = NULL', 'driver_id = NULL'); msg = 'Vehicle and driver unassigned'; }

  let vehicle: any = null;
  let driver: any = null;
  if (t.vehicle_id) vehicle = await q1<any>('SELECT * FROM vehicles WHERE id = :id FOR UPDATE', { id: t.vehicle_id }, tx);
  if (t.driver_id) driver = await q1<any>('SELECT * FROM drivers WHERE id = :id FOR UPDATE', { id: t.driver_id }, tx);

  if (to === 'DISPATCHED') {
    if (!vehicle || !driver) throw unprocessable('Assign a vehicle and a driver before dispatching.');
    const violations = await validateAssignment(t, vehicle.id, driver.id, tx);
    if (violations.length) throw unprocessable(violations[0].message, { violations });
    if (vehicle.status !== 'AVAILABLE') {
      const other = await q1<any>(`SELECT code FROM trips WHERE vehicle_id = :v AND id <> :id AND status IN ('DISPATCHED','IN_TRANSIT','DELAYED','ON_HOLD','ARRIVED','DELIVERED','RETURNING') LIMIT 1`, { v: vehicle.id, id: t.id }, tx);
      throw unprocessable(other ? `Vehicle ${vehicle.code} is already on Trip ${other.code}.` : `Vehicle ${vehicle.code} is not available (${vehicle.status.toLowerCase().replace('_', ' ')}).`);
    }
    if (driver.status !== 'AVAILABLE') throw unprocessable(`Driver ${driver.full_name} is not available (${driver.status.toLowerCase().replace('_', ' ')}).`);
    msg = `Dispatched with ${vehicle.code} / ${driver.full_name}`;
  }
  if (to === 'IN_TRANSIT' && from === 'DISPATCHED') {
    if (await setting<boolean>('trip.requirePretripCheck')) {
      const ok = await q1<any>(`SELECT 1 AS x FROM safety_checks WHERE trip_id = :id AND kind = 'PRE_TRIP' AND result = 'PASS' LIMIT 1`, { id: t.id }, tx);
      if (!ok) throw unprocessable('A passed pre-trip safety check is required before the trip can start. Record it under Safety checks.', { code: 'PRETRIP_REQUIRED' });
    }
    const loaded = p.loadedMt ?? Number(t.planned_load_mt);
    if (vehicle && loaded > Number(vehicle.capacity_mt)) throw unprocessable(`Loaded quantity (${loaded} MT) exceeds vehicle capacity (${vehicle.capacity_mt} MT).`);
    sets.push('loaded_mt = :loaded', 'progress_pct = 0', 'delay_minutes = 0', 'odometer_start = :odo0', 'uplift_voucher_no = :uvn');
    r.loaded = loaded; r.odo0 = p.odometerKm ?? vehicle?.odometer_km ?? null; r.uvn = p.upliftVoucherNo?.trim() || null;
    if (p.odometerKm != null && vehicle && p.odometerKm < vehicle.odometer_km - 500) throw unprocessable(`Start odometer ${p.odometerKm} km is far below the vehicle's last reading (${vehicle.odometer_km} km). Please re-check.`);
    msg = `Departed with ${loaded} MT LPG`;
  }
  if (to === 'ARRIVED') {
    await assertEarlierStopsResolved(tx, t);
    const dest = await q1<any>('SELECT lat, lng, name FROM locations WHERE id = :id', { id: t.destination_location_id }, tx);
    const late = Math.max(0, Math.round((Date.now() - new Date(t.planned_arrival).getTime()) / 60_000));
    sets.push('progress_pct = 100', 'cur_lat = :lat', 'cur_lng = :lng', 'cur_speed_kmh = 0', 'eta_at = now()', 'delay_minutes = :late', 'last_position_at = now()');
    Object.assign(r, { lat: dest.lat, lng: dest.lng, late });
    msg = `Arrived at ${dest.name}${late > 15 ? ` (${late} min late)` : ''}`;
  }
  if (to === 'DELIVERED') {
    await assertEarlierStopsResolved(tx, t);
    const loaded = Number(t.loaded_mt ?? t.planned_load_mt);
    const earlier = t.stop_count > 1 ? await deliveredSoFar(tx, t.id) : 0;
    if (!p.deliveredMt || p.deliveredMt <= 0) throw badRequest('Enter the delivered quantity.', { fields: { deliveredMt: 'Required' } });
    if (p.deliveredMt > loaded - earlier + 0.5) throw unprocessable(earlier ? `Only ${(loaded - earlier).toFixed(2)} MT is left on board for the final stop (${earlier.toFixed(2)} MT already delivered at earlier stops).` : `Delivered quantity (${p.deliveredMt} MT) cannot exceed the loaded quantity (${loaded} MT).`);
    if (!p.receivedBy?.trim()) throw badRequest('Enter who received the delivery.', { fields: { receivedBy: 'Required' } });
    sets.push('delivered_mt = :dmt', 'received_by = :rb', 'delivery_note_no = :dn', 'pod_notes = :pn');
    Object.assign(r, { dmt: p.deliveredMt, rb: p.receivedBy, dn: p.deliveryNoteNo ?? null, pn: p.podNotes ?? null });
    msg = t.stop_count > 1 ? `Delivered ${p.deliveredMt} MT at final stop ${t.stop_count}, received by ${p.receivedBy}` : `Delivered ${p.deliveredMt} MT, received by ${p.receivedBy}`;
  }
  if (to === 'RETURNING') { sets.push('progress_pct = 0', 'cur_speed_kmh = 0'); msg = 'Vehicle started return to plant'; }
  if (to === 'COMPLETED') {
    const route0 = t.route_id ? await q1<any>('SELECT distance_km FROM routes WHERE id = :id', { id: t.route_id }, tx) : null;
    const start = t.odometer_start ?? vehicle?.odometer_km ?? 0;
    const end = p.odometerKm ?? (route0 ? Math.round(start + Number(route0.distance_km) * 2) : start);
    if (end < start) throw unprocessable(`End odometer (${end} km) cannot be lower than the start reading (${start} km).`, { fields: { odometerKm: 'Lower than start reading' } });
    sets.push('odometer_end = :odo1'); r.odo1 = end;
    msg = `Trip completed — ${end - start} km run (meter ${start} → ${end})`;
  }
  if (tr.stamp && !sets.some((s) => s.startsWith(tr!.stamp!))) sets.push(`${tr.stamp} = now()`);
  if (to === 'DISPATCHED' && from === 'ASSIGNED') {
    // vehicle leaves the yard from its origin
  }
  if (p.note) msg += ` — ${p.note}`;

  await exec(`UPDATE trips SET ${sets.join(', ')} WHERE id = :id`, r, tx);

  // The final stop mirrors the trip's own arrival / delivery steps (a normal trip has exactly one stop).
  if (to === 'ARRIVED') await exec(`UPDATE trip_stops SET status = 'ARRIVED', arrived_at = now() WHERE trip_id = :id AND seq = :last`, { id: t.id, last: t.stop_count }, tx);
  if (to === 'DELIVERED') {
    await exec(`UPDATE trip_stops SET status = 'DELIVERED', delivered_mt = :dmt, delivered_at = now(), arrived_at = COALESCE(arrived_at, now()), received_by = :rb, delivery_note_no = :dn, pod_notes = :pn WHERE trip_id = :id AND seq = :last`,
      { id: t.id, last: t.stop_count, dmt: p.deliveredMt, rb: p.receivedBy, dn: p.deliveryNoteNo ?? null, pn: p.podNotes ?? null }, tx);
    if (t.stop_count > 1) await recomputeTotals(tx, t.id);
  }

  // ----- side-effects on vehicle / driver -----
  const busy = ['DISPATCHED'];
  if (busy.includes(to) && vehicle && driver) {
    const o = await q1<any>('SELECT lat, lng, id FROM locations WHERE id = :id', { id: t.origin_location_id }, tx);
    await exec(`UPDATE vehicles SET status = 'ON_TRIP', last_lat = :lat, last_lng = :lng, last_location_id = :loc, last_speed_kmh = 0, last_position_at = now(), updated_at = now() WHERE id = :id`, { id: vehicle.id, lat: o.lat, lng: o.lng, loc: o.id }, tx);
    await exec(`UPDATE drivers SET status = 'ON_TRIP', updated_at = now() WHERE id = :id`, { id: driver.id }, tx);
  }
  if ((to === 'COMPLETED' || to === 'CANCELLED') && (vehicle || driver)) {
    const o = await q1<any>('SELECT lat, lng, id FROM locations WHERE id = :id', { id: t.origin_location_id }, tx);
    if (vehicle && vehicle.status === 'ON_TRIP') {
      const route = t.route_id ? await q1<any>('SELECT distance_km FROM routes WHERE id = :id', { id: t.route_id }, tx) : null;
      const endOdo = to === 'COMPLETED' ? (p.odometerKm ?? (route ? Math.round((t.odometer_start ?? vehicle.odometer_km) + Number(route.distance_km) * 2) : vehicle.odometer_km)) : vehicle.odometer_km;
      const km = Math.max(0, endOdo - vehicle.odometer_km);
      await exec(`UPDATE vehicles SET status = 'AVAILABLE', odometer_km = odometer_km + :km, last_lat = :lat, last_lng = :lng, last_location_id = :loc, last_speed_kmh = 0, last_position_at = now(), updated_at = now() WHERE id = :id`, { id: vehicle.id, km, lat: o.lat, lng: o.lng, loc: o.id }, tx);
    }
    if (driver && driver.status === 'ON_TRIP') await exec(`UPDATE drivers SET status = 'AVAILABLE', updated_at = now() WHERE id = :id`, { id: driver.id }, tx);
  }

  await addEvent(tx, t.id, { type: 'STATUS_CHANGE', fromStatus: from, toStatus: to, message: msg, actor: user?.id ?? null, lat: p.lat, lng: p.lng, clientEventId: p.clientEventId });
  await audit(req, {
    action: to === 'CANCELLED' ? 'CANCEL' : to === 'DISPATCHED' ? 'DISPATCH' : to === 'COMPLETED' ? 'COMPLETE' : 'STATUS_CHANGE',
    entityType: 'TRIP', entityId: t.id, entityLabel: t.code, meta: { from, to, reason: p.reason }, tx,
    ...(user ? {} : { userId: undefined, email: 'system' }),
  });

  // ----- notifications -----
  const base = { entityType: 'TRIP' as const, entityId: t.id, tx };
  const driverUser = t.driver_id ? await q1<any>('SELECT id FROM users WHERE driver_id = :d', { d: t.driver_id }, tx) : null;
  if (to === 'DISPATCHED') {
    await notify({ ...base, type: 'TRIP_DISPATCHED', severity: 'INFO', title: `Trip ${t.code} dispatched`, body: msg, roles: AUDIENCE.OPS });
    if (driverUser) await notify({ ...base, userId: driverUser.id, type: 'TRIP_ASSIGNED', severity: 'INFO', title: `New trip ${t.code} assigned to you`, body: 'Complete the pre-trip safety check and start the trip when loaded.' });
  } else if (to === 'COMPLETED') { await notify({ ...base, type: 'TRIP_COMPLETED', severity: 'SUCCESS', title: `Trip ${t.code} completed`, body: msg, roles: AUDIENCE.OPS }); await postHooks.tripCompleted?.({ ...t, status: 'COMPLETED' }, tx); }
  else if (to === 'DELAYED') await notify({ ...base, type: 'TRIP_DELAYED', severity: 'WARNING', title: `Trip ${t.code} is delayed`, body: msg, roles: AUDIENCE.OPS });
  else if (to === 'CANCELLED') await notify({ ...base, type: 'TRIP_CANCELLED', severity: 'WARNING', title: `Trip ${t.code} cancelled`, body: p.reason, roles: AUDIENCE.OPS });
  else if (to === 'ON_HOLD') await notify({ ...base, type: 'TRIP_ON_HOLD', severity: 'WARNING', title: `Trip ${t.code} put on hold`, body: p.reason, roles: AUDIENCE.OPS });
  else if (to === 'DELIVERED') await notify({ ...base, type: 'TRIP_DELIVERED', severity: 'SUCCESS', title: `Trip ${t.code} delivered`, body: msg, roles: AUDIENCE.OPS });
}

// ---------- Detail ----------

export async function tripActions(t: any, user: AuthUser) {
  const actions: { to: TripStatus; label: string; needs?: string[] }[] = [];
  for (const tr of allowedTransitions(t.status, user.role)) {
    if (tr.to === 'ASSIGNED') continue;
    if (user.role === 'DRIVER' && t.driver_id !== user.driverId) continue;
    if (user.role === 'DRIVER' && ['DISPATCHED', 'IN_TRANSIT', 'DELAYED', 'ARRIVED', 'DELIVERED', 'RETURNING'].includes(t.status) === false) continue;
    // DRAFT->PLANNED requires nothing extra; ASSIGNED->PLANNED is "unassign"
    actions.push({ to: tr.to, label: tr.label });
  }
  if (t.status === 'ON_HOLD' && t.status_before_hold && OPS_ROLES.includes(user.role)) actions.push({ to: t.status_before_hold, label: 'Resume' });
  return actions;
}

export async function getTripDetail(id: number, user: AuthUser) {
  const t = await q1<any>(
    `SELECT t.*, v.code AS vehicle_code, v.registration_no, v.capacity_mt AS vehicle_capacity_mt, v.fleet_type AS vehicle_fleet_type, v.odometer_km AS vehicle_odometer_km, v.bowzer_no, v.owner_name,
            d.full_name AS driver_name, d.phone AS driver_phone, d.employee_id AS driver_employee_id,
            o.name AS origin_name, o.city AS origin_city, o.lat AS origin_lat, o.lng AS origin_lng,
            dl.name AS destination_name, dl.city AS destination_city, dl.region AS destination_region, dl.lat AS destination_lat, dl.lng AS destination_lng,
            di.name AS distributor_name, di.code AS distributor_code, di.contact_name AS distributor_contact, di.phone AS distributor_phone,
            r.distance_km, r.est_duration_min, r.code AS route_code
       FROM trips t JOIN locations o ON o.id = t.origin_location_id JOIN locations dl ON dl.id = t.destination_location_id
       LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id
       LEFT JOIN distributors di ON di.id = t.distributor_id LEFT JOIN routes r ON r.id = t.route_id
      WHERE t.id = :id`, { id });
  if (!t) throw notFound('Trip');
  if (user.role === 'DRIVER' && t.driver_id !== user.driverId) throw forbidden('You can only view trips assigned to you.');
  const [events, checks] = await Promise.all([
    q<any>(`SELECT e.id, e.type, e.from_status, e.to_status, e.message, e.occurred_at, u.full_name AS actor_name
              FROM trip_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.trip_id = :id ORDER BY e.occurred_at DESC, e.id DESC LIMIT 200`, { id }),
    q<any>(`SELECT c.id, c.kind, c.result, c.items, c.notes, c.completed_at, u.full_name AS completed_by_name
              FROM safety_checks c LEFT JOIN users u ON u.id = c.completed_by WHERE c.trip_id = :id ORDER BY c.completed_at DESC`, { id }),
  ]);
  const canFin = can(user.role, 'finance:view');
  const stops = await listStops(id);
  const [expenses, fuel, econ] = await Promise.all([
    q<any>(`SELECT x.id, x.category, x.amount, x.nights, x.description, x.receipt_no, x.incurred_on, x.status, x.decision_note, x.created_at, u.full_name AS submitted_by_name
              FROM trip_expenses x LEFT JOIN users u ON u.id = x.submitted_by WHERE x.trip_id = :id ORDER BY x.created_at DESC`, { id }),
    q<any>(`SELECT f.id, f.station, f.fueled_at, f.litres, f.rate_per_l, f.amount, f.odometer_km, f.kmpl, f.status, f.flag_reason FROM fuel_entries f WHERE f.trip_id = :id ORDER BY f.fueled_at DESC`, { id }),
    tripEconomics(id),
  ]);
  if (!canFin) { delete t.freight_per_mt; delete t.bill_to_id; for (const s of stops) { delete s.freight_per_mt; delete s.bill_to_id; delete s.bill_to_name; } }
  const economics = canFin ? econ : { expensesApproved: econ.expensesApproved, expensesPending: econ.expensesPending, km: econ.km };
  return { trip: t, stops, events, checks, expenses, fuel, economics, actions: await tripActions(t, user) };
}

export { AppError };

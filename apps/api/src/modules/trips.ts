import { Router } from 'express';
import { z } from 'zod';
import { LPG_SOURCES, PRIORITIES, TRIP_STATUSES, TripStatus } from '@gasman/shared';
import { q, q1, exec } from '../db/sequelize';
import { forbidden, notFound, unprocessable } from '../lib/errors';
import { id, likeTerm, listResponse, orderBy, paging, parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';
import { addEvent, assignTrip, getOrCreateRoute, candidates, createTrip, getTripDetail, TRIP_LIST_FROM, TRIP_LIST_SELECT, transitionTrip, updateTrip, validateAssignment } from '../services/trips';

export const tripsRouter = Router();

const createBody = z.object({
  originLocationId: z.coerce.number().int().positive(),
  destinationLocationId: z.coerce.number().int().positive().optional(),
  distributorId: z.coerce.number().int().positive().optional(),
  lpgSource: z.enum(LPG_SOURCES).default('LOCAL'),
  plannedLoadMt: z.coerce.number().positive('Enter a load greater than zero.').max(60),
  scheduledDeparture: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date/time'),
  plannedArrival: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date/time').optional(),
  priority: z.enum(PRIORITIES).default('NORMAL'),
  notes: z.string().trim().max(500).optional(),
  vehicleId: z.coerce.number().int().positive().optional(),
  driverId: z.coerce.number().int().positive().optional(),
  submit: z.boolean().optional(),
  freightPerMt: z.coerce.number().min(0).max(1_000_000).optional(),
  billToId: z.coerce.number().int().positive().optional(),
});

const SORTS = { code: 't.code', departure: 't.scheduled_departure', status: 't.status', load: 't.planned_load_mt', priority: 't.priority', eta: 't.eta_at' };

tripsRouter.get('/', requirePerm('trips:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({
    status: z.string().optional(), plantId: z.coerce.number().optional(), vehicleId: z.coerce.number().optional(), driverId: z.coerce.number().optional(),
    destinationId: z.coerce.number().optional(), distributorId: z.coerce.number().optional(), region: z.string().optional(), priority: z.string().optional(),
    from: z.string().optional(), to: z.string().optional(), scope: z.enum(['active', 'upcoming', 'history']).optional(),
  }), req.query);
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (p.q) { where.push('(t.code ILIKE :q OR t.vehicle_id IN (SELECT id FROM vehicles WHERE code ILIKE :q OR registration_no ILIKE :q) OR t.driver_id IN (SELECT id FROM drivers WHERE full_name ILIKE :q) OR t.destination_location_id IN (SELECT id FROM locations WHERE name ILIKE :q) OR t.origin_location_id IN (SELECT id FROM locations WHERE name ILIKE :q) OR t.distributor_id IN (SELECT id FROM distributors WHERE name ILIKE :q))'); r.q = likeTerm(p.q); }
  if (f.status) { where.push('t.status IN (:st)'); r.st = f.status.split(',').filter((s) => (TRIP_STATUSES as readonly string[]).includes(s)); }
  if (f.scope === 'active') where.push(`t.status IN ('DISPATCHED','IN_TRANSIT','DELAYED','ON_HOLD','ARRIVED','DELIVERED','RETURNING')`);
  if (f.scope === 'upcoming') where.push(`t.status IN ('DRAFT','PLANNED','ASSIGNED')`);
  if (f.scope === 'history') where.push(`t.status IN ('COMPLETED','CANCELLED')`);
  if (f.plantId) { where.push('t.origin_location_id = :plant'); r.plant = f.plantId; }
  if (f.vehicleId) { where.push('t.vehicle_id = :veh'); r.veh = f.vehicleId; }
  if (f.driverId) { where.push('t.driver_id = :drv'); r.drv = f.driverId; }
  if (f.destinationId) { where.push('t.destination_location_id = :dest'); r.dest = f.destinationId; }
  if (f.distributorId) { where.push('t.distributor_id = :dist'); r.dist = f.distributorId; }
  if (f.region) { where.push('dl.region = :region'); r.region = f.region; }
  if (f.priority) { where.push('t.priority = :prio'); r.prio = f.priority; }
  if (f.from) { where.push('t.scheduled_departure >= :from'); r.from = f.from; }
  if (f.to) { where.push("t.scheduled_departure < (:to::date + 1)"); r.to = f.to; }
  if (req.user!.role === 'DRIVER') { where.push('t.driver_id = :me'); r.me = req.user!.driverId ?? -1; }
  const w = where.join(' AND ');
  const order = orderBy(p.sort, p.dir, SORTS, 't.scheduled_departure DESC');
  const [rows, [{ total }]] = await Promise.all([
    q(`SELECT ${TRIP_LIST_SELECT} ${TRIP_LIST_FROM} WHERE ${w} ORDER BY ${order}, t.id DESC LIMIT :lim OFFSET :off`, r),
    // The count only needs joins when a text search touches joined tables.
    q(`SELECT count(*)::int AS total ${TRIP_LIST_FROM} WHERE ${w}`, r),
  ]);
  res.json(listResponse(rows, total, p.page, p.pageSize));
}));

tripsRouter.get('/board', requirePerm('trips:view'), wrap(async (req, res) => {
  // Kanban data for the dispatch board: bounded per column so the payload stays small at any scale.
  const f = parse(z.object({ plantId: z.coerce.number().optional(), q: z.string().max(60).optional() }), req.query);
  const cols: Record<string, string[]> = {
    UNASSIGNED: ['DRAFT', 'PLANNED'], READY: ['ASSIGNED'], DISPATCHED: ['DISPATCHED'], IN_TRANSIT: ['IN_TRANSIT', 'DELAYED', 'ON_HOLD'], ARRIVED: ['ARRIVED', 'DELIVERED', 'RETURNING'],
  };
  const out: Record<string, { items: any[]; total: number }> = {};
  const baseWhere = [f.plantId ? 't.origin_location_id = :plant' : '1=1', f.q ? '(t.code ILIKE :q OR dl.name ILIKE :q OR v.code ILIKE :q OR d.full_name ILIKE :q)' : '1=1'].join(' AND ');
  const r: Record<string, unknown> = { plant: f.plantId, q: f.q ? likeTerm(f.q) : undefined };
  await Promise.all(Object.entries(cols).map(async ([k, sts]) => {
    const [items, [{ total }]] = await Promise.all([
      q(`SELECT ${TRIP_LIST_SELECT} ${TRIP_LIST_FROM} WHERE t.status IN (:sts) AND ${baseWhere} ORDER BY t.scheduled_departure ASC LIMIT 30`, { ...r, sts }),
      q(`SELECT count(*)::int AS total ${TRIP_LIST_FROM} WHERE t.status IN (:sts) AND ${baseWhere}`, { ...r, sts }),
    ]);
    out[k] = { items, total };
  }));
  res.json({ columns: out });
}));

/** Route estimate for the trip wizard (creates a synthetic route on first use; see docs/ADR on routing). */
tripsRouter.get('/route-preview', requirePerm('trips:create'), wrap(async (req, res) => {
  const b = parse(z.object({ originId: z.coerce.number().int().positive(), destinationId: z.coerce.number().int().positive() }), req.query);
  if (b.originId === b.destinationId) return res.json({ route: null });
  const r = await getOrCreateRoute(b.originId, b.destinationId);
  res.json({ route: { id: r.id, code: r.code, distanceKm: r.distance_km, estDurationMin: r.est_duration_min, freightPerMt: r.freight_per_mt } });
}));

tripsRouter.post('/', requirePerm('trips:create'), wrap(async (req, res) => {
  const b = parse(createBody, req.body);
  const newId = await createTrip(req.user!, req, b);
  res.status(201).json(await getTripDetail(newId, req.user!));
}));

tripsRouter.get('/:id', requirePerm('trips:view'), wrap(async (req, res) => {
  res.json(await getTripDetail(id(req), req.user!));
}));

tripsRouter.patch('/:id', requirePerm('trips:update'), wrap(async (req, res) => {
  const tid = id(req);
  await updateTrip(req.user!, req, tid, parse(createBody.partial(), req.body));
  res.json(await getTripDetail(tid, req.user!));
}));

tripsRouter.get('/:id/candidates', requirePerm('trips:assign'), wrap(async (req, res) => {
  res.json(await candidates(id(req)));
}));

tripsRouter.post('/:id/validate-assignment', requirePerm('trips:assign'), wrap(async (req, res) => {
  const b = parse(z.object({ vehicleId: z.coerce.number().int().positive(), driverId: z.coerce.number().int().positive() }), req.body);
  const t = await q1('SELECT * FROM trips WHERE id = :id', { id: id(req) });
  if (!t) throw notFound('Trip');
  const violations = await validateAssignment(t, b.vehicleId, b.driverId);
  res.json({ valid: violations.length === 0, violations });
}));

tripsRouter.post('/:id/assign', requirePerm('trips:assign'), wrap(async (req, res) => {
  const tid = id(req);
  const b = parse(z.object({ vehicleId: z.coerce.number().int().positive(), driverId: z.coerce.number().int().positive() }), req.body);
  await assignTrip(req.user!, req, tid, b.vehicleId, b.driverId);
  res.json(await getTripDetail(tid, req.user!));
}));

const transitionBody = z.object({
  to: z.enum(TRIP_STATUSES),
  reason: z.string().trim().max(250).optional(),
  note: z.string().trim().max(200).optional(),
  loadedMt: z.coerce.number().positive().max(60).optional(),
  deliveredMt: z.coerce.number().positive().max(60).optional(),
  receivedBy: z.string().trim().max(120).optional(),
  deliveryNoteNo: z.string().trim().max(40).optional(),
  podNotes: z.string().trim().max(500).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  clientEventId: z.string().trim().max(60).optional(),
  odometerKm: z.coerce.number().int().min(0).max(5_000_000).optional(),
  upliftVoucherNo: z.string().trim().max(40).optional(),
});

tripsRouter.post('/:id/transition', requirePerm('trips:progress', 'trips:dispatch', 'trips:cancel'), wrap(async (req, res) => {
  const tid = id(req);
  const { to, ...payload } = parse(transitionBody, req.body);
  await transitionTrip(req.user!, req, tid, to as TripStatus, payload);
  res.json(await getTripDetail(tid, req.user!));
}));

tripsRouter.post('/:id/notes', requirePerm('trips:progress', 'trips:update'), wrap(async (req, res) => {
  const tid = id(req);
  const b = parse(z.object({ message: z.string().trim().min(1).max(300) }), req.body);
  const t = await q1<any>('SELECT code, driver_id FROM trips WHERE id = :id', { id: tid });
  if (!t) throw notFound('Trip');
  if (req.user!.role === 'DRIVER' && t.driver_id !== req.user!.driverId) throw forbidden('You can only update trips assigned to you.');
  await addEvent(null, tid, { type: 'NOTE', message: b.message, actor: req.user!.id });
  await audit(req, { action: 'NOTE', entityType: 'TRIP', entityId: tid, entityLabel: t.code });
  res.status(201).json(await getTripDetail(tid, req.user!));
}));

// Driver / dispatcher records a safety checklist for a trip (pre-trip or post-trip).
const checkBody = z.object({
  kind: z.enum(['PRE_TRIP', 'POST_TRIP']).default('PRE_TRIP'),
  items: z.array(z.object({ key: z.string().max(40), label: z.string().max(120), ok: z.boolean(), note: z.string().max(200).optional() })).min(1).max(30),
  notes: z.string().trim().max(400).optional(),
});
tripsRouter.post('/:id/safety-checks', requirePerm('safety:report'), wrap(async (req, res) => {
  const tid = id(req);
  const b = parse(checkBody, req.body);
  const t = await q1<any>('SELECT id, code, vehicle_id, driver_id, status FROM trips WHERE id = :id', { id: tid });
  if (!t) throw notFound('Trip');
  if (!t.vehicle_id) throw unprocessable('Assign a vehicle before recording a safety check.');
  if (req.user!.role === 'DRIVER' && t.driver_id !== req.user!.driverId) throw forbidden('You can only record checks for your own trips.');
  const result = b.items.every((i) => i.ok) ? 'PASS' : 'FAIL';
  await exec(`INSERT INTO safety_checks (trip_id, vehicle_id, driver_id, kind, result, items, notes, completed_by) VALUES (:t, :v, :d, :k, :r, :items, :n, :u)`,
    { t: tid, v: t.vehicle_id, d: t.driver_id, k: b.kind, r: result, items: JSON.stringify(b.items), n: b.notes ?? null, u: req.user!.id });
  await addEvent(null, tid, { type: 'CHECK', message: `${b.kind === 'PRE_TRIP' ? 'Pre-trip' : 'Post-trip'} safety check ${result === 'PASS' ? 'passed' : 'FAILED: ' + b.items.filter((i) => !i.ok).map((i) => i.label).join(', ')}`, actor: req.user!.id });
  await audit(req, { action: 'SAFETY_CHECK', entityType: 'TRIP', entityId: tid, entityLabel: t.code, meta: { result } });
  res.status(201).json(await getTripDetail(tid, req.user!));
}));

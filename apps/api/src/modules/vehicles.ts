import { Router } from 'express';
import { z } from 'zod';
import { FLEET_TYPES, VEHICLE_CATEGORIES, VEHICLE_STATUSES } from '@gasman/shared';
import { q, q1, exec } from '../db/sequelize';
import { conflict, forbidden, notFound } from '../lib/errors';
import { id, likeTerm, listResponse, orderBy, paging, parse, wrap } from '../lib/http';
import { currentDocSql, docStatusSql, EXEC_STATUS_SQL } from '../lib/sql';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';

export const vehiclesRouter = Router();

const body = z.object({
  code: z.string().trim().min(3).max(30),
  registrationNo: z.string().trim().min(3).max(30),
  fleetType: z.enum(FLEET_TYPES),
  category: z.enum(VEHICLE_CATEGORIES).default('BOWZER'),
  capacityMt: z.coerce.number().positive().max(60),
  make: z.string().trim().max(40).optional().nullable(),
  model: z.string().trim().max(40).optional().nullable(),
  year: z.coerce.number().int().min(1990).max(2035).optional().nullable(),
  status: z.enum(VEHICLE_STATUSES).optional(),
  homePlantId: z.coerce.number().int().positive().optional().nullable(),
  defaultDriverId: z.coerce.number().int().positive().optional().nullable(),
  vendorName: z.string().trim().max(120).optional().nullable(),
  odometerKm: z.coerce.number().int().min(0).optional(),
});

const SORTS = { code: 'v.code', capacity: 'v.capacity_mt', status: 'v.status', fleet: 'v.fleet_type', odometer: 'v.odometer_km', updated: 'v.updated_at' };

vehiclesRouter.get('/', requirePerm('vehicles:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({
    status: z.string().optional(), fleetType: z.enum(FLEET_TYPES).optional(), plantId: z.coerce.number().optional(),
    category: z.enum(VEHICLE_CATEGORIES).optional(), docIssue: z.enum(['true']).optional(),
  }), req.query);
  const where: string[] = ['v.archived_at IS NULL'];
  const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (p.q) { where.push('(v.code ILIKE :q OR v.registration_no ILIKE :q OR v.make ILIKE :q OR v.vendor_name ILIKE :q)'); r.q = likeTerm(p.q); }
  if (f.status) { where.push('v.status IN (:statuses)'); r.statuses = f.status.split(',').filter((s) => (VEHICLE_STATUSES as readonly string[]).includes(s)); }
  if (f.fleetType) { where.push('v.fleet_type = :ft'); r.ft = f.fleetType; }
  if (f.category) { where.push('v.category = :cat'); r.cat = f.category; }
  if (f.plantId) { where.push('v.home_plant_id = :plant'); r.plant = f.plantId; }
  if (f.docIssue) where.push(`EXISTS (SELECT 1 FROM documents d WHERE d.vehicle_id = v.id AND d.expires_on <= CURRENT_DATE + 30 AND ${currentDocSql('d')})`);
  if (req.user!.role === 'DRIVER') {
    where.push(`(v.default_driver_id = :me OR EXISTS (SELECT 1 FROM trips t WHERE t.vehicle_id = v.id AND t.driver_id = :me))`);
    r.me = req.user!.driverId ?? -1;
  }
  const w = where.join(' AND ');
  const [rows, [{ total }]] = await Promise.all([
    q(`SELECT v.id, v.code, v.registration_no, v.fleet_type, v.category, v.capacity_mt, v.make, v.model, v.year, v.status, v.odometer_km,
              v.home_plant_id, l.name AS home_plant_name, v.default_driver_id, dd.full_name AS default_driver_name, v.vendor_name,
              v.last_lat, v.last_lng, v.last_speed_kmh, v.last_position_at, ll.name AS last_location_name,
              ct.id AS current_trip_id, ct.code AS current_trip_code, ct.status AS current_trip_status,
              docs.expired AS docs_expired, docs.expiring AS docs_expiring,
              mt.next_maintenance_on
         FROM vehicles v
         LEFT JOIN locations l ON l.id = v.home_plant_id
         LEFT JOIN locations ll ON ll.id = v.last_location_id
         LEFT JOIN drivers dd ON dd.id = v.default_driver_id
         LEFT JOIN LATERAL (SELECT t.id, t.code, t.status FROM trips t WHERE t.vehicle_id = v.id AND t.status IN ${EXEC_STATUS_SQL} LIMIT 1) ct ON true
         LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE expires_on < CURRENT_DATE)::int AS expired,
                                   count(*) FILTER (WHERE expires_on >= CURRENT_DATE AND expires_on <= CURRENT_DATE + 30)::int AS expiring
                              FROM documents d WHERE d.vehicle_id = v.id AND ${currentDocSql('d')}) docs ON true
         LEFT JOIN LATERAL (SELECT min(scheduled_on) AS next_maintenance_on FROM maintenance_records m WHERE m.vehicle_id = v.id AND m.status IN ('SCHEDULED','IN_PROGRESS')) mt ON true
        WHERE ${w} ORDER BY ${orderBy(p.sort, p.dir, SORTS, 'v.code ASC')} LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total FROM vehicles v WHERE ${w}`, r),
  ]);
  res.json(listResponse(rows, total, p.page, p.pageSize));
}));

vehiclesRouter.get('/summary', requirePerm('vehicles:view'), wrap(async (_req, res) => {
  const rows = await q(`SELECT status, fleet_type, count(*)::int AS n FROM vehicles WHERE archived_at IS NULL GROUP BY status, fleet_type`);
  res.json({ data: rows });
}));

vehiclesRouter.get('/:id', requirePerm('vehicles:view'), wrap(async (req, res) => {
  const vid = id(req);
  const v = await q1(`SELECT v.*, l.name AS home_plant_name, dd.full_name AS default_driver_name, ll.name AS last_location_name
                        FROM vehicles v LEFT JOIN locations l ON l.id = v.home_plant_id LEFT JOIN drivers dd ON dd.id = v.default_driver_id
                        LEFT JOIN locations ll ON ll.id = v.last_location_id WHERE v.id = :id`, { id: vid });
  if (!v) throw notFound('Vehicle');
  if (req.user!.role === 'DRIVER') {
    const mine = await q1(`SELECT 1 AS x FROM trips WHERE vehicle_id = :v AND driver_id = :d LIMIT 1`, { v: vid, d: req.user!.driverId ?? -1 });
    if (!mine && v.default_driver_id !== req.user!.driverId) throw forbidden('You can only view your assigned vehicle.');
  }
  const [documents, maintenance, trips, checks, util, incidents, current] = await Promise.all([
    q(`SELECT d.id, d.doc_type, d.doc_number, d.issued_on, d.expires_on, d.issuer, ${docStatusSql('d')} AS status, (d.expires_on - CURRENT_DATE)::int AS days_left
         FROM documents d WHERE d.vehicle_id = :id AND ${currentDocSql('d')} ORDER BY d.expires_on`, { id: vid }),
    q(`SELECT id, type, status, title, scheduled_on, completed_at, cost_pkr, vendor FROM maintenance_records WHERE vehicle_id = :id ORDER BY scheduled_on DESC LIMIT 10`, { id: vid }),
    q(`SELECT t.id, t.code, t.status, t.scheduled_departure, t.planned_load_mt, t.delivered_mt, dl.name AS destination_name, d.full_name AS driver_name
         FROM trips t JOIN locations dl ON dl.id = t.destination_location_id LEFT JOIN drivers d ON d.id = t.driver_id
        WHERE t.vehicle_id = :id ORDER BY t.scheduled_departure DESC LIMIT 10`, { id: vid }),
    q(`SELECT id, kind, result, completed_at FROM safety_checks WHERE vehicle_id = :id ORDER BY completed_at DESC LIMIT 5`, { id: vid }),
    q1(`SELECT count(*) FILTER (WHERE status = 'COMPLETED' AND completed_at >= now() - interval '30 days')::int AS trips_30d,
               COALESCE(sum(delivered_mt) FILTER (WHERE status = 'COMPLETED' AND completed_at >= now() - interval '30 days'), 0)::float AS lpg_mt_30d,
               count(*) FILTER (WHERE status = 'COMPLETED')::int AS trips_total,
               COALESCE(sum(delay_minutes) FILTER (WHERE status = 'COMPLETED'), 0)::int AS delay_min_total
          FROM trips WHERE vehicle_id = :id`, { id: vid }),
    q1(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status <> 'CLOSED')::int AS open FROM incidents WHERE vehicle_id = :id`, { id: vid }),
    q1(`SELECT t.id, t.code, t.status, t.progress_pct, t.eta_at, dl.name AS destination_name FROM trips t JOIN locations dl ON dl.id = t.destination_location_id
         WHERE t.vehicle_id = :id AND t.status IN ${EXEC_STATUS_SQL} LIMIT 1`, { id: vid }),
  ]);
  const days30 = 30;
  const busyTrips = await q1(`SELECT COALESCE(sum(extract(epoch FROM (COALESCE(completed_at, now()) - departed_at)) / 3600), 0)::float AS hrs FROM trips WHERE vehicle_id = :id AND departed_at >= now() - interval '30 days'`, { id: vid });
  res.json({ vehicle: v, documents, maintenance, trips, safetyChecks: checks, currentTrip: current ?? null, incidents,
    utilization: { ...util, busyHours30d: Math.round(busyTrips!.hrs), utilizationPct: Math.min(100, Math.round((busyTrips!.hrs / (days30 * 24)) * 100)) } });
}));

vehiclesRouter.post('/', requirePerm('vehicles:create'), wrap(async (req, res) => {
  const b = parse(body, req.body);
  const dup = await q1('SELECT 1 AS x FROM vehicles WHERE lower(registration_no) = lower(:r) OR lower(code) = lower(:c)', { r: b.registrationNo, c: b.code });
  if (dup) throw conflict('A vehicle with this fleet code or registration number already exists.');
  const row = await q1(
    `INSERT INTO vehicles (code, registration_no, fleet_type, category, capacity_mt, make, model, year, status, home_plant_id, default_driver_id, vendor_name, odometer_km, last_lat, last_lng, last_location_id, last_position_at)
     SELECT :code, :reg, :ft, :cat, :cap, :make, :model, :year, :status, :plant, :driver, :vendor, :odo, l.lat, l.lng, l.id, now()
       FROM (SELECT 1) x LEFT JOIN locations l ON l.id = :plant RETURNING *`,
    { code: b.code.toUpperCase(), reg: b.registrationNo.toUpperCase(), ft: b.fleetType, cat: b.category, cap: b.capacityMt, make: b.make ?? null, model: b.model ?? null, year: b.year ?? null,
      status: b.status ?? 'AVAILABLE', plant: b.homePlantId ?? null, driver: b.defaultDriverId ?? null, vendor: b.fleetType === 'HIRED' ? b.vendorName ?? null : null, odo: b.odometerKm ?? 0 },
  );
  await audit(req, { action: 'CREATE', entityType: 'VEHICLE', entityId: row.id, entityLabel: row.code });
  res.status(201).json({ vehicle: row });
}));

vehiclesRouter.patch('/:id', requirePerm('vehicles:update'), wrap(async (req, res) => {
  const vid = id(req);
  const b = parse(body.partial(), req.body);
  const cur = await q1<any>('SELECT * FROM vehicles WHERE id = :id AND archived_at IS NULL', { id: vid });
  if (!cur) throw notFound('Vehicle');
  if (b.status && b.status !== cur.status && ['MAINTENANCE', 'INACTIVE'].includes(b.status)) {
    const active = await q1<any>(`SELECT code FROM trips WHERE vehicle_id = :id AND status IN ${EXEC_STATUS_SQL} LIMIT 1`, { id: vid });
    if (active) throw conflict(`Vehicle ${cur.code} is on Trip ${active.code} and cannot be taken out of service right now.`);
  }
  if (b.status === 'ON_TRIP' && cur.status !== 'ON_TRIP') throw conflict('Vehicle status becomes On Trip automatically when a trip is dispatched.');
  if ((b.code && b.code.toLowerCase() !== cur.code.toLowerCase()) || (b.registrationNo && b.registrationNo.toLowerCase() !== cur.registration_no.toLowerCase())) {
    const dup = await q1('SELECT 1 AS x FROM vehicles WHERE id <> :id AND (lower(registration_no) = lower(:r) OR lower(code) = lower(:c))', { id: vid, r: b.registrationNo ?? '', c: b.code ?? '' });
    if (dup) throw conflict('A vehicle with this fleet code or registration number already exists.');
  }
  const cols: Record<string, string> = { code: 'code', registrationNo: 'registration_no', fleetType: 'fleet_type', category: 'category', capacityMt: 'capacity_mt', make: 'make', model: 'model', year: 'year', status: 'status', homePlantId: 'home_plant_id', defaultDriverId: 'default_driver_id', vendorName: 'vendor_name', odometerKm: 'odometer_km' };
  const sets: string[] = []; const r: Record<string, unknown> = { id: vid };
  for (const [k, c] of Object.entries(cols)) if ((b as any)[k] !== undefined) { sets.push(`${c} = :${c}`); r[c] = ['code', 'registrationNo'].includes(k) ? String((b as any)[k]).toUpperCase() : (b as any)[k]; }
  if (sets.length) await exec(`UPDATE vehicles SET ${sets.join(', ')}, updated_at = now() WHERE id = :id`, r);
  await audit(req, { action: 'UPDATE', entityType: 'VEHICLE', entityId: vid, entityLabel: cur.code, meta: { fields: Object.keys(b) } });
  res.json({ vehicle: await q1('SELECT * FROM vehicles WHERE id = :id', { id: vid }) });
}));

vehiclesRouter.delete('/:id', requirePerm('vehicles:archive'), wrap(async (req, res) => {
  const vid = id(req);
  const cur = await q1<any>('SELECT * FROM vehicles WHERE id = :id AND archived_at IS NULL', { id: vid });
  if (!cur) throw notFound('Vehicle');
  const active = await q1<any>(`SELECT code FROM trips WHERE vehicle_id = :id AND status IN ('ASSIGNED','DISPATCHED','IN_TRANSIT','DELAYED','ON_HOLD','ARRIVED','DELIVERED','RETURNING') LIMIT 1`, { id: vid });
  if (active) throw conflict(`Vehicle ${cur.code} is assigned to Trip ${active.code}. Unassign or complete it first.`);
  await exec(`UPDATE vehicles SET archived_at = now(), status = 'INACTIVE', updated_at = now() WHERE id = :id`, { id: vid });
  await audit(req, { action: 'ARCHIVE', entityType: 'VEHICLE', entityId: vid, entityLabel: cur.code });
  res.json({ ok: true });
}));

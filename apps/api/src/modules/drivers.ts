import { Router } from 'express';
import { z } from 'zod';
import { DRIVER_STATUSES } from '@gasman/shared';
import { q, q1, exec } from '../db/sequelize';
import { conflict, forbidden, notFound } from '../lib/errors';
import { id, likeTerm, listResponse, orderBy, paging, parse, wrap } from '../lib/http';
import { currentDocSql, docStatusSql, EXEC_STATUS_SQL } from '../lib/sql';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';

export const driversRouter = Router();

const body = z.object({
  employeeId: z.string().trim().min(2).max(30),
  fullName: z.string().trim().min(3).max(120),
  phone: z.string().trim().max(30).optional().nullable(),
  nationalIdDemo: z.string().trim().max(30).optional().nullable(),
  licenseNo: z.string().trim().min(3).max(40),
  licenseClass: z.string().trim().max(20).default('HTV'),
  status: z.enum(DRIVER_STATUSES).optional(),
  experienceYears: z.coerce.number().int().min(0).max(50).default(0),
  homePlantId: z.coerce.number().int().positive().optional().nullable(),
  safetyScore: z.coerce.number().int().min(0).max(100).optional(),
  joinedOn: z.string().optional().nullable(),
});

const SORTS = { name: 'd.full_name', employeeId: 'd.employee_id', experience: 'd.experience_years', status: 'd.status', safety: 'd.safety_score' };

driversRouter.get('/', requirePerm('drivers:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ status: z.string().optional(), plantId: z.coerce.number().optional(), docIssue: z.enum(['true']).optional() }), req.query);
  const where = ['d.archived_at IS NULL'];
  const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (p.q) { where.push('(d.full_name ILIKE :q OR d.employee_id ILIKE :q OR d.phone ILIKE :q OR d.license_no ILIKE :q)'); r.q = likeTerm(p.q); }
  if (f.status) { where.push('d.status IN (:st)'); r.st = f.status.split(',').filter((s) => (DRIVER_STATUSES as readonly string[]).includes(s)); }
  if (f.plantId) { where.push('d.home_plant_id = :plant'); r.plant = f.plantId; }
  if (f.docIssue) where.push(`EXISTS (SELECT 1 FROM documents x WHERE x.driver_id = d.id AND x.expires_on <= CURRENT_DATE + 30 AND ${currentDocSql('x')})`);
  if (req.user!.role === 'DRIVER') { where.push('d.id = :me'); r.me = req.user!.driverId ?? -1; }
  const w = where.join(' AND ');
  const [rows, [{ total }]] = await Promise.all([
    // Page the base table first, then run the per-driver lookups for just those rows (keeps list latency flat as the driver count grows).
    q(`SELECT d.id, d.employee_id, d.full_name, d.phone, d.license_no, d.license_class, d.status, d.experience_years, d.safety_score, d.home_plant_id, l.name AS home_plant_name,
              av.code AS assigned_vehicle_code, ct.code AS current_trip_code, docs.expired AS docs_expired, docs.expiring AS docs_expiring, lic.expires_on AS license_expiry
         FROM (SELECT * FROM drivers d WHERE ${w} ORDER BY ${orderBy(p.sort, p.dir, SORTS, 'd.full_name ASC')} LIMIT :lim OFFSET :off) d LEFT JOIN locations l ON l.id = d.home_plant_id
         LEFT JOIN LATERAL (SELECT code FROM vehicles v WHERE v.default_driver_id = d.id AND v.archived_at IS NULL LIMIT 1) av ON true
         LEFT JOIN LATERAL (SELECT t.code FROM trips t WHERE t.driver_id = d.id AND t.status IN ${EXEC_STATUS_SQL} LIMIT 1) ct ON true
         LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE expires_on < CURRENT_DATE)::int AS expired,
                                   count(*) FILTER (WHERE expires_on >= CURRENT_DATE AND expires_on <= CURRENT_DATE + 30)::int AS expiring
                              FROM documents x WHERE x.driver_id = d.id AND ${currentDocSql('x')}) docs ON true
         LEFT JOIN LATERAL (SELECT max(expires_on) AS expires_on FROM documents x WHERE x.driver_id = d.id AND x.doc_type = 'LICENSE') lic ON true
        ORDER BY ${orderBy(p.sort, p.dir, SORTS, 'd.full_name ASC')}`, r),
    q(`SELECT count(*)::int AS total FROM drivers d WHERE ${w}`, r),
  ]);
  res.json(listResponse(rows, total, p.page, p.pageSize));
}));

driversRouter.get('/:id', requirePerm('drivers:view'), wrap(async (req, res) => {
  const did = id(req);
  if (req.user!.role === 'DRIVER' && req.user!.driverId !== did) throw forbidden('You can only view your own profile.');
  const d = await q1(`SELECT d.*, l.name AS home_plant_name FROM drivers d LEFT JOIN locations l ON l.id = d.home_plant_id WHERE d.id = :id`, { id: did });
  if (!d) throw notFound('Driver');
  const [documents, trips, incidents, stats, vehicle, current, checks] = await Promise.all([
    q(`SELECT x.id, x.doc_type, x.doc_number, x.issued_on, x.expires_on, x.issuer, ${docStatusSql('x')} AS status, (x.expires_on - CURRENT_DATE)::int AS days_left
         FROM documents x WHERE x.driver_id = :id AND ${currentDocSql('x')} ORDER BY x.expires_on`, { id: did }),
    q(`SELECT t.id, t.code, t.status, t.scheduled_departure, t.delivered_mt, t.delay_minutes, dl.name AS destination_name, v.code AS vehicle_code
         FROM trips t JOIN locations dl ON dl.id = t.destination_location_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
        WHERE t.driver_id = :id ORDER BY t.scheduled_departure DESC LIMIT 10`, { id: did }),
    q(`SELECT id, code, category, severity, status, reported_at, description FROM incidents WHERE driver_id = :id ORDER BY reported_at DESC LIMIT 10`, { id: did }),
    q1(`SELECT count(*) FILTER (WHERE status = 'COMPLETED')::int AS trips_total,
               count(*) FILTER (WHERE status = 'COMPLETED' AND completed_at >= now() - interval '30 days')::int AS trips_30d,
               COALESCE(sum(delivered_mt) FILTER (WHERE status = 'COMPLETED'), 0)::float AS lpg_mt_total,
               COALESCE(round(100.0 * count(*) FILTER (WHERE status = 'COMPLETED' AND delay_minutes <= 15) / NULLIF(count(*) FILTER (WHERE status = 'COMPLETED'), 0)), 100)::int AS on_time_pct
          FROM trips WHERE driver_id = :id`, { id: did }),
    q1(`SELECT id, code, registration_no FROM vehicles WHERE default_driver_id = :id AND archived_at IS NULL LIMIT 1`, { id: did }),
    q1(`SELECT t.id, t.code, t.status, t.progress_pct, dl.name AS destination_name FROM trips t JOIN locations dl ON dl.id = t.destination_location_id WHERE t.driver_id = :id AND t.status IN ${EXEC_STATUS_SQL} LIMIT 1`, { id: did }),
    q(`SELECT id, kind, result, completed_at FROM safety_checks WHERE driver_id = :id ORDER BY completed_at DESC LIMIT 5`, { id: did }),
  ]);
  res.json({ driver: d, documents, trips, incidents, stats, assignedVehicle: vehicle ?? null, currentTrip: current ?? null, safetyChecks: checks });
}));

driversRouter.post('/', requirePerm('drivers:create'), wrap(async (req, res) => {
  const b = parse(body, req.body);
  if (await q1('SELECT 1 AS x FROM drivers WHERE lower(employee_id) = lower(:e)', { e: b.employeeId })) throw conflict('A driver with this employee ID already exists.');
  const row = await q1(
    `INSERT INTO drivers (employee_id, full_name, phone, national_id_demo, license_no, license_class, status, experience_years, home_plant_id, safety_score, joined_on)
     VALUES (:e, :n, :ph, :nid, :lic, :cls, :st, :exp, :plant, :ss, :j) RETURNING *`,
    { e: b.employeeId.toUpperCase(), n: b.fullName, ph: b.phone ?? null, nid: b.nationalIdDemo ?? null, lic: b.licenseNo, cls: b.licenseClass, st: b.status ?? 'AVAILABLE', exp: b.experienceYears, plant: b.homePlantId ?? null, ss: b.safetyScore ?? 100, j: b.joinedOn || null },
  );
  await audit(req, { action: 'CREATE', entityType: 'DRIVER', entityId: row.id, entityLabel: row.full_name });
  res.status(201).json({ driver: row });
}));

driversRouter.patch('/:id', requirePerm('drivers:update'), wrap(async (req, res) => {
  const did = id(req);
  const b = parse(body.partial(), req.body);
  const cur = await q1<any>('SELECT * FROM drivers WHERE id = :id AND archived_at IS NULL', { id: did });
  if (!cur) throw notFound('Driver');
  if (b.status && b.status !== cur.status) {
    if (b.status === 'ON_TRIP') throw conflict('Driver status becomes On Trip automatically when a trip is dispatched.');
    if (cur.status === 'ON_TRIP') throw conflict(`${cur.full_name} is currently on a trip. Complete the trip first.`);
  }
  if (b.employeeId && b.employeeId.toLowerCase() !== cur.employee_id.toLowerCase() && (await q1('SELECT 1 AS x FROM drivers WHERE lower(employee_id) = lower(:e)', { e: b.employeeId })))
    throw conflict('A driver with this employee ID already exists.');
  const cols: Record<string, string> = { employeeId: 'employee_id', fullName: 'full_name', phone: 'phone', nationalIdDemo: 'national_id_demo', licenseNo: 'license_no', licenseClass: 'license_class', status: 'status', experienceYears: 'experience_years', homePlantId: 'home_plant_id', safetyScore: 'safety_score', joinedOn: 'joined_on' };
  const sets: string[] = []; const r: Record<string, unknown> = { id: did };
  for (const [k, c] of Object.entries(cols)) if ((b as any)[k] !== undefined) { sets.push(`${c} = :${c}`); r[c] = (b as any)[k] === '' ? null : k === 'employeeId' ? String((b as any)[k]).toUpperCase() : (b as any)[k]; }
  if (sets.length) await exec(`UPDATE drivers SET ${sets.join(', ')}, updated_at = now() WHERE id = :id`, r);
  await audit(req, { action: 'UPDATE', entityType: 'DRIVER', entityId: did, entityLabel: cur.full_name, meta: { fields: Object.keys(b) } });
  res.json({ driver: await q1('SELECT * FROM drivers WHERE id = :id', { id: did }) });
}));

driversRouter.delete('/:id', requirePerm('drivers:archive'), wrap(async (req, res) => {
  const did = id(req);
  const cur = await q1<any>('SELECT * FROM drivers WHERE id = :id AND archived_at IS NULL', { id: did });
  if (!cur) throw notFound('Driver');
  const active = await q1<any>(`SELECT code FROM trips WHERE driver_id = :id AND status IN ('ASSIGNED','DISPATCHED','IN_TRANSIT','DELAYED','ON_HOLD','ARRIVED','DELIVERED','RETURNING') LIMIT 1`, { id: did });
  if (active) throw conflict(`${cur.full_name} is assigned to Trip ${active.code}. Unassign or complete it first.`);
  await exec(`UPDATE drivers SET archived_at = now(), status = 'OFF_DUTY', updated_at = now() WHERE id = :id`, { id: did });
  await exec(`UPDATE vehicles SET default_driver_id = NULL WHERE default_driver_id = :id`, { id: did });
  await audit(req, { action: 'ARCHIVE', entityType: 'DRIVER', entityId: did, entityLabel: cur.full_name });
  res.json({ ok: true });
}));

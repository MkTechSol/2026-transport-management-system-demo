import { Router } from 'express';
import { z } from 'zod';
import { INCIDENT_CATEGORIES, INCIDENT_SEVERITIES, INCIDENT_STATUSES } from '@gasman/shared';
import { q, q1, exec } from '../db/sequelize';
import { forbidden, notFound } from '../lib/errors';
import { id, likeTerm, listResponse, orderBy, paging, parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';
import { AUDIENCE, notify } from '../services/notify';
import { addEvent } from '../services/trips';

export const safetyRouter = Router();

safetyRouter.get('/checks', requirePerm('safety:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ result: z.enum(['PASS', 'FAIL']).optional(), vehicleId: z.coerce.number().optional() }), req.query);
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (f.result) { where.push('c.result = :res'); r.res = f.result; }
  if (f.vehicleId) { where.push('c.vehicle_id = :v'); r.v = f.vehicleId; }
  if (p.q) { where.push('(v.code ILIKE :q OR t.code ILIKE :q OR d.full_name ILIKE :q)'); r.q = likeTerm(p.q); }
  const w = where.join(' AND ');
  const from = `FROM safety_checks c JOIN vehicles v ON v.id = c.vehicle_id LEFT JOIN trips t ON t.id = c.trip_id LEFT JOIN drivers d ON d.id = c.driver_id LEFT JOIN users u ON u.id = c.completed_by WHERE ${w}`;
  const [rows, [{ total }]] = await Promise.all([
    q(`SELECT c.id, c.kind, c.result, c.items, c.notes, c.completed_at, v.code AS vehicle_code, t.id AS trip_id, t.code AS trip_code, d.full_name AS driver_name, u.full_name AS completed_by_name
         ${from} ORDER BY c.completed_at DESC LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total ${from}`, r),
  ]);
  res.json(listResponse(rows, total, p.page, p.pageSize));
}));

safetyRouter.get('/incidents', requirePerm('safety:view', 'safety:report'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ status: z.string().optional(), severity: z.string().optional(), category: z.string().optional() }), req.query);
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (f.status) { where.push('i.status IN (:st)'); r.st = f.status.split(','); }
  if (f.severity) { where.push('i.severity IN (:sev)'); r.sev = f.severity.split(','); }
  if (f.category) { where.push('i.category = :cat'); r.cat = f.category; }
  if (req.user!.role === 'DRIVER') { where.push('i.driver_id = :me'); r.me = req.user!.driverId ?? -1; }
  if (p.q) { where.push('(i.code ILIKE :q OR v.code ILIKE :q OR d.full_name ILIKE :q OR i.description ILIKE :q)'); r.q = likeTerm(p.q); }
  const w = where.join(' AND ');
  const from = `FROM incidents i LEFT JOIN vehicles v ON v.id = i.vehicle_id LEFT JOIN drivers d ON d.id = i.driver_id LEFT JOIN trips t ON t.id = i.trip_id WHERE ${w}`;
  const [rows, [{ total }]] = await Promise.all([
    q(`SELECT i.*, v.code AS vehicle_code, d.full_name AS driver_name, t.code AS trip_code ${from}
        ORDER BY ${orderBy(p.sort, p.dir, { reported: 'i.reported_at', severity: 'i.severity', status: 'i.status' }, 'i.reported_at DESC')} LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total ${from}`, r),
  ]);
  res.json(listResponse(rows, total, p.page, p.pageSize));
}));

const incBody = z.object({
  tripId: z.coerce.number().int().positive().optional(),
  vehicleId: z.coerce.number().int().positive().optional(),
  driverId: z.coerce.number().int().positive().optional(),
  category: z.enum(INCIDENT_CATEGORIES),
  severity: z.enum(INCIDENT_SEVERITIES),
  description: z.string().trim().min(10, 'Please describe what happened (at least 10 characters).').max(1000),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

safetyRouter.post('/incidents', requirePerm('safety:report'), wrap(async (req, res) => {
  const b = parse(incBody, req.body);
  let { tripId, vehicleId, driverId } = b;
  let trip: any = null;
  if (tripId) {
    trip = await q1<any>('SELECT id, code, vehicle_id, driver_id, cur_lat, cur_lng FROM trips WHERE id = :id', { id: tripId });
    if (!trip) throw notFound('Trip');
    vehicleId ??= trip.vehicle_id ?? undefined; driverId ??= trip.driver_id ?? undefined;
  }
  if (req.user!.role === 'DRIVER') {
    if (trip && trip.driver_id !== req.user!.driverId) throw forbidden('You can only report incidents for your own trips.');
    driverId = req.user!.driverId ?? undefined;
  }
  const [{ n }] = await q<any>("SELECT nextval('incident_code_seq')::int AS n");
  const code = `INC-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`;
  const row = await q1<any>(
    `INSERT INTO incidents (code, trip_id, vehicle_id, driver_id, category, severity, description, lat, lng, reported_by)
     VALUES (:code, :t, :v, :d, :cat, :sev, :desc, :lat, :lng, :u) RETURNING *`,
    { code, t: tripId ?? null, v: vehicleId ?? null, d: driverId ?? null, cat: b.category, sev: b.severity, desc: b.description, lat: b.lat ?? trip?.cur_lat ?? null, lng: b.lng ?? trip?.cur_lng ?? null, u: req.user!.id });
  if (tripId) await addEvent(null, tripId, { type: 'ALERT', message: `Incident ${code} reported (${b.category.replace('_', ' ').toLowerCase()}, ${b.severity.toLowerCase()})`, actor: req.user!.id });
  const serious = b.severity === 'HIGH' || b.severity === 'CRITICAL';
  await notify({ type: 'INCIDENT_REPORTED', severity: serious ? 'CRITICAL' : 'WARNING', roles: serious ? AUDIENCE.ALL_STAFF : AUDIENCE.FLEET.concat(['DISPATCHER']), entityType: 'INCIDENT', entityId: row.id,
    title: `Safety incident ${code}: ${b.category.replace('_', ' ').toLowerCase()}`, body: b.description.slice(0, 200) });
  await audit(req, { action: 'INCIDENT_REPORTED', entityType: 'INCIDENT', entityId: row.id, entityLabel: code, meta: { severity: b.severity } });
  res.status(201).json({ incident: row });
}));

safetyRouter.patch('/incidents/:id', requirePerm('safety:manage'), wrap(async (req, res) => {
  const iid = id(req);
  const b = parse(z.object({ status: z.enum(INCIDENT_STATUSES).optional(), resolution: z.string().trim().max(1000).optional() }), req.body);
  const cur = await q1<any>('SELECT * FROM incidents WHERE id = :id', { id: iid });
  if (!cur) throw notFound('Incident');
  if (b.status === 'CLOSED' && !(b.resolution || cur.resolution)) throw (await import('../lib/errors')).badRequest('Add a resolution note before closing the incident.', { fields: { resolution: 'Required to close' } });
  await exec(`UPDATE incidents SET status = COALESCE(:st, status), resolution = COALESCE(:res, resolution), closed_at = CASE WHEN :st = 'CLOSED' THEN now() ELSE closed_at END WHERE id = :id`, { id: iid, st: b.status ?? null, res: b.resolution ?? null });
  await audit(req, { action: `INCIDENT_${b.status ?? 'UPDATED'}`, entityType: 'INCIDENT', entityId: iid, entityLabel: cur.code });
  res.json({ incident: await q1('SELECT * FROM incidents WHERE id = :id', { id: iid }) });
}));

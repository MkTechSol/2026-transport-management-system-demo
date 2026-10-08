import { Router } from 'express';
import { z } from 'zod';
import { MAINTENANCE_STATUSES, MAINTENANCE_TYPES } from '@gasman/shared';
import { q, q1, exec, sequelize } from '../db/sequelize';
import { conflict, notFound, unprocessable } from '../lib/errors';
import { id, listResponse, orderBy, paging, parse, likeTerm, wrap } from '../lib/http';
import { EXEC_STATUS_SQL } from '../lib/sql';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';
import { AUDIENCE, notify } from '../services/notify';

export const maintenanceRouter = Router();

maintenanceRouter.get('/', requirePerm('maintenance:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ status: z.string().optional(), type: z.string().optional(), vehicleId: z.coerce.number().optional(), due: z.enum(['true']).optional() }), req.query);
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (f.status) { where.push('m.status IN (:st)'); r.st = f.status.split(','); }
  if (f.type) { where.push('m.type = :type'); r.type = f.type; }
  if (f.vehicleId) { where.push('m.vehicle_id = :veh'); r.veh = f.vehicleId; }
  if (f.due) where.push(`m.status = 'SCHEDULED' AND m.scheduled_on <= CURRENT_DATE + 7`);
  if (p.q) { where.push('(m.title ILIKE :q OR v.code ILIKE :q OR m.vendor ILIKE :q)'); r.q = likeTerm(p.q); }
  const w = where.join(' AND ');
  const [rows, [{ total }], [{ due, overdue, in_progress }]] = await Promise.all([
    q(`SELECT m.*, v.code AS vehicle_code, v.registration_no, (m.scheduled_on - CURRENT_DATE)::int AS days_left
         FROM maintenance_records m JOIN vehicles v ON v.id = m.vehicle_id WHERE ${w}
        ORDER BY ${orderBy(p.sort, p.dir, { scheduled: 'm.scheduled_on', vehicle: 'v.code', status: 'm.status', cost: 'm.cost_pkr' }, `CASE WHEN m.status IN ('SCHEDULED','IN_PROGRESS') THEN 0 ELSE 1 END, m.scheduled_on ASC`)} LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total FROM maintenance_records m JOIN vehicles v ON v.id = m.vehicle_id WHERE ${w}`, r),
    q(`SELECT count(*) FILTER (WHERE status = 'SCHEDULED' AND scheduled_on <= CURRENT_DATE + 7)::int AS due, count(*) FILTER (WHERE status = 'SCHEDULED' AND scheduled_on < CURRENT_DATE)::int AS overdue,
              count(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS in_progress FROM maintenance_records`),
  ]);
  res.json({ ...listResponse(rows, total, p.page, p.pageSize), summary: { due, overdue, inProgress: in_progress } });
}));

const body = z.object({
  vehicleId: z.coerce.number().int().positive(),
  type: z.enum(MAINTENANCE_TYPES),
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().max(500).optional().nullable(),
  scheduledOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  vendor: z.string().trim().max(120).optional().nullable(),
  costPkr: z.coerce.number().min(0).optional().nullable(),
  odometerKm: z.coerce.number().int().min(0).optional().nullable(),
});

maintenanceRouter.post('/', requirePerm('maintenance:manage'), wrap(async (req, res) => {
  const b = parse(body, req.body);
  const v = await q1<any>('SELECT code FROM vehicles WHERE id = :id AND archived_at IS NULL', { id: b.vehicleId });
  if (!v) throw notFound('Vehicle');
  const row = await q1(`INSERT INTO maintenance_records (vehicle_id, type, title, description, scheduled_on, vendor, cost_pkr, odometer_km, created_by)
                        VALUES (:v, :t, :title, :d, :on, :vendor, :cost, :odo, :u) RETURNING *`,
    { v: b.vehicleId, t: b.type, title: b.title, d: b.description ?? null, on: b.scheduledOn, vendor: b.vendor ?? null, cost: b.costPkr ?? null, odo: b.odometerKm ?? null, u: req.user!.id });
  await audit(req, { action: 'CREATE', entityType: 'MAINTENANCE', entityId: row.id, entityLabel: `${v.code}: ${b.title}` });
  res.status(201).json({ maintenance: row });
}));

maintenanceRouter.patch('/:id', requirePerm('maintenance:manage'), wrap(async (req, res) => {
  const mid = id(req);
  const b = parse(body.partial().extend({ status: z.enum(MAINTENANCE_STATUSES).optional() }), req.body);
  const cur = await q1<any>('SELECT m.*, v.code AS vehicle_code FROM maintenance_records m JOIN vehicles v ON v.id = m.vehicle_id WHERE m.id = :id', { id: mid });
  if (!cur) throw notFound('Maintenance record');
  if (['COMPLETED', 'CANCELLED'].includes(cur.status)) throw conflict('This maintenance record is closed and can no longer be changed.');
  await sequelize.transaction(async (tx) => {
    const sets: string[] = []; const r: Record<string, unknown> = { id: mid };
    const cols: Record<string, string> = { type: 'type', title: 'title', description: 'description', scheduledOn: 'scheduled_on', vendor: 'vendor', costPkr: 'cost_pkr', odometerKm: 'odometer_km' };
    for (const [k, c] of Object.entries(cols)) if ((b as any)[k] !== undefined) { sets.push(`${c} = :${c}`); r[c] = (b as any)[k]; }
    if (b.status && b.status !== cur.status) {
      if (b.status === 'IN_PROGRESS') {
        const active = await q1<any>(`SELECT code FROM trips WHERE vehicle_id = :v AND status IN ${EXEC_STATUS_SQL} LIMIT 1`, { v: cur.vehicle_id }, tx);
        if (active) throw unprocessable(`Vehicle ${cur.vehicle_code} is on Trip ${active.code}. Start maintenance after the trip is completed.`);
        const reserved = await q1<any>(`SELECT code FROM trips WHERE vehicle_id = :v AND status = 'ASSIGNED' LIMIT 1`, { v: cur.vehicle_id }, tx);
        if (reserved) throw unprocessable(`Vehicle ${cur.vehicle_code} is assigned to upcoming Trip ${reserved.code}. Unassign it before starting maintenance.`);
        sets.push('started_at = now()'); await exec(`UPDATE vehicles SET status = 'MAINTENANCE', updated_at = now() WHERE id = :v`, { v: cur.vehicle_id }, tx);
      }
      if (b.status === 'COMPLETED') {
        sets.push('completed_at = now()');
        const others = await q1<any>(`SELECT 1 AS x FROM maintenance_records WHERE vehicle_id = :v AND status = 'IN_PROGRESS' AND id <> :id`, { v: cur.vehicle_id, id: mid }, tx);
        if (!others) await exec(`UPDATE vehicles SET status = 'AVAILABLE', odometer_km = GREATEST(odometer_km, COALESCE(:odo, odometer_km)), updated_at = now() WHERE id = :v AND status = 'MAINTENANCE'`, { v: cur.vehicle_id, odo: b.odometerKm ?? cur.odometer_km }, tx);
      }
      if (b.status === 'CANCELLED' && cur.status === 'IN_PROGRESS') await exec(`UPDATE vehicles SET status = 'AVAILABLE', updated_at = now() WHERE id = :v AND status = 'MAINTENANCE'`, { v: cur.vehicle_id }, tx);
      sets.push('status = :status'); r.status = b.status;
    }
    if (sets.length) await exec(`UPDATE maintenance_records SET ${sets.join(', ')}, updated_at = now() WHERE id = :id`, r, tx);
  });
  if (b.status === 'IN_PROGRESS') await notify({ type: 'MAINTENANCE_STARTED', severity: 'INFO', roles: AUDIENCE.FLEET, entityType: 'VEHICLE', entityId: cur.vehicle_id, title: `${cur.vehicle_code} entered maintenance`, body: cur.title });
  if (b.status === 'COMPLETED') await notify({ type: 'MAINTENANCE_COMPLETED', severity: 'SUCCESS', roles: AUDIENCE.FLEET, entityType: 'VEHICLE', entityId: cur.vehicle_id, title: `${cur.vehicle_code} maintenance completed`, body: cur.title });
  await audit(req, { action: b.status ? `MAINTENANCE_${b.status}` : 'UPDATE', entityType: 'MAINTENANCE', entityId: mid, entityLabel: `${cur.vehicle_code}: ${cur.title}` });
  res.json({ maintenance: await q1('SELECT * FROM maintenance_records WHERE id = :id', { id: mid }) });
}));

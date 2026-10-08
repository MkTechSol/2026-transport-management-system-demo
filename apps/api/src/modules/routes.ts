import { Router } from 'express';
import { z } from 'zod';
import { q, q1, exec } from '../db/sequelize';
import { conflict, notFound, badRequest } from '../lib/errors';
import { id, likeTerm, listResponse, orderBy, paging, parse, wrap } from '../lib/http';
import { buildSyntheticRoute, demoFreightPerMt } from '../lib/geo';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';

export const routesRouter = Router();

/** "Route Definition" (legacy parity): origin → destination with distance and freight per MT. */
routesRouter.get('/', requirePerm('routes:view', 'trips:create'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ active: z.enum(['true', 'false']).optional(), originId: z.coerce.number().optional(), destinationId: z.coerce.number().optional() }), req.query);
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  where.push("rt.kind = 'DIRECT'");
  if (p.q) { where.push('(rt.name ILIKE :q OR o.name ILIKE :q OR d.name ILIKE :q OR rt.code ILIKE :q)'); r.q = likeTerm(p.q); }
  if (f.active) { where.push('rt.active = :act'); r.act = f.active === 'true'; }
  if (f.originId) { where.push('rt.origin_location_id = :o'); r.o = f.originId; }
  if (f.destinationId) { where.push('rt.destination_location_id = :d'); r.d = f.destinationId; }
  const w = where.join(' AND ');
  const from = `FROM routes rt JOIN locations o ON o.id = rt.origin_location_id JOIN locations d ON d.id = rt.destination_location_id WHERE ${w}`;
  const [rows, [{ total }]] = await Promise.all([
    q(`SELECT rt.id, rt.code, COALESCE(rt.name, rt.code) AS name, rt.origin_location_id, o.name AS origin_name, rt.destination_location_id, d.name AS destination_name, rt.distance_km, rt.est_duration_min, rt.freight_per_mt, rt.active,
              (SELECT count(*)::int FROM trips t WHERE t.route_id = rt.id) AS trips
         ${from} ORDER BY ${orderBy(p.sort, p.dir, { name: 'rt.name', distance: 'rt.distance_km', freight: 'rt.freight_per_mt', trips: 'trips' }, 'o.name, d.name')} LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total ${from}`, r),
  ]);
  res.json(listResponse(rows, total, p.page, p.pageSize));
}));

const body = z.object({
  name: z.string().trim().min(3).max(150).optional(),
  originLocationId: z.coerce.number().int().positive(),
  destinationLocationId: z.coerce.number().int().positive(),
  distanceKm: z.coerce.number().positive().max(5000).optional(),
  freightPerMt: z.coerce.number().min(0).max(1_000_000),
  active: z.boolean().optional(),
});

routesRouter.post('/', requirePerm('routes:manage'), wrap(async (req, res) => {
  const b = parse(body, req.body);
  if (b.originLocationId === b.destinationLocationId) throw badRequest('Origin and destination must be different.', { fields: { destinationLocationId: 'Must differ from origin' } });
  if (await q1('SELECT 1 AS x FROM routes WHERE kind = \'DIRECT\' AND origin_location_id = :o AND destination_location_id = :d', { o: b.originLocationId, d: b.destinationLocationId })) throw conflict('A route between these two locations already exists. Edit it instead.');
  const o = await q1<any>('SELECT code, name, lat, lng FROM locations WHERE id = :id', { id: b.originLocationId });
  const d = await q1<any>('SELECT code, name, lat, lng FROM locations WHERE id = :id', { id: b.destinationLocationId });
  if (!o || !d) throw notFound('Location');
  const geo = buildSyntheticRoute([o.lat, o.lng], [d.lat, d.lng], b.originLocationId * 31 + b.destinationLocationId);
  const km = b.distanceKm ?? geo.distanceKm;
  const row = await q1<any>(
    `INSERT INTO routes (code, name, origin_location_id, destination_location_id, distance_km, est_duration_min, path, checkpoints, freight_per_mt)
     VALUES (:code, :name, :o, :d, :km, :min, :path, :cps, :fr) RETURNING *`,
    { code: `RT-${o.code}-${d.code}`.slice(0, 40), name: b.name ?? `${o.name} – ${d.name}`, o: b.originLocationId, d: b.destinationLocationId, km, min: Math.round((km / 46) * 60), path: JSON.stringify(geo.path), cps: JSON.stringify(geo.checkpoints), fr: b.freightPerMt });
  await audit(req, { action: 'CREATE', entityType: 'ROUTE', entityId: row.id, entityLabel: row.name });
  res.status(201).json({ route: row });
}));

routesRouter.patch('/:id', requirePerm('routes:manage'), wrap(async (req, res) => {
  const rid = id(req);
  const b = parse(body.partial().omit({ originLocationId: true, destinationLocationId: true }), req.body);
  const cur = await q1<any>('SELECT * FROM routes WHERE id = :id', { id: rid });
  if (!cur) throw notFound('Route');
  const sets: string[] = []; const r: Record<string, unknown> = { id: rid };
  if (b.name !== undefined) { sets.push('name = :n'); r.n = b.name; }
  if (b.distanceKm !== undefined) { sets.push('distance_km = :km', 'est_duration_min = :min'); r.km = b.distanceKm; r.min = Math.round((b.distanceKm / 46) * 60); }
  if (b.freightPerMt !== undefined) { sets.push('freight_per_mt = :fr'); r.fr = b.freightPerMt; }
  if (b.active !== undefined) { sets.push('active = :act'); r.act = b.active; }
  if (sets.length) await exec(`UPDATE routes SET ${sets.join(', ')} WHERE id = :id`, r);
  await audit(req, { action: 'UPDATE', entityType: 'ROUTE', entityId: rid, entityLabel: cur.name ?? cur.code, meta: b });
  res.json({ route: await q1('SELECT * FROM routes WHERE id = :id', { id: rid }) });
}));
export const _d = demoFreightPerMt;

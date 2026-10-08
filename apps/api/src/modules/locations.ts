import { Router } from 'express';
import { z } from 'zod';
import { CUSTOMER_TYPES, LOCATION_TYPES, REGIONS, can } from '@gasman/shared';
import { q, q1, exec, sequelize } from '../db/sequelize';
import { conflict, notFound } from '../lib/errors';
import { id, likeTerm, listResponse, orderBy, paging, parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';

export const locationsRouter = Router();
export const distributorsRouter = Router();

const locBody = z.object({
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(2).max(150),
  type: z.enum(LOCATION_TYPES),
  city: z.string().trim().max(80).optional().nullable(),
  region: z.enum(REGIONS),
  address: z.string().trim().max(250).optional().nullable(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  storageCapacityMt: z.coerce.number().min(0).optional().nullable(),
  contactPhone: z.string().trim().max(30).optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

locationsRouter.get('/', requirePerm('locations:view', 'trips:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ type: z.string().optional(), region: z.string().optional(), all: z.string().optional() }), req.query);
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (f.type) { where.push('l.type IN (:types)'); r.types = f.type.split(','); }
  if (f.region) { where.push('l.region = :region'); r.region = f.region; }
  if (p.q) { where.push('(l.name ILIKE :q OR l.code ILIKE :q OR l.city ILIKE :q)'); r.q = likeTerm(p.q); }
  const w = where.join(' AND ');
  // `all=1` returns an unpaginated compact list for dropdowns (locations are a small bounded set; distributors have their own paged endpoint).
  if (f.all) {
    const rows = await q(`SELECT l.id, l.code, l.name, l.type, l.city, l.region, l.lat, l.lng FROM locations l WHERE ${w} AND l.status = 'ACTIVE' ORDER BY l.name LIMIT 500`, r);
    return res.json({ data: rows });
  }
  const [rows, [{ total }]] = await Promise.all([
    q(`SELECT l.*, (SELECT count(*)::int FROM vehicles v WHERE v.home_plant_id = l.id AND v.archived_at IS NULL) AS vehicles,
              (SELECT count(*)::int FROM trips t WHERE t.origin_location_id = l.id AND t.status IN ('DISPATCHED','IN_TRANSIT','DELAYED','ON_HOLD','ARRIVED','DELIVERED','RETURNING')) AS active_trips_out,
              (SELECT count(*)::int FROM trips t WHERE t.origin_location_id = l.id AND t.status IN ('DRAFT','PLANNED','ASSIGNED')) AS upcoming_trips
         FROM locations l WHERE ${w} ORDER BY ${orderBy(p.sort, p.dir, { name: 'l.name', type: 'l.type', region: 'l.region' }, 'l.type, l.name')} LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total FROM locations l WHERE ${w}`, r),
  ]);
  res.json(listResponse(rows, total, p.page, p.pageSize));
}));

locationsRouter.get('/:id', requirePerm('locations:view'), wrap(async (req, res) => {
  const lid = id(req);
  const l = await q1('SELECT * FROM locations WHERE id = :id', { id: lid });
  if (!l) throw notFound('Location');
  const [vehicles, trips, stats] = await Promise.all([
    q(`SELECT id, code, status, capacity_mt, fleet_type FROM vehicles WHERE home_plant_id = :id AND archived_at IS NULL ORDER BY code`, { id: lid }),
    q(`SELECT t.id, t.code, t.status, t.scheduled_departure, dl.name AS destination_name, t.planned_load_mt FROM trips t JOIN locations dl ON dl.id = t.destination_location_id
        WHERE t.origin_location_id = :id ORDER BY t.scheduled_departure DESC LIMIT 10`, { id: lid }),
    q1(`SELECT count(*) FILTER (WHERE status = 'COMPLETED' AND completed_at >= now() - interval '30 days')::int AS dispatched_30d,
               COALESCE(sum(delivered_mt) FILTER (WHERE status = 'COMPLETED' AND completed_at >= now() - interval '30 days'), 0)::float AS lpg_mt_30d
          FROM trips WHERE origin_location_id = :id`, { id: lid }),
  ]);
  res.json({ location: l, vehicles, trips, stats });
}));

locationsRouter.post('/', requirePerm('locations:manage'), wrap(async (req, res) => {
  const b = parse(locBody, req.body);
  if (await q1('SELECT 1 AS x FROM locations WHERE lower(code) = lower(:c)', { c: b.code })) throw conflict('A location with this code already exists.');
  const row = await q1(
    `INSERT INTO locations (code, name, type, city, region, address, lat, lng, storage_capacity_mt, contact_phone, status)
     VALUES (:code, :name, :type, :city, :region, :addr, :lat, :lng, :cap, :ph, :st) RETURNING *`,
    { code: b.code.toUpperCase(), name: b.name, type: b.type, city: b.city ?? null, region: b.region, addr: b.address ?? null, lat: b.lat, lng: b.lng, cap: b.storageCapacityMt ?? null, ph: b.contactPhone ?? null, st: b.status ?? 'ACTIVE' },
  );
  await audit(req, { action: 'CREATE', entityType: 'LOCATION', entityId: row.id, entityLabel: row.name });
  res.status(201).json({ location: row });
}));

locationsRouter.patch('/:id', requirePerm('locations:manage'), wrap(async (req, res) => {
  const lid = id(req);
  const b = parse(locBody.partial(), req.body);
  const cur = await q1<any>('SELECT * FROM locations WHERE id = :id', { id: lid });
  if (!cur) throw notFound('Location');
  const cols: Record<string, string> = { name: 'name', type: 'type', city: 'city', region: 'region', address: 'address', lat: 'lat', lng: 'lng', storageCapacityMt: 'storage_capacity_mt', contactPhone: 'contact_phone', status: 'status' };
  const sets: string[] = []; const r: Record<string, unknown> = { id: lid };
  for (const [k, c] of Object.entries(cols)) if ((b as any)[k] !== undefined) { sets.push(`${c} = :${c}`); r[c] = (b as any)[k]; }
  if (sets.length) {
    await exec(`UPDATE locations SET ${sets.join(', ')}, updated_at = now() WHERE id = :id`, r);
    if (b.lat !== undefined || b.lng !== undefined) await exec('DELETE FROM routes r WHERE (origin_location_id = :id OR destination_location_id = :id) AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.route_id = r.id)', { id: lid });
  }
  await audit(req, { action: 'UPDATE', entityType: 'LOCATION', entityId: lid, entityLabel: cur.name });
  res.json({ location: await q1('SELECT * FROM locations WHERE id = :id', { id: lid }) });
}));

// ---------------- Distributors ----------------

const distBody = z.object({
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(3).max(150),
  city: z.string().trim().min(2).max(80),
  region: z.enum(REGIONS),
  address: z.string().trim().max(250).optional().nullable(),
  contactName: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  status: z.enum(['ACTIVE', 'ON_HOLD', 'INACTIVE']).optional(),
  creditStatus: z.enum(['GOOD', 'WATCH', 'BLOCKED']).optional(),
  customerType: z.enum(CUSTOMER_TYPES).optional(),
  creditLimitPkr: z.coerce.number().min(0).max(1e12).optional(),
  creditAlertPct: z.coerce.number().int().min(1).max(100).optional(),
  whatsapp: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().max(120).optional().nullable(),
  ntn: z.string().trim().max(30).optional().nullable(),
});

distributorsRouter.get('/', requirePerm('distributors:view', 'trips:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ region: z.string().optional(), status: z.string().optional(), compact: z.string().optional(), customerType: z.string().optional() }), req.query);
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (p.q) { where.push('(d.name ILIKE :q OR d.code ILIKE :q OR d.city ILIKE :q OR d.contact_name ILIKE :q)'); r.q = likeTerm(p.q); }
  if (f.region) { where.push('d.region = :region'); r.region = f.region; }
  if (f.status) { where.push('d.status = :status'); r.status = f.status; }
  if (f.customerType) { where.push('d.customer_type = :ctype'); r.ctype = f.customerType; }
  const w = where.join(' AND ');
  const showBal = can(req.user!.role, 'sales:view');
  if (f.compact) { // typeahead source for the trip wizard
    const rows = await q(`SELECT d.id, d.code, d.name, d.city, d.region, d.status, d.location_id FROM distributors d WHERE ${w} AND d.status = 'ACTIVE' ORDER BY d.name LIMIT 30`, r);
    return res.json({ data: rows });
  }
  const [rows, [{ total }]] = await Promise.all([
    q(`SELECT d.*, l.lat, l.lng, s.trips_total, s.mt_total, s.last_delivery${showBal ? `, COALESCE(b.bal, 0)::float AS balance` : ''}
         FROM distributors d JOIN locations l ON l.id = d.location_id${showBal ? ` LEFT JOIN LATERAL (SELECT sum(x.debit - x.credit) AS bal FROM party_balances x WHERE x.party_type = 'CUSTOMER' AND x.party_id = d.id AND x.account_id = (SELECT id FROM accounts WHERE system_key = 'receivable')) b ON true` : ''}
         LEFT JOIN LATERAL (SELECT count(DISTINCT s.trip_id)::int AS trips_total, COALESCE(sum(s.delivered_mt),0)::float AS mt_total, max(s.delivered_at) AS last_delivery
                              FROM trip_stops s JOIN trips t ON t.id = s.trip_id WHERE s.distributor_id = d.id AND t.status = 'COMPLETED' AND s.status = 'DELIVERED') s ON true
        WHERE ${w} ORDER BY ${orderBy(p.sort, p.dir, { name: 'd.name', code: 'd.code', region: 'd.region', city: 'd.city', trips: 's.trips_total', volume: 's.mt_total' }, 'd.name')} LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total FROM distributors d WHERE ${w}`, r),
  ]);
  res.json(listResponse(rows, total, p.page, p.pageSize));
}));

distributorsRouter.get('/:id', requirePerm('distributors:view'), wrap(async (req, res) => {
  const did = id(req);
  const d = await q1(`SELECT d.*, l.lat, l.lng FROM distributors d JOIN locations l ON l.id = d.location_id WHERE d.id = :id`, { id: did });
  if (!d) throw notFound('Distributor');
  const [trips, stats, byMonth] = await Promise.all([
    // Stop-based so a distributor served on a multi-drop trip sees only its own drop (quantity and date), not the whole load.
    q(`SELECT t.id, t.code, t.status, t.scheduled_departure, s.planned_mt AS planned_load_mt, s.delivered_mt, t.stop_count, o.name AS origin_name, v.code AS vehicle_code
         FROM trip_stops s JOIN trips t ON t.id = s.trip_id JOIN locations o ON o.id = t.origin_location_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
        WHERE s.distributor_id = :id ORDER BY t.scheduled_departure DESC LIMIT 15`, { id: did }),
    q1(`SELECT count(*) FILTER (WHERE t.status = 'COMPLETED')::int AS completed, count(*) FILTER (WHERE t.status NOT IN ('COMPLETED','CANCELLED'))::int AS open,
               COALESCE(sum(s.delivered_mt),0)::float AS mt_total, COALESCE(round(avg(t.delay_minutes) FILTER (WHERE t.status = 'COMPLETED')),0)::int AS avg_delay_min
          FROM trip_stops s JOIN trips t ON t.id = s.trip_id WHERE s.distributor_id = :id`, { id: did }),
    q(`SELECT to_char(date_trunc('month', s.delivered_at), 'Mon YY') AS month, sum(s.delivered_mt)::float AS mt FROM trip_stops s
        WHERE s.distributor_id = :id AND s.status = 'DELIVERED' AND s.delivered_at >= date_trunc('month', now()) - interval '5 months' GROUP BY 1, date_trunc('month', s.delivered_at) ORDER BY date_trunc('month', s.delivered_at)`, { id: did }),
  ]);
  res.json({ distributor: d, trips, stats, monthly: byMonth });
}));

distributorsRouter.post('/', requirePerm('distributors:manage'), wrap(async (req, res) => {
  const b = parse(distBody, req.body);
  if (await q1('SELECT 1 AS x FROM distributors WHERE lower(code) = lower(:c)', { c: b.code })) throw conflict('A distributor with this code already exists.');
  const row = await sequelize.transaction(async (tx) => {
    const loc = await q1<any>(
      `INSERT INTO locations (code, name, type, city, region, address, lat, lng, contact_phone) VALUES (:code, :name, 'DISTRIBUTOR', :city, :region, :addr, :lat, :lng, :ph) RETURNING id`,
      { code: `LOC-${b.code.toUpperCase()}`.slice(0, 30), name: b.name, city: b.city, region: b.region, addr: b.address ?? null, lat: b.lat, lng: b.lng, ph: b.phone ?? null }, tx);
    return q1<any>(
      `INSERT INTO distributors (code, name, city, region, address, contact_name, phone, location_id, status, credit_status, customer_type, credit_limit_pkr, credit_alert_pct, whatsapp, email, ntn)
       VALUES (:code, :name, :city, :region, :addr, :cn, :ph, :loc, :st, :cs, :ct, :cl, :ca, :wa, :em, :ntn) RETURNING *`,
      { code: b.code.toUpperCase(), name: b.name, city: b.city, region: b.region, addr: b.address ?? null, cn: b.contactName ?? null, ph: b.phone ?? null, loc: loc.id, st: b.status ?? 'ACTIVE', cs: b.creditStatus ?? 'GOOD',
        ct: b.customerType ?? 'DISTRIBUTOR', cl: b.creditLimitPkr ?? 0, ca: b.creditAlertPct ?? 80, wa: b.whatsapp ?? null, em: b.email ?? null, ntn: b.ntn ?? null }, tx);
  });
  await audit(req, { action: 'CREATE', entityType: 'DISTRIBUTOR', entityId: row.id, entityLabel: row.name });
  res.status(201).json({ distributor: row });
}));

distributorsRouter.patch('/:id', requirePerm('distributors:manage'), wrap(async (req, res) => {
  const did = id(req);
  const b = parse(distBody.partial(), req.body);
  const cur = await q1<any>('SELECT * FROM distributors WHERE id = :id', { id: did });
  if (!cur) throw notFound('Distributor');
  const cols: Record<string, string> = { name: 'name', city: 'city', region: 'region', address: 'address', contactName: 'contact_name', phone: 'phone', status: 'status', creditStatus: 'credit_status', customerType: 'customer_type', creditLimitPkr: 'credit_limit_pkr', creditAlertPct: 'credit_alert_pct', whatsapp: 'whatsapp', email: 'email', ntn: 'ntn' };
  const sets: string[] = []; const r: Record<string, unknown> = { id: did };
  for (const [k, c] of Object.entries(cols)) if ((b as any)[k] !== undefined) { sets.push(`${c} = :${c}`); r[c] = (b as any)[k]; }
  if (sets.length) await exec(`UPDATE distributors SET ${sets.join(', ')}, updated_at = now() WHERE id = :id`, r);
  if (b.name || b.lat !== undefined || b.lng !== undefined)
    await exec(`UPDATE locations SET name = COALESCE(:n, name), lat = COALESCE(:lat, lat), lng = COALESCE(:lng, lng), updated_at = now() WHERE id = :loc`, { n: b.name ?? null, lat: b.lat ?? null, lng: b.lng ?? null, loc: cur.location_id });
  await audit(req, { action: 'UPDATE', entityType: 'DISTRIBUTOR', entityId: did, entityLabel: cur.name });
  res.json({ distributor: await q1('SELECT * FROM distributors WHERE id = :id', { id: did }) });
}));

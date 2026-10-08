import { Router } from 'express';
import { z } from 'zod';
import { FUEL_STATUSES, PAYMENT_MODES } from '@gasman/shared';
import { q, q1, exec } from '../db/sequelize';
import { notFound } from '../lib/errors';
import { id, likeTerm, listResponse, orderBy, paging, parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';
import { recordFuel } from '../services/fuel';

export const fuelRouter = Router();

fuelRouter.get('/', requirePerm('fuel:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ status: z.string().optional(), vehicleId: z.coerce.number().optional(), tripId: z.coerce.number().optional(), from: z.string().optional(), to: z.string().optional() }), req.query);
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (f.status) { where.push('f.status IN (:st)'); r.st = f.status.split(','); }
  if (f.vehicleId) { where.push('f.vehicle_id = :v'); r.v = f.vehicleId; }
  if (f.tripId) { where.push('f.trip_id = :t'); r.t = f.tripId; }
  if (f.from) { where.push('f.fueled_at >= :from'); r.from = f.from; }
  if (f.to) { where.push('f.fueled_at < (:to::date + 1)'); r.to = f.to; }
  if (req.user!.role === 'DRIVER') { where.push('f.driver_id = :me'); r.me = req.user!.driverId ?? -1; }
  if (p.q) { where.push('(v.code ILIKE :q OR t.code ILIKE :q OR f.station ILIKE :q OR f.receipt_no ILIKE :q)'); r.q = likeTerm(p.q); }
  const w = where.join(' AND ');
  const from = `FROM fuel_entries f JOIN vehicles v ON v.id = f.vehicle_id LEFT JOIN trips t ON t.id = f.trip_id LEFT JOIN drivers d ON d.id = f.driver_id WHERE ${w}`;
  const [rows, [{ total }], [sum]] = await Promise.all([
    q(`SELECT f.*, v.code AS vehicle_code, t.code AS trip_code, d.full_name AS driver_name ${from}
        ORDER BY ${orderBy(p.sort, p.dir, { date: 'f.fueled_at', litres: 'f.litres', amount: 'f.amount', kmpl: 'f.kmpl', vehicle: 'v.code' }, 'f.fueled_at DESC')} LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total ${from}`, r),
    q(`SELECT COALESCE(sum(f.litres),0)::float AS litres, COALESCE(sum(f.amount),0)::float AS amount, COALESCE(round(avg(f.kmpl) FILTER (WHERE f.kmpl IS NOT NULL), 2),0)::float AS avg_kmpl,
              count(*) FILTER (WHERE f.status = 'FLAGGED')::int AS flagged, COALESCE(round(avg(f.rate_per_l), 1),0)::float AS avg_rate ${from}`, r),
  ]);
  res.json({ ...listResponse(rows, total, p.page, p.pageSize), summary: sum });
}));

/** Fuel Intelligence: efficiency per vehicle, daily price trend, spend by month. */
fuelRouter.get('/analytics', requirePerm('fuel:view'), wrap(async (_req, res) => {
  const [vehicles, trend, monthly] = await Promise.all([
    q(`SELECT v.code, v.fuel_norm_kmpl::float AS norm, round(avg(f.kmpl), 2)::float AS kmpl, round(sum(f.amount) / NULLIF(sum(f.km_since_last), 0), 1)::float AS cost_per_km, sum(f.litres)::float AS litres, count(*)::int AS fills,
              count(*) FILTER (WHERE f.status = 'FLAGGED')::int AS flagged
         FROM fuel_entries f JOIN vehicles v ON v.id = f.vehicle_id WHERE f.fueled_at > now() - interval '90 days' AND v.archived_at IS NULL GROUP BY v.id HAVING count(*) > 0 ORDER BY kmpl ASC NULLS LAST LIMIT 15`),
    q(`SELECT to_char(date_trunc('week', fueled_at), 'DD Mon') AS label, round(avg(rate_per_l), 1)::float AS rate, sum(litres)::float AS litres FROM fuel_entries WHERE fueled_at > now() - interval '90 days' GROUP BY date_trunc('week', fueled_at) ORDER BY date_trunc('week', fueled_at)`),
    q(`SELECT to_char(date_trunc('month', fueled_at), 'Mon YY') AS label, sum(amount)::float AS amount FROM fuel_entries WHERE fueled_at > now() - interval '6 months' GROUP BY date_trunc('month', fueled_at) ORDER BY date_trunc('month', fueled_at)`),
  ]);
  res.json({ vehicles, trend, monthly });
}));

const body = z.object({
  vehicleId: z.coerce.number().int().positive(), tripId: z.coerce.number().int().positive().optional(),
  station: z.string().trim().max(120).optional(), litres: z.coerce.number().positive('Enter litres filled.').max(2000), ratePerL: z.coerce.number().positive('Enter the rate per litre.').max(2000),
  odometerKm: z.coerce.number().int().min(0).max(5_000_000).optional(), paymentMode: z.enum(PAYMENT_MODES).default('CASH'),
  receiptNo: z.string().trim().max(40).optional(), fueledAt: z.string().optional(),
});

fuelRouter.post('/', requirePerm('fuel:record'), wrap(async (req, res) => {
  const b = parse(body, req.body);
  const row = await recordFuel(req.user!, req, b);
  res.status(201).json({ fuel: row });
}));

fuelRouter.post('/:id/review', requirePerm('fuel:manage'), wrap(async (req, res) => {
  const fid = id(req);
  const b = parse(z.object({ note: z.string().trim().min(3, 'Add a short review note.').max(250), accept: z.boolean() }), req.body);
  const f = await q1<any>('SELECT f.*, v.code AS vehicle_code FROM fuel_entries f JOIN vehicles v ON v.id = f.vehicle_id WHERE f.id = :id', { id: fid });
  if (!f) throw notFound('Fuel entry');
  await exec(`UPDATE fuel_entries SET status = 'REVIEWED', reviewed_by = :u, review_note = :n WHERE id = :id`, { u: req.user!.id, n: `${b.accept ? 'Accepted' : 'Disputed'}: ${b.note}`, id: fid });
  if (!b.accept) await exec(`UPDATE trip_expenses SET status = 'REJECTED', decided_by = :u, decided_at = now(), decision_note = :n WHERE fuel_entry_id = :id AND status = 'SUBMITTED'`, { u: req.user!.id, n: b.note, id: fid });
  await audit(req, { action: 'FUEL_REVIEWED', entityType: 'VEHICLE', entityId: f.vehicle_id, entityLabel: `${f.vehicle_code}: ${b.accept ? 'accepted' : 'disputed'}` });
  res.json({ ok: true });
}));
export const _fs = FUEL_STATUSES;

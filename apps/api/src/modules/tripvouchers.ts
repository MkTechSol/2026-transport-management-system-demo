import { Router } from 'express';
import { z } from 'zod';
import { userCan } from '../services/roles';
import { q } from '../db/sequelize';
import { notFound } from '../lib/errors';
import { parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';

/** Old-system "Trip Voucher" menu: trip start, uplifting voucher, trip expense voucher, tour stay details and trip completion — registers and driver summaries. */
export const tripVouchersRouter = Router();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
type Col = { key: string; label: string; type?: 'money' | 'date' | 'num' | 'text' | 'pct' };
interface Report { title: string; subtitle?: string; columns: Col[]; rows: any[]; totals?: Record<string, number | string> }
interface P extends Record<string, unknown> { from: string; to: string; vehicleId?: number; driverId?: number; finance: boolean; expenses: boolean }
const sum = (rows: any[], k: string) => Math.round(rows.reduce((s, r) => s + Number(r[k] ?? 0), 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const vf = (p: P, col = 't.vehicle_id') => (p.vehicleId ? `AND ${col} = :vehicleId` : '');
const df = (p: P, col = 't.driver_id') => (p.driverId ? `AND ${col} = :driverId` : '');
const D = (col: string) => `(${col} AT TIME ZONE 'Asia/Karachi')::date`;

const REPORTS: Record<string, { title: string; group: string; perm?: 'expenses'; run: (p: P) => Promise<Report> }> = {
  'trip-start': { title: 'Trip start vouchers', group: 'Trip vouchers', run: async (p) => {
    const rows = await q(`SELECT ${D('t.departed_at')} AS date, t.code, CASE t.trip_type WHEN 'UPLIFTING' THEN 'Uplifting' ELSE 'Delivery' END AS kind, v.code AS vehicle, dr.full_name AS driver, o.name AS origin, COALESCE(d.name, dl.name) AS destination,
        t.odometer_start AS start_km, t.loaded_mt::float AS loaded_mt, COALESCE(t.uplift_voucher_no, '') AS uplift_no
      FROM trips t JOIN locations o ON o.id = t.origin_location_id LEFT JOIN locations dl ON dl.id = t.destination_location_id LEFT JOIN distributors d ON d.id = t.distributor_id LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers dr ON dr.id = t.driver_id
      WHERE t.departed_at IS NOT NULL AND ${D('t.departed_at')} BETWEEN :from AND :to ${vf(p)} ${df(p)} ORDER BY t.departed_at DESC`, p);
    return { title: 'Trip start vouchers', subtitle: `${p.from} to ${p.to} · one voucher per departure`, columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'code', label: 'Trip' }, { key: 'kind', label: 'Type' }, { key: 'vehicle', label: 'Bowzer' }, { key: 'driver', label: 'Driver' }, { key: 'origin', label: 'From' }, { key: 'destination', label: 'To' }, { key: 'start_km', label: 'Meter at start', type: 'num' }, { key: 'loaded_mt', label: 'Loaded MT', type: 'num' }, { key: 'uplift_no', label: 'Uplift voucher' }], rows, totals: { loaded_mt: sum(rows, 'loaded_mt') } };
  } },
  'uplifting': { title: 'Uplifting vouchers', group: 'Trip vouchers', run: async (p) => {
    const rows = await q(`SELECT ${D('COALESCE(t.departed_at, t.scheduled_departure)')} AS date, COALESCE(t.uplift_voucher_no, '—') AS uplift_no, t.code, o.name AS field, COALESCE(dl.name, '') AS plant, v.code AS vehicle, dr.full_name AS driver,
        t.loaded_mt::float AS loaded_mt, t.delivered_mt::float AS delivered_mt, (t.loaded_mt - t.delivered_mt)::float AS shortage_mt, t.status
      FROM trips t JOIN locations o ON o.id = t.origin_location_id LEFT JOIN locations dl ON dl.id = t.destination_location_id LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers dr ON dr.id = t.driver_id
      WHERE t.trip_type = 'UPLIFTING' AND ${D('COALESCE(t.departed_at, t.scheduled_departure)')} BETWEEN :from AND :to ${vf(p)} ${df(p)} ORDER BY COALESCE(t.departed_at, t.scheduled_departure) DESC`, p);
    return { title: 'Uplifting vouchers', subtitle: `${p.from} to ${p.to} · gas field → plant`, columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'uplift_no', label: 'Voucher no.' }, { key: 'code', label: 'Trip' }, { key: 'field', label: 'Field' }, { key: 'plant', label: 'Plant' }, { key: 'vehicle', label: 'Bowzer' }, { key: 'driver', label: 'Driver' }, { key: 'loaded_mt', label: 'Loaded MT', type: 'num' }, { key: 'delivered_mt', label: 'Received MT', type: 'num' }, { key: 'shortage_mt', label: 'Shortage MT', type: 'num' }, { key: 'status', label: 'Status' }], rows, totals: { loaded_mt: sum(rows, 'loaded_mt'), delivered_mt: sum(rows, 'delivered_mt'), shortage_mt: sum(rows, 'shortage_mt') } };
  } },
  'trip-expense': { title: 'Trip expense vouchers', group: 'Trip vouchers', perm: 'expenses', run: async (p) => {
    const rows = await q(`SELECT x.incurred_on AS date, COALESCE(vo.voucher_no, '—') AS voucher_no, t.code, v.code AS vehicle, dr.full_name AS driver, x.category, COALESCE(x.description, '') AS description, x.amount::float AS amount, x.status
      FROM trip_expenses x JOIN trips t ON t.id = x.trip_id LEFT JOIN vehicles v ON v.id = x.vehicle_id LEFT JOIN drivers dr ON dr.id = x.driver_id LEFT JOIN vouchers vo ON vo.id = x.voucher_id
      WHERE x.incurred_on BETWEEN :from AND :to ${vf(p, 'x.vehicle_id')} ${df(p, 'x.driver_id')} ORDER BY x.incurred_on DESC, x.id DESC`, p);
    return { title: 'Trip expense vouchers', subtitle: `${p.from} to ${p.to}`, columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'voucher_no', label: 'Ledger voucher' }, { key: 'code', label: 'Trip' }, { key: 'vehicle', label: 'Bowzer' }, { key: 'driver', label: 'Driver' }, { key: 'category', label: 'Category' }, { key: 'description', label: 'Details' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'status', label: 'Status' }], rows, totals: { amount: sum(rows, 'amount') } };
  } },
  'tour-stay': { title: 'Tour stay details', group: 'Trip vouchers', perm: 'expenses', run: async (p) => {
    const rows = await q(`SELECT x.incurred_on AS date, t.code, dr.full_name AS driver, v.code AS vehicle, COALESCE(x.nights, 0)::int AS nights, COALESCE(x.description, '') AS place, x.amount::float AS amount, (x.amount / NULLIF(x.nights, 0))::float AS per_night, x.status
      FROM trip_expenses x JOIN trips t ON t.id = x.trip_id LEFT JOIN vehicles v ON v.id = x.vehicle_id LEFT JOIN drivers dr ON dr.id = x.driver_id
      WHERE x.category = 'TOUR_STAY' AND x.incurred_on BETWEEN :from AND :to ${vf(p, 'x.vehicle_id')} ${df(p, 'x.driver_id')} ORDER BY x.incurred_on DESC`, p);
    return { title: 'Tour stay details', subtitle: `${p.from} to ${p.to} · nights away from base`, columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'code', label: 'Trip' }, { key: 'driver', label: 'Driver' }, { key: 'vehicle', label: 'Bowzer' }, { key: 'place', label: 'Stay / place' }, { key: 'nights', label: 'Nights', type: 'num' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'per_night', label: 'Per night', type: 'money' }, { key: 'status', label: 'Status' }], rows, totals: { nights: sum(rows, 'nights'), amount: sum(rows, 'amount') } };
  } },
  'trip-completion': { title: 'Trip completion', group: 'Trip vouchers', run: async (p) => {
    const rows = await q(`SELECT ${D('t.completed_at')} AS date, t.code, CASE t.trip_type WHEN 'UPLIFTING' THEN 'Uplifting' ELSE 'Delivery' END AS kind, v.code AS vehicle, dr.full_name AS driver, COALESCE(d.name, dl.name) AS destination, t.odometer_start AS start_km, t.odometer_end AS end_km, (t.odometer_end - t.odometer_start) AS km,
        t.delivered_mt::float AS delivered_mt, COALESCE(e.amt, 0)::float AS expenses, (COALESCE(t.delivered_mt, 0) * t.freight_per_mt)::float AS income, ((COALESCE(t.delivered_mt, 0) * t.freight_per_mt) - COALESCE(e.amt, 0))::float AS profit
      FROM trips t LEFT JOIN locations dl ON dl.id = t.destination_location_id LEFT JOIN distributors d ON d.id = t.distributor_id LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers dr ON dr.id = t.driver_id
      LEFT JOIN LATERAL (SELECT sum(amount) AS amt FROM trip_expenses WHERE trip_id = t.id AND status IN ('APPROVED','REIMBURSED')) e ON true
      WHERE t.status = 'COMPLETED' AND ${D('t.completed_at')} BETWEEN :from AND :to ${vf(p)} ${df(p)} ORDER BY t.completed_at DESC`, p);
    const cols: Col[] = [{ key: 'date', label: 'Date', type: 'date' }, { key: 'code', label: 'Trip' }, { key: 'kind', label: 'Type' }, { key: 'vehicle', label: 'Bowzer' }, { key: 'driver', label: 'Driver' }, { key: 'destination', label: 'Destination' }, { key: 'start_km', label: 'Start km', type: 'num' }, { key: 'end_km', label: 'End km', type: 'num' }, { key: 'km', label: 'Distance km', type: 'num' }, { key: 'delivered_mt', label: 'MT', type: 'num' }, { key: 'expenses', label: 'Expenses', type: 'money' }];
    if (p.finance) cols.push({ key: 'income', label: 'Freight income', type: 'money' }, { key: 'profit', label: 'Profit', type: 'money' });
    const out = p.finance ? rows : rows.map(({ income, profit, ...r }: any) => r);
    return { title: 'Trip completion', subtitle: `${p.from} to ${p.to}`, columns: cols, rows: out, totals: { km: sum(out, 'km'), delivered_mt: sum(out, 'delivered_mt'), expenses: sum(out, 'expenses'), ...(p.finance ? { income: sum(out, 'income'), profit: sum(out, 'profit') } : {}) } };
  } },
  'delivery-points': { title: 'Delivery points (POD register)', group: 'Trip vouchers', run: async (p) => {
    const rows = await q(`SELECT ${D('t.scheduled_departure')} AS date, t.code, s.seq, t.stop_count, l.name AS place, COALESCE(c.name, '') AS customer, v.code AS vehicle, s.status,
        s.planned_mt::float AS planned_mt, COALESCE(s.delivered_mt, 0)::float AS delivered_mt, COALESCE(s.received_by, '') AS received_by, COALESCE(s.delivery_note_no, '') AS dn_no
      FROM trip_stops s JOIN trips t ON t.id = s.trip_id JOIN locations l ON l.id = s.location_id LEFT JOIN distributors c ON c.id = s.distributor_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
      WHERE t.stop_count > 1 AND t.status <> 'CANCELLED' AND ${D('t.scheduled_departure')} BETWEEN :from AND :to ${vf(p)} ${df(p)} ORDER BY t.scheduled_departure DESC, t.id, s.seq`, p);
    return { title: 'Delivery points (POD register)', subtitle: `${p.from} to ${p.to} · one row per drop on multi-stop trips`, columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'code', label: 'Trip' }, { key: 'seq', label: 'Stop', type: 'num' }, { key: 'place', label: 'Delivery point' }, { key: 'customer', label: 'Customer' }, { key: 'vehicle', label: 'Bowzer' }, { key: 'status', label: 'Status' }, { key: 'planned_mt', label: 'Planned MT', type: 'num' }, { key: 'delivered_mt', label: 'Delivered MT', type: 'num' }, { key: 'received_by', label: 'Received by' }, { key: 'dn_no', label: 'DN no.' }], rows, totals: { planned_mt: sum(rows, 'planned_mt'), delivered_mt: sum(rows, 'delivered_mt') } };
  } },
  'driver-summary': { title: 'Driver trip summary', group: 'Summaries', run: async (p) => {
    const rows = await q(`SELECT dr.employee_id AS code, dr.full_name AS driver, count(*) FILTER (WHERE t.status = 'COMPLETED')::int AS trips, COALESCE(sum(t.odometer_end - t.odometer_start) FILTER (WHERE t.status = 'COMPLETED'), 0)::int AS km, COALESCE(sum(t.delivered_mt) FILTER (WHERE t.status = 'COMPLETED'), 0)::float AS mt,
        COALESCE((SELECT sum(x.nights) FROM trip_expenses x WHERE x.driver_id = dr.id AND x.category = 'TOUR_STAY' AND x.incurred_on BETWEEN :from AND :to), 0)::int AS nights_away, COALESCE(round(avg(t.delay_minutes) FILTER (WHERE t.status = 'COMPLETED')), 0)::int AS avg_delay_min
      FROM drivers dr JOIN trips t ON t.driver_id = dr.id AND ${D('COALESCE(t.completed_at, t.scheduled_departure)')} BETWEEN :from AND :to WHERE 1=1 ${df(p, 'dr.id')} GROUP BY dr.id ORDER BY trips DESC`, p);
    return { title: 'Driver trip summary', subtitle: `${p.from} to ${p.to}`, columns: [{ key: 'code', label: 'ID' }, { key: 'driver', label: 'Driver' }, { key: 'trips', label: 'Completed trips', type: 'num' }, { key: 'km', label: 'Distance km', type: 'num' }, { key: 'mt', label: 'MT hauled', type: 'num' }, { key: 'nights_away', label: 'Nights away', type: 'num' }, { key: 'avg_delay_min', label: 'Avg delay (min)', type: 'num' }], rows, totals: { trips: sum(rows, 'trips'), km: sum(rows, 'km'), mt: sum(rows, 'mt'), nights_away: sum(rows, 'nights_away') } };
  } },
};

tripVouchersRouter.get('/reports', requirePerm('trips:view'), wrap(async (req, res) => {
  const ex = userCan(req.user!, 'expenses:view');
  res.json({ data: Object.entries(REPORTS).filter(([, r]) => !r.perm || ex).map(([key, r]) => ({ key, title: r.title, group: r.group })) });
}));
tripVouchersRouter.get('/reports/:key', requirePerm('trips:view'), wrap(async (req, res) => {
  const def = REPORTS[String(req.params.key)]; if (!def) throw notFound('Report');
  if (def.perm === 'expenses' && !userCan(req.user!, 'expenses:view')) throw notFound('Report');
  const f = parse(z.object({ from: dateStr.optional(), to: dateStr.optional(), vehicleId: z.coerce.number().optional(), driverId: z.coerce.number().optional() }), req.query);
  const own = req.user!.role === 'DRIVER' ? req.user!.driverId ?? -1 : f.driverId;
  const to = f.to ?? today(); const from = f.from ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  res.json(await def.run({ from, to, vehicleId: f.vehicleId, driverId: own, finance: userCan(req.user!, 'finance:view'), expenses: userCan(req.user!, 'expenses:view') }));
}));

import { Router } from 'express';
import { z } from 'zod';
import { can, Permission } from '@gasman/shared';
import { q } from '../db/sequelize';
import { forbidden, badRequest } from '../lib/errors';
import { listResponse, paging, parse, wrap } from '../lib/http';
import { docStatusSql, currentDocSql } from '../lib/sql';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';

export const reportsRouter = Router();

interface Filters { from: string; to: string; plantId?: number; vehicleId?: number; driverId?: number; destinationId?: number; region?: string; status?: string }
interface Col { key: string; label: string; type?: 'text' | 'number' | 'date' | 'datetime' | 'status' | 'percent' }
interface Def { perm?: Permission; title: string; description: string; columns: Col[]; build: (f: Filters) => { sql: string; r: Record<string, unknown>; order: string } }

const iso = (d: Date) => d.toISOString().slice(0, 10);

function tripWhere(f: Filters, alias = 't', dateCol = 'scheduled_departure') {
  const w = [`${alias}.${dateCol} >= :from`, `${alias}.${dateCol} < (:to::date + 1)`];
  const r: Record<string, unknown> = { from: f.from, to: f.to };
  if (f.plantId) { w.push(`${alias}.origin_location_id = :plant`); r.plant = f.plantId; }
  if (f.vehicleId) { w.push(`${alias}.vehicle_id = :veh`); r.veh = f.vehicleId; }
  if (f.driverId) { w.push(`${alias}.driver_id = :drv`); r.drv = f.driverId; }
  if (f.destinationId) { w.push(`${alias}.destination_location_id = :dest`); r.dest = f.destinationId; }
  if (f.region) { w.push('dl.region = :region'); r.region = f.region; }
  if (f.status) { w.push(`${alias}.status IN (:status)`); r.status = f.status.split(','); }
  return { where: w.join(' AND '), r };
}
const TRIP_FROM = `FROM trips t JOIN locations o ON o.id = t.origin_location_id JOIN locations dl ON dl.id = t.destination_location_id LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id LEFT JOIN distributors di ON di.id = t.distributor_id`;

const DEFS: Record<string, Def> = {
  trips: {
    title: 'Trip Report', description: 'All trips in the period with route, assignment, load and timing.',
    columns: [{ key: 'code', label: 'Trip' }, { key: 'status', label: 'Status', type: 'status' }, { key: 'scheduled_departure', label: 'Departure', type: 'datetime' }, { key: 'origin', label: 'Origin' }, { key: 'destination', label: 'Destination' },
      { key: 'distributor', label: 'Distributor' }, { key: 'vehicle', label: 'Vehicle' }, { key: 'driver', label: 'Driver' }, { key: 'planned_load_mt', label: 'Planned MT', type: 'number' }, { key: 'delivered_mt', label: 'Delivered MT', type: 'number' }, { key: 'delay_minutes', label: 'Delay (min)', type: 'number' }],
    build: (f) => { const { where, r } = tripWhere(f); return { r, order: 'scheduled_departure DESC',
      sql: `SELECT t.code, t.status, t.scheduled_departure, o.name AS origin, dl.name AS destination, di.name AS distributor, v.code AS vehicle, d.full_name AS driver, t.planned_load_mt, t.delivered_mt, t.delay_minutes ${TRIP_FROM} WHERE ${where}` }; },
  },
  'completed-trips': {
    title: 'Completed Trips', description: 'Trips completed in the period with delivered quantity and punctuality.',
    columns: [{ key: 'code', label: 'Trip' }, { key: 'completed_at', label: 'Completed', type: 'datetime' }, { key: 'origin', label: 'Origin' }, { key: 'destination', label: 'Destination' }, { key: 'vehicle', label: 'Vehicle' }, { key: 'driver', label: 'Driver' }, { key: 'delivered_mt', label: 'Delivered MT', type: 'number' }, { key: 'delay_minutes', label: 'Delay (min)', type: 'number' }, { key: 'received_by', label: 'Received by' }],
    build: (f) => { const { where, r } = tripWhere({ ...f, status: undefined }, 't', 'completed_at'); return { r, order: 'completed_at DESC',
      sql: `SELECT t.code, t.completed_at, o.name AS origin, dl.name AS destination, v.code AS vehicle, d.full_name AS driver, t.delivered_mt, t.delay_minutes, t.received_by ${TRIP_FROM} WHERE t.status = 'COMPLETED' AND ${where}` }; },
  },
  'delayed-trips': {
    title: 'Delayed Trips', description: 'Trips that arrived more than 15 minutes late or are currently delayed.',
    columns: [{ key: 'code', label: 'Trip' }, { key: 'status', label: 'Status', type: 'status' }, { key: 'scheduled_departure', label: 'Departure', type: 'datetime' }, { key: 'destination', label: 'Destination' }, { key: 'vehicle', label: 'Vehicle' }, { key: 'driver', label: 'Driver' }, { key: 'delay_minutes', label: 'Delay (min)', type: 'number' }],
    build: (f) => { const { where, r } = tripWhere({ ...f, status: undefined }); return { r, order: 'delay_minutes DESC',
      sql: `SELECT t.code, t.status, t.scheduled_departure, dl.name AS destination, v.code AS vehicle, d.full_name AS driver, CASE WHEN t.status = 'DELAYED' THEN GREATEST(t.delay_minutes, 1) ELSE t.delay_minutes END AS delay_minutes
              ${TRIP_FROM} WHERE (t.status = 'DELAYED' OR (t.status = 'COMPLETED' AND t.delay_minutes > 15)) AND ${where}` }; },
  },
  'fleet-utilization': {
    title: 'Fleet Utilization', description: 'Per-vehicle trips, LPG moved and time on the road in the period.',
    columns: [{ key: 'vehicle', label: 'Vehicle' }, { key: 'fleet_type', label: 'Fleet' }, { key: 'capacity_mt', label: 'Capacity MT', type: 'number' }, { key: 'trips', label: 'Trips', type: 'number' }, { key: 'lpg_mt', label: 'LPG moved MT', type: 'number' }, { key: 'busy_hours', label: 'Hours on road', type: 'number' }, { key: 'utilization_pct', label: 'Utilization', type: 'percent' }, { key: 'status', label: 'Status', type: 'status' }],
    build: (f) => { const { where, r } = tripWhere({ ...f, vehicleId: undefined, driverId: undefined, status: undefined }, 't', 'departed_at');
      const vf = f.vehicleId ? 'AND v.id = :veh' : ''; if (f.vehicleId) r.veh = f.vehicleId; if (f.plantId) r.plant = f.plantId; delete (r as any).veh2;
      return { r, order: 'trips DESC, vehicle', sql: `SELECT v.code AS vehicle, v.fleet_type, v.capacity_mt, count(t.id)::int AS trips, COALESCE(sum(t.delivered_mt),0)::float AS lpg_mt,
          round(COALESCE(sum(extract(epoch FROM (COALESCE(t.completed_at, now()) - t.departed_at))/3600),0)::numeric, 1)::float AS busy_hours,
          LEAST(100, round(100 * COALESCE(sum(extract(epoch FROM (COALESCE(t.completed_at, now()) - t.departed_at))/3600),0) / GREATEST(1, ((:to::date - :from::date) + 1) * 24)))::int AS utilization_pct, v.status
        FROM vehicles v LEFT JOIN trips t ON t.vehicle_id = v.id AND t.departed_at IS NOT NULL AND t.departed_at >= :from AND t.departed_at < (:to::date + 1) ${f.plantId ? 'AND t.origin_location_id = :plant' : ''}
        WHERE v.archived_at IS NULL ${vf} GROUP BY v.id` }; },
  },
  'driver-activity': {
    title: 'Driver Activity', description: 'Per-driver trips, LPG delivered, punctuality and incidents in the period.',
    columns: [{ key: 'employee_id', label: 'Employee ID' }, { key: 'driver', label: 'Driver' }, { key: 'trips', label: 'Trips', type: 'number' }, { key: 'lpg_mt', label: 'LPG MT', type: 'number' }, { key: 'on_time_pct', label: 'On-time', type: 'percent' }, { key: 'incidents', label: 'Incidents', type: 'number' }, { key: 'safety_score', label: 'Safety score', type: 'number' }, { key: 'status', label: 'Status', type: 'status' }],
    build: (f) => { const r: Record<string, unknown> = { from: f.from, to: f.to }; if (f.driverId) r.drv = f.driverId; if (f.plantId) r.plant = f.plantId;
      return { r, order: 'trips DESC, driver', sql: `SELECT d.employee_id, d.full_name AS driver, count(t.id) FILTER (WHERE t.status = 'COMPLETED')::int AS trips, COALESCE(sum(t.delivered_mt) FILTER (WHERE t.status = 'COMPLETED'),0)::float AS lpg_mt,
          COALESCE(round(100.0 * count(t.id) FILTER (WHERE t.status = 'COMPLETED' AND t.delay_minutes <= 15) / NULLIF(count(t.id) FILTER (WHERE t.status = 'COMPLETED'),0)),0)::int AS on_time_pct,
          (SELECT count(*)::int FROM incidents i WHERE i.driver_id = d.id AND i.reported_at >= :from AND i.reported_at < (:to::date + 1)) AS incidents, d.safety_score, d.status
        FROM drivers d LEFT JOIN trips t ON t.driver_id = d.id AND t.scheduled_departure >= :from AND t.scheduled_departure < (:to::date + 1) ${f.plantId ? 'AND t.origin_location_id = :plant' : ''}
        WHERE d.archived_at IS NULL ${f.driverId ? 'AND d.id = :drv' : ''} GROUP BY d.id` }; },
  },
  maintenance: {
    title: 'Maintenance Report', description: 'Maintenance jobs scheduled or performed in the period with cost.',
    columns: [{ key: 'vehicle', label: 'Vehicle' }, { key: 'type', label: 'Type' }, { key: 'title', label: 'Job' }, { key: 'status', label: 'Status', type: 'status' }, { key: 'scheduled_on', label: 'Scheduled', type: 'date' }, { key: 'completed_at', label: 'Completed', type: 'datetime' }, { key: 'vendor', label: 'Vendor' }, { key: 'cost_pkr', label: 'Cost (PKR)', type: 'number' }],
    build: (f) => { const r: Record<string, unknown> = { from: f.from, to: f.to }; if (f.vehicleId) r.veh = f.vehicleId; if (f.status) r.status = f.status.split(',');
      return { r, order: 'scheduled_on DESC', sql: `SELECT v.code AS vehicle, m.type, m.title, m.status, m.scheduled_on, m.completed_at, m.vendor, m.cost_pkr FROM maintenance_records m JOIN vehicles v ON v.id = m.vehicle_id
        WHERE m.scheduled_on >= :from AND m.scheduled_on <= :to ${f.vehicleId ? 'AND m.vehicle_id = :veh' : ''} ${f.status ? 'AND m.status IN (:status)' : ''}` }; },
  },
  'document-expiry': {
    title: 'Document Expiry', description: 'Vehicle and driver documents expired or expiring within 60 days (period filters do not apply).',
    columns: [{ key: 'owner_type', label: 'Type' }, { key: 'owner', label: 'Vehicle / Driver' }, { key: 'doc_type', label: 'Document' }, { key: 'doc_number', label: 'Number' }, { key: 'expires_on', label: 'Expires', type: 'date' }, { key: 'days_left', label: 'Days left', type: 'number' }, { key: 'status', label: 'Status', type: 'status' }],
    build: (f) => { const r: Record<string, unknown> = {}; if (f.vehicleId) r.veh = f.vehicleId; if (f.driverId) r.drv = f.driverId;
      return { r, order: 'days_left ASC', sql: `SELECT CASE WHEN d.vehicle_id IS NOT NULL THEN 'Vehicle' ELSE 'Driver' END AS owner_type, COALESCE(v.code, dr.full_name) AS owner, d.doc_type, d.doc_number, d.expires_on, (d.expires_on - CURRENT_DATE)::int AS days_left, ${docStatusSql('d')} AS status
        FROM documents d LEFT JOIN vehicles v ON v.id = d.vehicle_id LEFT JOIN drivers dr ON dr.id = d.driver_id
        WHERE d.expires_on <= CURRENT_DATE + 60 AND COALESCE(v.archived_at, dr.archived_at) IS NULL
          AND ${currentDocSql('d')}
          ${f.vehicleId ? 'AND d.vehicle_id = :veh' : ''} ${f.driverId ? 'AND d.driver_id = :drv' : ''}` }; },
  },
  'dispatch-summary': {
    title: 'Dispatch Summary', description: 'Trips and LPG volume per origin plant and destination region.',
    columns: [{ key: 'plant', label: 'Plant' }, { key: 'region', label: 'Region' }, { key: 'trips', label: 'Trips', type: 'number' }, { key: 'completed', label: 'Completed', type: 'number' }, { key: 'cancelled', label: 'Cancelled', type: 'number' }, { key: 'delayed', label: 'Delayed', type: 'number' }, { key: 'lpg_mt', label: 'LPG delivered MT', type: 'number' }],
    build: (f) => { const { where, r } = tripWhere({ ...f, status: undefined }); return { r, order: 'plant, trips DESC',
      sql: `SELECT o.name AS plant, dl.region, count(*)::int AS trips, count(*) FILTER (WHERE t.status = 'COMPLETED')::int AS completed, count(*) FILTER (WHERE t.status = 'CANCELLED')::int AS cancelled,
              count(*) FILTER (WHERE t.status = 'DELAYED' OR (t.status = 'COMPLETED' AND t.delay_minutes > 15))::int AS delayed, COALESCE(sum(t.delivered_mt),0)::float AS lpg_mt ${TRIP_FROM} WHERE ${where} GROUP BY o.name, dl.region` }; },
  },
  'trip-profitability': {
    perm: 'finance:view', title: 'Trip Profitability', description: 'Freight income, approved expenses and profit per completed trip (freight = delivered MT × route rate).',
    columns: [{ key: 'code', label: 'Trip' }, { key: 'completed_at', label: 'Completed', type: 'datetime' }, { key: 'route', label: 'Route' }, { key: 'vehicle', label: 'Vehicle' }, { key: 'owner', label: 'Owner' }, { key: 'delivered_mt', label: 'Delivered MT', type: 'number' }, { key: 'rate', label: 'Rate / MT', type: 'number' }, { key: 'income', label: 'Income (PKR)', type: 'number' }, { key: 'expenses', label: 'Expenses (PKR)', type: 'number' }, { key: 'profit', label: 'Profit (PKR)', type: 'number' }, { key: 'margin_pct', label: 'Margin', type: 'percent' }],
    build: (f) => { const { where, r } = tripWhere({ ...f, status: undefined }, 't', 'completed_at'); return { r, order: 'completed_at DESC',
      sql: `SELECT t.code, t.completed_at, o.name || ' → ' || dl.name AS route, v.code AS vehicle, v.owner_name AS owner, t.delivered_mt, t.freight_per_mt::float AS rate,
              round(t.delivered_mt * t.freight_per_mt)::float AS income, COALESCE(e.amt, 0)::float AS expenses, round(t.delivered_mt * t.freight_per_mt - COALESCE(e.amt, 0))::float AS profit,
              CASE WHEN t.delivered_mt * t.freight_per_mt > 0 THEN round(100 * (t.delivered_mt * t.freight_per_mt - COALESCE(e.amt, 0)) / (t.delivered_mt * t.freight_per_mt))::int END AS margin_pct
         ${TRIP_FROM} LEFT JOIN LATERAL (SELECT sum(amount) AS amt FROM trip_expenses x WHERE x.trip_id = t.id AND x.status IN ('APPROVED','REIMBURSED')) e ON true WHERE t.status = 'COMPLETED' AND ${where}` }; },
  },
  'owner-pnl': {
    perm: 'finance:view', title: 'Bowzer / Owner Profit & Loss', description: 'Income, expenses and net per bowzer, grouped by owner (partner) — mirrors the legacy "All Bowzer Profit & Loss".',
    columns: [{ key: 'owner', label: 'Owner / partner' }, { key: 'vehicle', label: 'Bowzer' }, { key: 'trips', label: 'Trips', type: 'number' }, { key: 'delivered_mt', label: 'MT moved', type: 'number' }, { key: 'income', label: 'Income (PKR)', type: 'number' }, { key: 'expenses', label: 'Expenses (PKR)', type: 'number' }, { key: 'profit', label: 'Net (PKR)', type: 'number' }],
    build: (f) => { const r: Record<string, unknown> = { from: f.from, to: f.to }; if (f.vehicleId) r.veh = f.vehicleId;
      return { r, order: 'owner, vehicle', sql: `SELECT COALESCE(v.owner_name, CASE WHEN v.fleet_type = 'HIRED' THEN COALESCE(v.vendor_name, 'Hired') ELSE 'Company-owned' END) AS owner, v.code AS vehicle, count(t.id)::int AS trips, COALESCE(sum(t.delivered_mt), 0)::float AS delivered_mt,
          COALESCE(round(sum(t.delivered_mt * t.freight_per_mt)), 0)::float AS income, COALESCE(sum(e.amt), 0)::float AS expenses, COALESCE(round(sum(t.delivered_mt * t.freight_per_mt) - sum(COALESCE(e.amt, 0))), 0)::float AS profit
        FROM vehicles v LEFT JOIN trips t ON t.vehicle_id = v.id AND t.status = 'COMPLETED' AND t.completed_at >= :from AND t.completed_at < (:to::date + 1)
        LEFT JOIN LATERAL (SELECT sum(amount) AS amt FROM trip_expenses x WHERE x.trip_id = t.id AND x.status IN ('APPROVED','REIMBURSED')) e ON true
        WHERE v.archived_at IS NULL ${f.vehicleId ? 'AND v.id = :veh' : ''} GROUP BY v.id` }; },
  },
  'fuel-efficiency': {
    perm: 'fuel:view', title: 'Fuel Efficiency', description: 'Litres, cost and km/litre per vehicle versus its fuel norm.',
    columns: [{ key: 'vehicle', label: 'Vehicle' }, { key: 'fills', label: 'Fills', type: 'number' }, { key: 'litres', label: 'Litres', type: 'number' }, { key: 'amount', label: 'Cost (PKR)', type: 'number' }, { key: 'avg_kmpl', label: 'Avg km/L', type: 'number' }, { key: 'norm', label: 'Norm km/L', type: 'number' }, { key: 'cost_per_km', label: 'PKR / km', type: 'number' }, { key: 'flagged', label: 'Flagged', type: 'number' }],
    build: (f) => { const r: Record<string, unknown> = { from: f.from, to: f.to }; if (f.vehicleId) r.veh = f.vehicleId;
      return { r, order: 'avg_kmpl ASC NULLS LAST', sql: `SELECT v.code AS vehicle, count(x.id)::int AS fills, COALESCE(sum(x.litres), 0)::float AS litres, COALESCE(sum(x.amount), 0)::float AS amount, round(avg(x.kmpl), 2)::float AS avg_kmpl, v.fuel_norm_kmpl::float AS norm,
          round(sum(x.amount) / NULLIF(sum(x.km_since_last), 0), 1)::float AS cost_per_km, count(*) FILTER (WHERE x.status = 'FLAGGED')::int AS flagged
        FROM vehicles v JOIN fuel_entries x ON x.vehicle_id = v.id AND x.fueled_at >= :from AND x.fueled_at < (:to::date + 1) WHERE v.archived_at IS NULL ${f.vehicleId ? 'AND v.id = :veh' : ''} GROUP BY v.id` }; },
  },
  'expense-summary': {
    perm: 'expenses:view', title: 'Trip Expense Summary', description: 'Trip expenses by category and status in the period.',
    columns: [{ key: 'category', label: 'Category' }, { key: 'entries', label: 'Entries', type: 'number' }, { key: 'approved', label: 'Approved (PKR)', type: 'number' }, { key: 'pending', label: 'Pending (PKR)', type: 'number' }, { key: 'rejected', label: 'Rejected (PKR)', type: 'number' }],
    build: (f) => { const r: Record<string, unknown> = { from: f.from, to: f.to }; if (f.vehicleId) r.veh = f.vehicleId;
      return { r, order: 'approved DESC', sql: `SELECT x.category, count(*)::int AS entries, COALESCE(sum(x.amount) FILTER (WHERE x.status IN ('APPROVED','REIMBURSED')), 0)::float AS approved, COALESCE(sum(x.amount) FILTER (WHERE x.status = 'SUBMITTED'), 0)::float AS pending, COALESCE(sum(x.amount) FILTER (WHERE x.status = 'REJECTED'), 0)::float AS rejected
        FROM trip_expenses x WHERE x.incurred_on >= :from AND x.incurred_on <= :to ${f.vehicleId ? 'AND x.vehicle_id = :veh' : ''} GROUP BY x.category` }; },
  },
};

reportsRouter.get('/', requirePerm('reports:view'), wrap(async (req, res) => {
  res.json({ reports: Object.entries(DEFS).filter(([, d]) => !d.perm || can(req.user!.role, d.perm)).map(([key, d]) => ({ key, title: d.title, description: d.description })) });
}));

const csvCell = (v: unknown) => { const s = v instanceof Date ? v.toISOString() : v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

reportsRouter.get('/:type', requirePerm('reports:view'), wrap(async (req, res) => {
  const def = DEFS[req.params.type];
  if (!def) throw badRequest('Unknown report.');
  if (def.perm && !can(req.user!.role, def.perm)) throw forbidden('Your role cannot view this report.');
  const p = paging(req.query);
  const today = new Date();
  const f = parse(z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(iso(new Date(today.getTime() - 29 * 86400000))), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(iso(today)),
    plantId: z.coerce.number().optional(), vehicleId: z.coerce.number().optional(), driverId: z.coerce.number().optional(), destinationId: z.coerce.number().optional(),
    region: z.string().optional(), status: z.string().optional(), format: z.enum(['json', 'csv']).default('json'),
  }), req.query);
  const { sql, r, order } = def.build(f);
  if (f.format === 'csv') {
    if (!can(req.user!.role, 'reports:export')) throw forbidden('Your role cannot export reports.');
    const rows = await q(`SELECT * FROM (${sql}) x ORDER BY ${order} LIMIT 10000`, r);
    const csv = [def.columns.map((c) => csvCell(c.label)).join(','), ...rows.map((row) => def.columns.map((c) => csvCell(row[c.key])).join(','))].join('\n');
    await audit(req, { action: 'REPORT_EXPORT', entityType: 'REPORT', entityLabel: def.title, meta: { rows: rows.length } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gasman-${req.params.type}-${f.from}_${f.to}.csv"`);
    return res.send('﻿' + csv);
  }
  const [rows, [{ total }]] = await Promise.all([
    q(`SELECT * FROM (${sql}) x ORDER BY ${order} LIMIT :lim OFFSET :off`, { ...r, lim: p.pageSize, off: p.offset }),
    q(`SELECT count(*)::int AS total FROM (${sql}) x`, r),
  ]);
  const numeric = def.columns.filter((c) => c.type === 'number' && /mt|trips|cost|completed|cancelled|delayed|incidents/i.test(c.key)).map((c) => c.key);
  const totals: Record<string, number> = {};
  if (numeric.length) {
    const [t] = await q(`SELECT ${numeric.map((k) => `COALESCE(sum(${k}),0)::float AS ${k}`).join(', ')} FROM (${sql}) x`, r);
    Object.assign(totals, t);
  }
  res.json({ ...listResponse(rows, total, p.page, p.pageSize), report: { key: req.params.type, title: def.title, description: def.description, columns: def.columns }, totals, filters: f });
}));

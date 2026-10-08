import { Router } from 'express';
import { z } from 'zod';
import { q, q1 } from '../db/sequelize';
import { parse, wrap } from '../lib/http';
import { TtlCache } from '../lib/cache';
import { currentDocSql, localDate, TODAY_START } from '../lib/sql';
import { requirePerm } from '../middleware/auth';
import { can } from '@gasman/shared';

export const dashboardRouter = Router();
export const dashboardCache = new TtlCache<any>(4000);

/** All numbers are computed from live tables on every cache miss (4s TTL, busted on any write). */
async function build(plantId?: number) {
  const tp = plantId ? 'AND t.origin_location_id = :plant' : '';
  const vp = plantId ? 'AND v.home_plant_id = :plant' : '';
  const r = { plant: plantId ?? null };
  const [fleet, trips, drivers, maint, docs, openIncidents, byDay, byStatus, topDest, byRegion, plantShare, utilization, liveTrips, alertsDocs, alertsMaint, delayed, pending, bySource] = await Promise.all([
    q1<any>(`SELECT count(*)::int AS total, count(*) FILTER (WHERE fleet_type = 'OWNED')::int AS owned, count(*) FILTER (WHERE fleet_type = 'HIRED')::int AS hired,
                    count(*) FILTER (WHERE status = 'ON_TRIP')::int AS on_trip, count(*) FILTER (WHERE status = 'AVAILABLE')::int AS available,
                    count(*) FILTER (WHERE status = 'MAINTENANCE')::int AS maintenance, count(*) FILTER (WHERE status = 'INACTIVE')::int AS inactive
               FROM vehicles v WHERE archived_at IS NULL ${vp}`, r),
    q1<any>(`SELECT count(*) FILTER (WHERE status IN ('IN_TRANSIT','DELAYED','RETURNING'))::int AS in_transit,
                    count(*) FILTER (WHERE status IN ('DISPATCHED','IN_TRANSIT','DELAYED','ON_HOLD','ARRIVED','DELIVERED','RETURNING'))::int AS active,
                    count(*) FILTER (WHERE status IN ('PLANNED','ASSIGNED'))::int AS scheduled,
                    count(*) FILTER (WHERE status = 'DELAYED')::int AS delayed,
                    count(*) FILTER (WHERE status = 'ON_HOLD')::int AS on_hold,
                    count(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
                    count(*) FILTER (WHERE status = 'COMPLETED' AND completed_at >= ${TODAY_START})::int AS completed_today,
                    count(*) FILTER (WHERE status = 'COMPLETED' AND completed_at >= date_trunc('month', now()))::int AS completed_mtd,
                    COALESCE(sum(delivered_mt) FILTER (WHERE status IN ('DELIVERED','RETURNING','COMPLETED') AND delivered_at >= date_trunc('month', now())), 0)::float AS lpg_mt_mtd,
                    COALESCE(sum(delivered_mt) FILTER (WHERE status IN ('DELIVERED','RETURNING','COMPLETED') AND delivered_at >= date_trunc('month', now()) - interval '1 month' AND delivered_at < date_trunc('month', now())), 0)::float AS lpg_mt_prev_month,
                    COALESCE(round(100.0 * count(*) FILTER (WHERE status = 'COMPLETED' AND completed_at >= now() - interval '30 days' AND delay_minutes <= 15)
                           / NULLIF(count(*) FILTER (WHERE status = 'COMPLETED' AND completed_at >= now() - interval '30 days'), 0)), 0)::int AS on_time_pct
               FROM trips t WHERE (t.status NOT IN ('COMPLETED','CANCELLED') OR t.completed_at >= now() - interval '70 days') ${tp}`, r),
    q1<any>(`SELECT count(*) FILTER (WHERE status IN ('AVAILABLE','ON_TRIP'))::int AS active, count(*) FILTER (WHERE status = 'AVAILABLE')::int AS available,
                    count(*) FILTER (WHERE status = 'ON_TRIP')::int AS on_trip, count(*)::int AS total FROM drivers WHERE archived_at IS NULL`),
    q1<any>(`SELECT count(*) FILTER (WHERE status = 'SCHEDULED' AND scheduled_on <= CURRENT_DATE + 7)::int AS due,
                    count(*) FILTER (WHERE status = 'SCHEDULED' AND scheduled_on < CURRENT_DATE)::int AS overdue,
                    count(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS in_progress FROM maintenance_records`),
    q1<any>(`SELECT count(*) FILTER (WHERE d.expires_on < CURRENT_DATE)::int AS expired,
                    count(*) FILTER (WHERE d.expires_on >= CURRENT_DATE AND d.expires_on <= CURRENT_DATE + 30)::int AS expiring
               FROM documents d LEFT JOIN vehicles v ON v.id = d.vehicle_id LEFT JOIN drivers dr ON dr.id = d.driver_id
              WHERE COALESCE(v.archived_at, dr.archived_at) IS NULL AND ${currentDocSql('d')}`),
    q1<any>(`SELECT count(*)::int AS open, count(*) FILTER (WHERE severity IN ('HIGH','CRITICAL'))::int AS serious FROM incidents WHERE status <> 'CLOSED'`),
    q(`SELECT to_char(day, 'DD Mon') AS label, day::date AS date,
              COALESCE(c.completed, 0)::int AS completed, COALESCE(c.delayed, 0)::int AS delayed, COALESCE(x.cancelled, 0)::int AS cancelled, COALESCE(c.mt, 0)::float AS lpg_mt
         FROM generate_series(${localDate('now()')} - 13, ${localDate('now()')}, interval '1 day') day
         LEFT JOIN (SELECT ${localDate('completed_at')} AS d, count(*) AS completed, count(*) FILTER (WHERE delay_minutes > 15) AS delayed, sum(delivered_mt) AS mt
                      FROM trips t WHERE status = 'COMPLETED' AND completed_at >= now() - interval '15 days' ${tp} GROUP BY 1) c ON c.d = day::date
         LEFT JOIN (SELECT ${localDate('cancelled_at')} AS d, count(*) AS cancelled FROM trips t WHERE status = 'CANCELLED' AND cancelled_at >= now() - interval '15 days' ${tp} GROUP BY 1) x ON x.d = day::date
        ORDER BY day`, r),
    q(`SELECT status, count(*)::int AS n FROM trips t WHERE (status NOT IN ('COMPLETED','CANCELLED') OR COALESCE(completed_at, cancelled_at) >= now() - interval '7 days') ${tp} GROUP BY status ORDER BY n DESC`, r),
    q(`SELECT dl.name, dl.region, count(*)::int AS trips, COALESCE(sum(t.delivered_mt),0)::float AS mt FROM trips t JOIN locations dl ON dl.id = t.destination_location_id
        WHERE t.status = 'COMPLETED' AND t.completed_at >= now() - interval '30 days' ${tp} GROUP BY dl.name, dl.region ORDER BY mt DESC LIMIT 6`, r),
    q(`SELECT dl.region, count(*)::int AS trips, COALESCE(sum(t.delivered_mt),0)::float AS mt FROM trips t JOIN locations dl ON dl.id = t.destination_location_id
        WHERE t.status = 'COMPLETED' AND t.completed_at >= now() - interval '30 days' ${tp} GROUP BY dl.region ORDER BY mt DESC`, r),
    q(`SELECT o.name, count(*)::int AS trips, COALESCE(sum(t.delivered_mt),0)::float AS mt FROM trips t JOIN locations o ON o.id = t.origin_location_id
        WHERE t.status = 'COMPLETED' AND t.completed_at >= now() - interval '30 days' GROUP BY o.name ORDER BY mt DESC`),
    q(`SELECT v.code, v.fleet_type, count(t.id)::int AS trips, COALESCE(sum(t.delivered_mt),0)::float AS mt FROM vehicles v
         LEFT JOIN trips t ON t.vehicle_id = v.id AND t.status = 'COMPLETED' AND t.completed_at >= now() - interval '30 days'
        WHERE v.archived_at IS NULL ${vp} GROUP BY v.code, v.fleet_type ORDER BY trips DESC, v.code LIMIT 8`, r),
    q(`SELECT t.id, t.code, t.status, t.progress_pct, t.eta_at, t.cur_speed_kmh, o.name AS origin_name, dl.name AS destination_name, v.code AS vehicle_code, d.full_name AS driver_name, t.delay_minutes
         FROM trips t JOIN locations o ON o.id = t.origin_location_id JOIN locations dl ON dl.id = t.destination_location_id
         LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id
        WHERE t.status IN ('DISPATCHED','IN_TRANSIT','DELAYED','ON_HOLD','ARRIVED','DELIVERED','RETURNING') ${tp}
        ORDER BY (t.status = 'DELAYED') DESC, t.progress_pct DESC LIMIT 8`, r),
    q(`SELECT d.id, d.doc_type, d.expires_on, (d.expires_on - CURRENT_DATE)::int AS days_left, v.id AS vehicle_id, v.code AS vehicle_code, dr.id AS driver_id, dr.full_name AS driver_name
         FROM documents d LEFT JOIN vehicles v ON v.id = d.vehicle_id LEFT JOIN drivers dr ON dr.id = d.driver_id
        WHERE d.expires_on <= CURRENT_DATE + 30 AND COALESCE(v.archived_at, dr.archived_at) IS NULL
          AND ${currentDocSql('d')}
        ORDER BY d.expires_on LIMIT 6`),
    q(`SELECT m.id, m.title, m.scheduled_on, m.status, v.id AS vehicle_id, v.code AS vehicle_code, (m.scheduled_on - CURRENT_DATE)::int AS days_left
         FROM maintenance_records m JOIN vehicles v ON v.id = m.vehicle_id WHERE m.status = 'SCHEDULED' AND m.scheduled_on <= CURRENT_DATE + 7 ORDER BY m.scheduled_on LIMIT 5`),
    q(`SELECT t.id, t.code, t.delay_minutes, t.eta_at, dl.name AS destination_name FROM trips t JOIN locations dl ON dl.id = t.destination_location_id WHERE t.status = 'DELAYED' ${tp} ORDER BY t.eta_at LIMIT 5`, r),
    q(`SELECT t.id, t.code, t.status, t.scheduled_departure, dl.name AS destination_name FROM trips t JOIN locations dl ON dl.id = t.destination_location_id
        WHERE t.status IN ('PLANNED','ASSIGNED','DRAFT') AND t.scheduled_departure <= now() + interval '24 hours' ${tp} ORDER BY t.scheduled_departure LIMIT 5`, r),
    q(`SELECT lpg_source AS source, COALESCE(sum(delivered_mt),0)::float AS mt FROM trips t WHERE status = 'COMPLETED' AND completed_at >= now() - interval '30 days' ${tp} GROUP BY lpg_source`, r),
  ]);
  const pendingCount = await q1<any>(`SELECT count(*)::int AS n FROM trips t WHERE t.status IN ('PLANNED','ASSIGNED') ${tp}`, r);
  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      totalFleet: fleet.total, ownedFleet: fleet.owned, hiredFleet: fleet.hired,
      activeVehicles: fleet.on_trip, availableVehicles: fleet.available, vehiclesInMaintenance: fleet.maintenance,
      tripsInTransit: trips.in_transit, activeTrips: trips.active, scheduledTrips: trips.scheduled, delayedTrips: trips.delayed, onHoldTrips: trips.on_hold,
      draftTrips: trips.draft, completedToday: trips.completed_today, completedMtd: trips.completed_mtd, lpgDeliveredMtdMt: trips.lpg_mt_mtd, lpgDeliveredPrevMonthMt: trips.lpg_mt_prev_month,
      onTimePct: trips.on_time_pct, pendingDispatches: pendingCount.n,
      maintenanceDue: maint.due, maintenanceOverdue: maint.overdue, inMaintenance: maint.in_progress,
      expiringDocuments: docs.expiring, expiredDocuments: docs.expired,
      activeDrivers: drivers.active, availableDrivers: drivers.available, driversOnTrip: drivers.on_trip, totalDrivers: drivers.total,
      openIncidents: openIncidents.open, seriousIncidents: openIncidents.serious,
    },
    fleetBreakdown: [
      { name: 'On trip', value: fleet.on_trip }, { name: 'Available', value: fleet.available },
      { name: 'Maintenance', value: fleet.maintenance }, { name: 'Inactive', value: fleet.inactive },
    ],
    charts: { tripsByDay: byDay, tripStatus: byStatus, topDestinations: topDest, byRegion, plantShare, vehicleUtilization: utilization, bySource },
    liveTrips,
    alerts: { documents: alertsDocs, maintenance: alertsMaint, delayedTrips: delayed, pendingDispatch: pending },
  };
}

const financeCache = new TtlCache<any>(4000);
async function financeBlock(plantId?: number) {
  const tp = plantId ? 'AND t.origin_location_id = :plant' : '';
  const r = { plant: plantId ?? null };
  const [m] = await q(`SELECT
      COALESCE(sum(t.delivered_mt * t.freight_per_mt) FILTER (WHERE t.delivered_at >= date_trunc('month', now())), 0)::float AS income_mtd,
      COALESCE(sum(t.delivered_mt * t.freight_per_mt) FILTER (WHERE t.delivered_at >= date_trunc('month', now()) - interval '1 month' AND t.delivered_at < date_trunc('month', now())), 0)::float AS income_prev
    FROM trips t WHERE t.status IN ('DELIVERED','RETURNING','COMPLETED') ${tp}`, r);
  const [e] = await q(`SELECT COALESCE(sum(x.amount) FILTER (WHERE x.status IN ('APPROVED','REIMBURSED') AND x.incurred_on >= date_trunc('month', now())), 0)::float AS expenses_mtd,
      COALESCE(sum(x.amount) FILTER (WHERE x.status IN ('APPROVED','REIMBURSED') AND x.incurred_on >= date_trunc('month', now()) - interval '1 month' AND x.incurred_on < date_trunc('month', now())), 0)::float AS expenses_prev,
      COALESCE(sum(x.amount) FILTER (WHERE x.status = 'SUBMITTED'), 0)::float AS pending_amount, count(*) FILTER (WHERE x.status = 'SUBMITTED')::int AS pending_count
    FROM trip_expenses x JOIN trips t ON t.id = x.trip_id WHERE 1=1 ${tp}`, r);
  const [fl] = await q(`SELECT count(*) FILTER (WHERE status = 'FLAGGED')::int AS flagged FROM fuel_entries`);
  const daily = await q(`SELECT to_char(d, 'DD Mon') AS label, COALESCE(i.v, 0)::float AS income, COALESCE(x.v, 0)::float AS expenses
      FROM generate_series(${localDate('now()')} - 13, ${localDate('now()')}, interval '1 day') d
      LEFT JOIN (SELECT ${localDate('t.delivered_at')} AS dd, sum(t.delivered_mt * t.freight_per_mt) AS v FROM trips t WHERE t.delivered_at >= now() - interval '15 days' ${tp} GROUP BY 1) i ON i.dd = d::date
      LEFT JOIN (SELECT e.incurred_on AS dd, sum(e.amount) AS v FROM trip_expenses e JOIN trips t ON t.id = e.trip_id WHERE e.status IN ('APPROVED','REIMBURSED') AND e.incurred_on >= CURRENT_DATE - 14 ${tp} GROUP BY 1) x ON x.dd = d::date
      ORDER BY d`, r);
  const banks = await q(`SELECT b.name, COALESCE(ab.debit - ab.credit, 0)::float AS balance FROM banks b LEFT JOIN account_balances ab ON ab.account_id = b.account_id WHERE b.active ORDER BY balance DESC`);
  const [bal] = await q(`SELECT COALESCE(sum(ab.debit - ab.credit) FILTER (WHERE a.system_key = 'cash'), 0)::float AS cash, COALESCE(sum(ab.debit - ab.credit) FILTER (WHERE a.system_key = 'receivable'), 0)::float AS receivable,
      COALESCE(sum(ab.credit - ab.debit) FILTER (WHERE a.system_key = 'payable'), 0)::float AS payable FROM account_balances ab JOIN accounts a ON a.id = ab.account_id WHERE a.system_key IN ('cash','receivable','payable')`);
  const [od] = await q(`SELECT COALESCE(sum(total - paid), 0)::float AS overdue, count(*)::int AS n FROM sales_invoices WHERE kind = 'INVOICE' AND status IN ('UNPAID','PARTIAL') AND due_date < CURRENT_DATE`);
  const creditWatch = await q(`SELECT d.id, d.name, d.credit_limit_pkr::float AS credit_limit, d.credit_alert_pct, (pb.debit - pb.credit)::float AS balance, round((pb.debit - pb.credit) / d.credit_limit_pkr * 100)::int AS pct
      FROM distributors d JOIN party_balances pb ON pb.party_type = 'CUSTOMER' AND pb.party_id = d.id AND pb.account_id = (SELECT id FROM accounts WHERE system_key = 'receivable')
     WHERE d.credit_limit_pkr > 0 AND (pb.debit - pb.credit) >= d.credit_limit_pkr * d.credit_alert_pct / 100.0 ORDER BY pct DESC LIMIT 5`);
  const treasury = { cash: bal.cash, banks, bankTotal: Math.round(banks.reduce((s: number, b: any) => s + b.balance, 0)), receivable: bal.receivable, overdue: od.overdue, overdueInvoices: od.n, payable: bal.payable };
  const profit = m.income_mtd - e.expenses_mtd;
  const rd = Math.round;
  return { treasury, creditWatch, incomeMtd: rd(m.income_mtd), incomePrevMonth: rd(m.income_prev), expensesMtd: rd(e.expenses_mtd), expensesPrevMonth: rd(e.expenses_prev), profitMtd: rd(profit), marginPct: m.income_mtd > 0 ? Math.round((profit / m.income_mtd) * 1000) / 10 : null,
    pendingExpenseAmount: e.pending_amount, pendingExpenseCount: e.pending_count, fuelFlagged: fl.flagged, daily };
}

async function inventoryBlock() {
  const lowStock = await q(`SELECT i.id, i.code, i.name, COALESCE(sum(s.qty), 0)::float AS qty, i.min_level::float AS min FROM items i LEFT JOIN stock_balances s ON s.item_id = i.id AND s.holder_type = 'WAREHOUSE' WHERE i.active AND i.min_level > 0 GROUP BY i.id HAVING COALESCE(sum(s.qty), 0) <= i.min_level ORDER BY COALESCE(sum(s.qty), 0) / i.min_level LIMIT 6`);
  const [c] = await q(`SELECT count(*)::int AS n FROM (SELECT i.id FROM items i LEFT JOIN stock_balances s ON s.item_id = i.id AND s.holder_type = 'WAREHOUSE' WHERE i.active AND i.min_level > 0 GROUP BY i.id HAVING COALESCE(sum(s.qty), 0) <= i.min_level) x`);
  return { lowStock, lowStockCount: c.n };
}

dashboardRouter.get('/', requirePerm('dashboard:view'), wrap(async (req, res) => {
  const { plantId } = parse(z.object({ plantId: z.coerce.number().int().positive().optional() }), req.query);
  const base = await dashboardCache.get(`d:${plantId ?? 'all'}`, () => build(plantId));
  // Money figures are role-gated and never stored in the shared (all-roles) cache entry.
  const extra: Record<string, unknown> = {};
  extra.activity = await financeCache.get('act', () => q(`SELECT e.occurred_at, e.type, e.message, t.id AS trip_id, t.code, v.code AS vehicle FROM trip_events e JOIN trips t ON t.id = e.trip_id LEFT JOIN vehicles v ON v.id = t.vehicle_id WHERE e.type NOT IN ('CHECKPOINT') ORDER BY e.occurred_at DESC, e.id DESC LIMIT 8`));
  if (can(req.user!.role, 'inventory:view')) extra.inventory = await financeCache.get('inv', () => inventoryBlock() as any);
  if (can(req.user!.role, 'finance:view')) extra.finance = await financeCache.get(`f:${plantId ?? 'all'}`, () => financeBlock(plantId));
  res.json({ ...base, ...extra });
}));

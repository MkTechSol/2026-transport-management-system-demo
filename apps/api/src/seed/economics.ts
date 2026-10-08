import crypto from 'node:crypto';
import type { Rng } from './rng';

const MIN = 60_000;
const STATIONS = ['Demo Fuel Station — Kohat Rd', 'Demo Pump — GT Road Attock', 'Demo Fuel Plaza — Motorway M-1', 'Demo Petroleum — Nowshera', 'Demo Pump — Peshawar Ring Rd', 'Demo Fuel Station — Dhurnal'];
const STARTED = ['IN_TRANSIT', 'DELAYED', 'ON_HOLD', 'ARRIVED', 'DELIVERED', 'RETURNING', 'COMPLETED'];

export interface EconCtx {
  trips: any[]; vehicles: any[]; routesById: Map<number, any>; locations: any[]; marketerIds: number[]; rng: Rng; NOW: number;
  autoLimit: number;
}

/**
 * Post-pass over the chronologically ordered seed trips: trip economics (freight, odometer, uplift vouchers),
 * fuel fills with km/litre validation, trip expenses and the approval requests behind them.
 * All numbers are synthetic and internally consistent (odometers advance per vehicle, litres follow km / norm).
 */
export function economicsPass(c: EconCtx) {
  const { rng } = c;
  const locById = new Map(c.locations.map((l) => [l.id, l]));
  const vById = new Map(c.vehicles.map((v) => [v.id, v]));
  const odo = new Map<number, number>(c.vehicles.map((v) => [v.id, v.odometer_km]));
  const lastFill = new Map<number, number>();
  const fuel: any[] = []; const expenses: any[] = []; const approvals: any[] = [];
  let fid = 1; let eid = 1; let aid = 1;
  const rateOn = (d: Date) => Math.round((274 + 6 * Math.sin(d.getTime() / (9 * 86400000)) + rng.float(0, 3)) * 10) / 10;

  const addExpense = (t: any, cat: string, amount: number, when: Date, o: { nights?: number; desc?: string; fuelId?: number; forceSubmitted?: boolean; receipt?: string } = {}) => {
    const age = (c.NOW - when.getTime()) / 86400000;
    const needs = amount > c.autoLimit || o.forceSubmitted;
    let status = 'APPROVED'; let decidedBy: number | null = null; let decidedAt: Date | null = when; let note: string | null = 'Auto-approved (within limit)';
    if (needs) {
      const pending = age < 3 && rng.chance(0.65);
      if (pending) { status = 'SUBMITTED'; decidedAt = null; note = null; }
      else if (o.forceSubmitted && rng.chance(0.25)) { status = 'REJECTED'; decidedBy = 2; decidedAt = new Date(when.getTime() + 20 * 3600_000); note = 'Not supported by the receipt'; }
      else { decidedBy = amount >= 50000 ? 1 : 2; decidedAt = new Date(when.getTime() + rng.int(40, 600) * MIN); note = 'Approved'; }
    }
    const row = { id: eid++, trip_id: t.id, vehicle_id: t.vehicle_id, driver_id: t.driver_id, category: cat, amount: Math.round(amount), nights: o.nights ?? null, description: o.desc ?? null, receipt_no: o.receipt ?? null, incurred_on: when.toISOString().slice(0, 10),
      status, submitted_by: 3, decided_by: decidedBy, decided_at: decidedAt, decision_note: note, fuel_entry_id: o.fuelId ?? null, voucher_id: null as any, created_at: when, updated_at: decidedAt ?? when };
    expenses.push(row);
    if (needs) approvals.push({ id: aid++, entity_type: 'TRIP_EXPENSE', entity_id: row.id, title: `${t.code} · ${cat.replace(/_/g, ' ').toLowerCase()}`, amount: row.amount, requested_by: 3, requested_at: when,
      approver_role: amount >= 50000 ? 'SUPER_ADMIN' : 'TRANSPORT_MANAGER', status: status === 'SUBMITTED' ? 'PENDING' : status === 'REJECTED' ? 'REJECTED' : 'APPROVED', decided_by: decidedBy, decided_at: decidedAt, decision_note: note });
    return row;
  };

  const fill = (t: any, v: any, when: Date, odoNow: number, forceFlag = false, tripKm = 150) => {
    const norm = Number(v.fuel_norm_kmpl); const prevOdo = lastFill.get(v.id);
    let litres: number; let km: number | null = null; let kmpl: number | null = null; let variance: number | null = null; let flagged = false; let reason: string | null = null;
    if (prevOdo == null || odoNow <= prevOdo) litres = Math.round((tripKm / norm) * rng.float(0.95, 1.05) * 10) / 10;
    else {
      km = odoNow - prevOdo; const expected = km / norm; const anomalous = forceFlag || rng.chance(0.055);
      litres = Math.round(expected * (anomalous ? rng.float(1.32, 1.7) : rng.float(0.93, 1.08)) * 10) / 10;
      kmpl = Math.round((km / litres) * 100) / 100; variance = Math.round(((litres - expected) / expected) * 1000) / 10;
      if (variance > 20) { flagged = true; reason = `${litres} L is ${variance}% above the ${expected.toFixed(0)} L expected for ${km} km at ${norm} km/L.`; }
    }
    lastFill.set(v.id, odoNow);
    const rate = rateOn(when); const amount = Math.round(litres * rate);
    const row = { id: fid++, vehicle_id: v.id, trip_id: t.id, driver_id: t.driver_id, station: rng.pick(STATIONS), fueled_at: when, litres, rate_per_l: rate, amount, odometer_km: odoNow, km_since_last: km, kmpl, payment_mode: rng.pick(['CASH', 'CASH', 'CARD', 'CREDIT']),
      receipt_no: `FR-${String(fid).padStart(5, '0')}`, status: flagged ? 'FLAGGED' : 'VALIDATED', variance_pct: variance, flag_reason: reason, reviewed_by: null as any, review_note: null as any, created_by: 3, created_at: when };
    const age = (c.NOW - when.getTime()) / 86400000;
    if (flagged && age > 6 && rng.chance(0.7)) { row.status = 'REVIEWED'; row.reviewed_by = 4; row.review_note = rng.pick(['Accepted: extra idling at plant during loading delay', 'Accepted: hilly route, norm adjusted', 'Disputed: receipt does not match odometer']); }
    fuel.push(row);
    addExpense(t, 'FUEL', amount, when, { desc: `${litres} L @ ${rate}`, fuelId: row.id, forceSubmitted: flagged && row.status === 'FLAGGED', receipt: row.receipt_no });
    return row;
  };

  for (const t of c.trips) {
    const route = c.routesById.get(t.route_id); const origin = locById.get(t.origin_location_id);
    t.freight_per_mt = route?.freight_per_mt ?? 0;
    t.trip_type = origin?.type === 'FIELD' ? 'UPLIFTING' : 'DELIVERY';
    t.public_token = crypto.createHash('sha256').update(`gm-demo-track-${t.id}`).digest('base64url').slice(0, 24);
    t.bill_to_id = t.distributor_id ?? c.marketerIds[t.id % c.marketerIds.length];
    t.odometer_start = null; t.odometer_end = null; t.uplift_voucher_no = null; t.invoice_id = null;
    if (!t.vehicle_id || !STARTED.concat(['DISPATCHED']).includes(t.status)) continue;
    const v = vById.get(t.vehicle_id)!; const dist = Number(route.distance_km);
    if (!t.departed_at) continue; // dispatched but not yet departed
    const start = (odo.get(v.id) ?? 0) + rng.int(2, 25); // deadhead / local running before departure
    t.odometer_start = start; t.uplift_voucher_no = `UPL-${new Date(t.departed_at).getUTCFullYear().toString().slice(2)}-${String(t.id).padStart(4, '0')}`;
    const hrs = t.completed_at ? (new Date(t.completed_at).getTime() - new Date(t.departed_at).getTime()) / 3600_000 : (c.NOW - new Date(t.departed_at).getTime()) / 3600_000;

    let end = start;
    if (t.status === 'COMPLETED') end = start + Math.round(dist * 2 + rng.int(0, 14));
    else if (['ARRIVED', 'DELIVERED'].includes(t.status)) end = start + Math.round(dist);
    else end = start + Math.round(dist * Number(t.progress_pct) / 100 * (t.status === 'RETURNING' ? 1 : 1));
    if (t.status === 'COMPLETED') {
      t.odometer_end = end;
      // Full-tank method: refuel on arrival (long routes) and on return so each fill covers the km since the previous one.
      if (dist > 180) fill(t, v, new Date(new Date(t.arrived_at).getTime() + 10 * MIN), start + Math.round(dist), false, dist);
      fill(t, v, new Date(new Date(t.completed_at).getTime() - 20 * MIN), end, false, dist * 2);
      const done = new Date(t.completed_at);
      addExpense(t, 'TOLL', Math.round((dist / 100) * rng.int(900, 1500) * 2 / 50) * 50 || 500, new Date(t.departed_at), { desc: 'Toll plazas (round trip)' });
      const days = Math.max(1, Math.ceil(hrs / 24));
      addExpense(t, 'DRIVER_ALLOWANCE', days * 2500, done, { desc: `${days} day(s) trip allowance` });
      if (hrs > 20) addExpense(t, 'TOUR_STAY', Math.floor(hrs / 24 + 0.5) * 2000 || 2000, done, { nights: Math.max(1, Math.floor(hrs / 24 + 0.5)), desc: 'Halt / tour stay' });
      if (rng.chance(0.5)) addExpense(t, 'LOADING_UNLOADING', rng.pick([1000, 1200, 1500, 1800]), new Date(t.arrived_at), { desc: 'Unloading labour' });
      if (rng.chance(0.1)) addExpense(t, 'POLICE_ROAD', rng.pick([500, 800, 1000, 1500]), new Date(t.departed_at), { desc: 'Road / checkpoint charges' });
      if (rng.chance(0.045)) addExpense(t, 'REPAIR', rng.int(8, 40) * 1000, new Date(new Date(t.departed_at).getTime() + 3 * 3600_000), { desc: rng.pick(['Tyre puncture & tube', 'Air hose replacement', 'Alternator belt', 'Wheel hub seal']) });
    } else {
      // In-progress trips: one departure fill sized for the outbound leg (not used for km/litre validation)
      const prev = lastFill.get(v.id); lastFill.delete(v.id);
      fill(t, v, new Date(new Date(t.departed_at).getTime() - 25 * MIN), start, false, dist);
      if (prev == null) lastFill.delete(v.id);
      addExpense(t, 'TOLL', Math.round((dist / 100) * 1100 / 50) * 50 || 500, new Date(t.departed_at), { desc: 'Toll plazas (outbound)' });
      if (hrs > 2 && rng.chance(0.6)) addExpense(t, 'DRIVER_ALLOWANCE', 2500, new Date(t.departed_at), { desc: 'Trip allowance (advance)' });
    }
    odo.set(v.id, end);
    v.odometer_km = end;
  }
  return { fuel, expenses, approvals };
}

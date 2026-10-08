import type { Request } from 'express';
import { q1, exec } from '../db/sequelize';
import { notFound, unprocessable } from '../lib/errors';
import type { AuthUser } from '../middleware/auth';
import { audit } from './audit';
import { createExpense } from './expenses';
import { AUDIENCE, notify } from './notify';
import { setting } from './settings';

export interface FuelInput { vehicleId: number; tripId?: number; station?: string; litres: number; ratePerL: number; odometerKm?: number; paymentMode: 'CASH' | 'CARD' | 'CREDIT'; receiptNo?: string; fueledAt?: string }

const TANK_L = 450;

/**
 * Records a fuel fill and validates it against the vehicle's fuel norm (full-tank method):
 * expected litres = km since previous fill / norm km per litre. Large positive variance, odometer regressions,
 * impossible tank volumes or abnormal prices flag the entry for the Fuel Exception Center.
 */
export async function recordFuel(user: AuthUser, req: Request | undefined, i: FuelInput, tx?: any) {
  const v = await q1<any>('SELECT id, code, fuel_norm_kmpl, odometer_km FROM vehicles WHERE id = :id AND archived_at IS NULL', { id: i.vehicleId }, tx);
  if (!v) throw notFound('Vehicle');
  let trip: any = null;
  if (i.tripId) {
    trip = await q1<any>('SELECT id, code, vehicle_id, driver_id, status FROM trips WHERE id = :id', { id: i.tripId }, tx);
    if (!trip) throw notFound('Trip');
    if (trip.vehicle_id !== i.vehicleId) throw unprocessable(`Trip ${trip.code} is not assigned to ${v.code}.`);
    if (user.role === 'DRIVER' && trip.driver_id !== user.driverId) throw unprocessable('You can only record fuel for your own trip.');
  }
  const prev = await q1<any>('SELECT odometer_km, fueled_at FROM fuel_entries WHERE vehicle_id = :v AND odometer_km IS NOT NULL ORDER BY fueled_at DESC LIMIT 1', { v: i.vehicleId }, tx);
  const thr = await setting<number>('fuel.varianceThresholdPct');
  const norm = Number(v.fuel_norm_kmpl) || (await setting<number>('fuel.defaultKmpl'));
  const reasons: string[] = []; let variance: number | null = null; let kmSince: number | null = null; let kmpl: number | null = null;
  if (i.odometerKm != null && prev) {
    if (i.odometerKm <= prev.odometer_km) reasons.push(`Odometer ${i.odometerKm} km is not above the previous reading (${prev.odometer_km} km).`);
    else {
      kmSince = i.odometerKm - prev.odometer_km;
      if (kmSince > 2500) reasons.push(`Odometer jumped ${kmSince} km since the previous fill — please verify the reading.`);
      kmpl = Math.min(999, Math.round((kmSince / i.litres) * 100) / 100);
      const expected = kmSince / norm; variance = Math.max(-999, Math.min(999, Math.round(((i.litres - expected) / expected) * 1000) / 10));
      if (variance > thr && kmSince <= 2500) reasons.push(`${i.litres} L is ${variance}% above the ${expected.toFixed(0)} L expected for ${kmSince} km at ${norm} km/L.`);
    }
  }
  if (i.litres > TANK_L) reasons.push(`${i.litres} L exceeds a ${TANK_L} L tank.`);
  const med = await q1<any>(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY rate_per_l) AS m FROM fuel_entries WHERE fueled_at > now() - interval '60 days'`, {}, tx);
  if (med?.m && i.ratePerL > Number(med.m) * 1.25) reasons.push(`Rate PKR ${i.ratePerL}/L is >25% above the recent median (PKR ${Number(med.m).toFixed(0)}).`);
  const amount = Math.round(i.litres * i.ratePerL);
  const flagged = reasons.length > 0;
  const row = await q1<any>(
    `INSERT INTO fuel_entries (vehicle_id, trip_id, driver_id, station, fueled_at, litres, rate_per_l, amount, odometer_km, km_since_last, kmpl, payment_mode, receipt_no, status, variance_pct, flag_reason, created_by)
     VALUES (:v, :t, :d, :st, COALESCE(:at, now()), :l, :r, :a, :o, :ks, :kp, :pm, :rc, :s, :var, :fr, :u) RETURNING *`,
    { v: v.id, t: trip?.id ?? null, d: trip?.driver_id ?? (user.role === 'DRIVER' ? user.driverId : null), st: i.station ?? null, at: i.fueledAt ?? null, l: i.litres, r: i.ratePerL, a: amount, o: i.odometerKm ?? null, ks: kmSince, kp: kmpl,
      pm: i.paymentMode, rc: i.receiptNo ?? null, s: flagged ? 'FLAGGED' : 'VALIDATED', var: variance, fr: flagged ? reasons.join(' ') : null, u: user.id }, tx);
  if (i.odometerKm != null) await exec('UPDATE vehicles SET odometer_km = GREATEST(odometer_km, :o), updated_at = now() WHERE id = :id', { o: i.odometerKm, id: v.id }, tx);
  if (trip && ['DISPATCHED', 'IN_TRANSIT', 'DELAYED', 'ON_HOLD', 'ARRIVED', 'DELIVERED', 'RETURNING', 'COMPLETED'].includes(trip.status))
    await createExpense(user, req, { tripId: trip.id, category: 'FUEL', amount, description: `${i.litres} L @ ${i.ratePerL}${i.station ? ` — ${i.station}` : ''}`, receiptNo: i.receiptNo, fuelEntryId: row.id, forceApproval: flagged }, tx);
  await audit(req, { action: flagged ? 'FUEL_FLAGGED' : 'FUEL_RECORDED', entityType: 'VEHICLE', entityId: v.id, entityLabel: `${v.code}: ${i.litres} L`, tx });
  if (flagged) await notify({ roles: AUDIENCE.FLEET, type: 'FUEL_ANOMALY', severity: 'WARNING', title: `Fuel anomaly on ${v.code}`, body: reasons[0], entityType: 'VEHICLE', entityId: v.id, dedupeKey: `fuel:${row.id}`, tx });
  return row;
}

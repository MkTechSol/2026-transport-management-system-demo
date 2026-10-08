import type { Request } from 'express';
import { q, q1, exec, sequelize } from '../db/sequelize';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { audit } from './audit';
import { AUDIENCE, notify } from './notify';
import type { AuthUser } from '../middleware/auth';

/**
 * Multi-drop support. A trip always has >= 1 rows in trip_stops (a normal trip has exactly one).
 * trips.destination_location_id / distributor_id mirror the FINAL stop; trips.delivered_mt is the sum over delivered stops.
 * This module is a leaf (no import of ./trips) so trips.ts can use it from its state machine.
 */

export async function addEvent(
  tx: any, tripId: number,
  e: { type: string; message: string; fromStatus?: string; toStatus?: string; actor?: number | null; lat?: number; lng?: number; clientEventId?: string; at?: Date },
) {
  await exec(
    `INSERT INTO trip_events (trip_id, type, from_status, to_status, message, actor_user_id, lat, lng, client_event_id, occurred_at)
     VALUES (:t, :type, :f, :to, :m, :a, :lat, :lng, :cid, COALESCE(:at, now()))`,
    { t: tripId, type: e.type, f: e.fromStatus ?? null, to: e.toStatus ?? null, m: e.message, a: e.actor ?? null, lat: e.lat ?? null, lng: e.lng ?? null, cid: e.clientEventId ?? null, at: e.at?.toISOString() ?? null },
    tx,
  );
}

export const STOP_SELECT = `s.id, s.trip_id, s.seq, s.location_id, l.name AS location_name, l.city AS location_city, l.region AS location_region, l.lat, l.lng,
  s.distributor_id, di.name AS distributor_name, s.planned_mt, s.delivered_mt, s.status, s.route_frac, s.eta_at, s.arrived_at, s.delivered_at,
  s.received_by, s.delivery_note_no, s.pod_notes, s.skip_reason, s.freight_per_mt, s.bill_to_id, bt.name AS bill_to_name`;
const STOP_FROM = `FROM trip_stops s JOIN locations l ON l.id = s.location_id LEFT JOIN distributors di ON di.id = s.distributor_id LEFT JOIN distributors bt ON bt.id = s.bill_to_id`;

export const listStops = (tripId: number, tx?: any) =>
  q<any>(`SELECT ${STOP_SELECT} ${STOP_FROM} WHERE s.trip_id = :id ORDER BY s.seq`, { id: tripId }, tx);

/** Delivered total, and (multi-drop only) the quantity-weighted freight rate, derived from the stops. */
export async function recomputeTotals(tx: any, tripId: number) {
  await exec(
    `UPDATE trips t SET
       delivered_mt = (SELECT sum(delivered_mt) FILTER (WHERE status = 'DELIVERED') FROM trip_stops WHERE trip_id = t.id),
       freight_per_mt = CASE WHEN t.stop_count > 1 THEN COALESCE(
          (SELECT round(sum(delivered_mt * freight_per_mt) / NULLIF(sum(delivered_mt), 0), 2) FROM trip_stops WHERE trip_id = t.id AND status = 'DELIVERED'),
          (SELECT round(sum(planned_mt * freight_per_mt) / NULLIF(sum(planned_mt), 0), 2) FROM trip_stops WHERE trip_id = t.id AND status <> 'SKIPPED'),
          t.freight_per_mt) ELSE t.freight_per_mt END,
       updated_at = now()
     WHERE t.id = :id`, { id: tripId }, tx);
}

/** The vehicle must have dealt with every earlier drop before the final stop can be marked arrived / delivered. */
export async function assertEarlierStopsResolved(tx: any, trip: { id: number; code: string; stop_count: number }) {
  if (trip.stop_count <= 1) return;
  const open = await q1<any>(
    `SELECT s.seq, l.name FROM trip_stops s JOIN locations l ON l.id = s.location_id WHERE s.trip_id = :id AND s.seq < :last AND s.status IN ('PENDING','ARRIVED') ORDER BY s.seq LIMIT 1`,
    { id: trip.id, last: trip.stop_count }, tx);
  if (open) throw unprocessable(`Stop ${open.seq} (${open.name}) is still open. Deliver or skip it before the final stop.`, { code: 'STOP_OPEN' });
}

export async function deliveredSoFar(tx: any, tripId: number, exceptStopId?: number): Promise<number> {
  const r = await q1<{ s: number }>(`SELECT COALESCE(sum(delivered_mt), 0)::float AS s FROM trip_stops WHERE trip_id = :id AND status = 'DELIVERED' AND (:ex::int IS NULL OR id <> :ex::int)`, { id: tripId, ex: exceptStopId ?? null }, tx);
  return r!.s;
}

export type StopAction = 'arrive' | 'deliver' | 'skip';
export interface StopPayload { deliveredMt?: number; receivedBy?: string; deliveryNoteNo?: string; podNotes?: string; reason?: string; clientEventId?: string; lat?: number; lng?: number }

/** Arrive / deliver / skip an INTERMEDIATE stop while the vehicle is on the road. The final stop uses the trip's own Arrived / Delivered steps. */
export async function stopAction(user: AuthUser, req: Request, tripId: number, stopId: number, action: StopAction, p: StopPayload) {
  return sequelize.transaction(async (tx) => {
    const t = await q1<any>('SELECT * FROM trips WHERE id = :id FOR UPDATE', { id: tripId }, tx);
    if (!t) throw notFound('Trip');
    if (user.role === 'DRIVER' && t.driver_id !== user.driverId) throw forbidden('You can only update trips assigned to you.');
    if (p.clientEventId && (await q1<any>('SELECT 1 AS x FROM trip_events WHERE trip_id = :id AND client_event_id = :c', { id: tripId, c: p.clientEventId }, tx))) return tripId;
    const s = await q1<any>(`SELECT ${STOP_SELECT} ${STOP_FROM} WHERE s.id = :sid AND s.trip_id = :tid FOR UPDATE OF s`, { sid: stopId, tid: tripId }, tx);
    if (!s) throw notFound('Stop');
    if (!['IN_TRANSIT', 'DELAYED'].includes(t.status)) throw conflict(`Trip ${t.code} is ${t.status.toLowerCase().replace('_', ' ')}; stops can only be updated while the vehicle is on the road.`);
    if (s.seq >= t.stop_count) throw badRequest("The final stop is completed with the trip's Arrived and Delivered steps.");
    const earlier = await q1<any>(`SELECT s2.seq, l.name FROM trip_stops s2 JOIN locations l ON l.id = s2.location_id WHERE s2.trip_id = :t AND s2.seq < :seq AND s2.status IN ('PENDING','ARRIVED') ORDER BY s2.seq LIMIT 1`, { t: tripId, seq: s.seq }, tx);
    if (earlier) throw unprocessable(`Handle stop ${earlier.seq} (${earlier.name}) first — stops are served in order.`);
    const label = `stop ${s.seq} (${s.location_name})`;
    const pos = { lat: s.lat, lng: s.lng };
    let msg: string; let type = 'STOP';
    if (action === 'arrive') {
      if (s.status !== 'PENDING') throw conflict(`Already ${s.status.toLowerCase()} at ${label}.`);
      await exec(`UPDATE trip_stops SET status = 'ARRIVED', arrived_at = now() WHERE id = :id`, { id: s.id }, tx);
      msg = `Arrived at ${label}`;
    } else if (action === 'deliver') {
      if (!['PENDING', 'ARRIVED'].includes(s.status)) throw conflict(`${label} is already ${s.status.toLowerCase()}.`);
      const loaded = Number(t.loaded_mt ?? t.planned_load_mt);
      const done = await deliveredSoFar(tx, tripId, s.id);
      if (!p.deliveredMt || p.deliveredMt <= 0) throw badRequest('Enter the delivered quantity.', { fields: { deliveredMt: 'Required' } });
      if (p.deliveredMt > loaded - done + 0.5) throw unprocessable(`Only ${(loaded - done).toFixed(2)} MT is still on board (loaded ${loaded} MT, ${done.toFixed(2)} MT already delivered).`);
      if (!p.receivedBy?.trim()) throw badRequest('Enter who received the delivery.', { fields: { receivedBy: 'Required' } });
      await exec(`UPDATE trip_stops SET status = 'DELIVERED', delivered_mt = :mt, delivered_at = now(), arrived_at = COALESCE(arrived_at, now()), received_by = :rb, delivery_note_no = :dn, pod_notes = :pn WHERE id = :id`,
        { id: s.id, mt: p.deliveredMt, rb: p.receivedBy.trim(), dn: p.deliveryNoteNo ?? null, pn: p.podNotes ?? null }, tx);
      msg = `Delivered ${p.deliveredMt} MT at ${label}, received by ${p.receivedBy.trim()}`;
    } else {
      if (!p.reason?.trim()) throw badRequest('Give a reason for skipping this stop.', { fields: { reason: 'Required' } });
      if (!['PENDING', 'ARRIVED'].includes(s.status)) throw conflict(`${label} is already ${s.status.toLowerCase()}.`);
      await exec(`UPDATE trip_stops SET status = 'SKIPPED', skip_reason = :r WHERE id = :id`, { id: s.id, r: p.reason.trim() }, tx);
      msg = `Skipped ${label}: ${p.reason.trim()}`; type = 'ALERT';
    }
    await exec(`UPDATE trips SET cur_lat = :lat, cur_lng = :lng, cur_speed_kmh = 0, progress_pct = GREATEST(progress_pct, :pct), last_position_at = now(), updated_at = now() WHERE id = :id`,
      { id: tripId, lat: pos.lat, lng: pos.lng, pct: Math.round(Number(s.route_frac) * 1000) / 10 }, tx);
    await recomputeTotals(tx, tripId);
    await addEvent(tx, tripId, { type, message: msg, actor: user.id, lat: p.lat ?? pos.lat, lng: p.lng ?? pos.lng, clientEventId: p.clientEventId });
    await audit(req, { action: `STOP_${action.toUpperCase()}`, entityType: 'TRIP', entityId: tripId, entityLabel: t.code, meta: { stopId, seq: s.seq }, tx });
    if (action !== 'arrive') await notify({ entityType: 'TRIP', entityId: tripId, tx, type: action === 'skip' ? 'TRIP_STOP_SKIPPED' : 'TRIP_STOP_DELIVERED', severity: action === 'skip' ? 'WARNING' : 'SUCCESS', title: `Trip ${t.code}: ${action === 'skip' ? 'skipped' : 'delivered at'} ${s.location_name}`, body: msg, roles: AUDIENCE.OPS });
    return tripId;
  });
}

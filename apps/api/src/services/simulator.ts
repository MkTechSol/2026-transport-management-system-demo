import { q, q1, exec, sequelize } from '../db/sequelize';
import { config } from '../config';
import { logger } from '../logger';
import { LatLng, pointAt } from '../lib/geo';
import { addEvent, transitionTrip } from './trips';
import { AUDIENCE, notify } from './notify';

/**
 * DEMO GPS simulator. Moves IN_TRANSIT / DELAYED / RETURNING trips along their route polyline.
 * - Only one instance ticks at a time (Postgres advisory lock), so it is safe with multiple API replicas.
 * - Positions advance `SIM_SPEEDUP`x faster than real time so movement is visible in a short demo.
 * - It never changes trip status except raising DELAYED when the ETA slips (as a real tracker would).
 * Real deployments disable it (SIM_ENABLED=false) and use POST /tracking/positions from the driver app.
 */
const LOCK_KEY = 874_221;
let timer: NodeJS.Timeout | null = null;
let tickNo = 0;

export async function simulateTick(dtSeconds = config.SIM_TICK_SECONDS): Promise<number> {
  const trips = await q<any>(
    `SELECT t.id, t.code, t.status, t.progress_pct, t.vehicle_id, t.planned_arrival, t.delay_minutes, t.eta_at, t.stop_count,
            r.path, r.distance_km, r.checkpoints, v.code AS vehicle_code
       FROM trips t JOIN routes r ON r.id = t.route_id JOIN vehicles v ON v.id = t.vehicle_id
      WHERE t.status IN ('IN_TRANSIT','DELAYED','RETURNING')`,
  );
  tickNo++;
  for (const t of trips) {
    const path = t.path as LatLng[];
    const dist = Number(t.distance_km);
    const wave = 1 + 0.18 * Math.sin((tickNo + t.id * 7) / 4);
    const base = t.status === 'DELAYED' ? 34 : t.status === 'RETURNING' ? 52 : 48;
    const prev = Number(t.progress_pct);
    // slow down near the ends of the leg (town driving)
    const taper = prev < 5 || prev > 95 ? 0.55 : 1;
    const speed = Math.round(base * wave * taper);
    const advanceKm = (speed * dtSeconds * config.SIM_SPEEDUP) / 3600;
    let next = Math.min(100, prev + (advanceKm / dist) * 100);
    // Multi-drop: the vehicle halts at the next unserved intermediate stop and waits for the driver to confirm the drop.
    let holdStop: { id: number; seq: number; status: string; frac: number; name: string } | null = null;
    let stopArrival = false;
    if (t.stop_count > 1 && t.status !== 'RETURNING') {
      holdStop = await q1<any>(`SELECT s.id, s.seq, s.status, s.route_frac::float AS frac, l.name FROM trip_stops s JOIN locations l ON l.id = s.location_id
                                 WHERE s.trip_id = :id AND s.seq < :last AND s.status IN ('PENDING','ARRIVED') ORDER BY s.seq LIMIT 1`, { id: t.id, last: t.stop_count });
      if (holdStop) {
        const at = holdStop.frac * 100;
        if (holdStop.status === 'ARRIVED') next = Math.max(prev, at);
        else if (next >= at) { next = Math.max(prev, at); stopArrival = true; }
      }
    }
    const waiting = !!holdStop && (holdStop.status === 'ARRIVED' || stopArrival);
    const arrived = next >= 100;
    const frac = (arrived ? 100 : next) / 100;
    const { point, heading } = pointAt(t.status === 'RETURNING' ? [...path].reverse() : path, frac);
    const remainingKm = dist * (1 - frac);
    const etaMin = remainingKm / Math.max(30, base) * 60;
    const shownSpeed = arrived || waiting ? 0 : speed;
    await exec(
      `UPDATE trips SET progress_pct = :p, cur_lat = :lat, cur_lng = :lng, cur_speed_kmh = :sp, eta_at = now() + (:eta || ' minutes')::interval, last_position_at = now() WHERE id = :id`,
      { id: t.id, p: Math.round(next * 10) / 10, lat: point[0], lng: point[1], sp: shownSpeed, eta: String(Math.round(etaMin)) },
    );
    await exec(`UPDATE vehicles SET last_lat = :lat, last_lng = :lng, last_speed_kmh = :sp, last_position_at = now(), last_location_id = NULL WHERE id = :id`, { id: t.vehicle_id, lat: point[0], lng: point[1], sp: shownSpeed });
    if (tickNo % 2 === 0)
      await exec(`INSERT INTO trip_positions (trip_id, lat, lng, speed_kmh, heading, recorded_at) VALUES (:t, :lat, :lng, :sp, :hd, now())`, { t: t.id, lat: point[0], lng: point[1], sp: shownSpeed, hd: heading });

    // checkpoint events (outbound only), once each
    if (t.status !== 'RETURNING')
      for (const cp of (t.checkpoints ?? []) as { name: string; at: number }[]) {
        if (prev / 100 < cp.at && frac >= cp.at) await addEvent(null, t.id, { type: 'CHECKPOINT', message: `Passed ${cp.name}`, lat: point[0], lng: point[1] });
      }
    if (stopArrival && holdStop) {
      await exec(`UPDATE trip_stops SET status = 'ARRIVED', arrived_at = now() WHERE id = :id AND status = 'PENDING'`, { id: holdStop.id });
      await addEvent(null, t.id, { type: 'STOP', message: `Arrived at stop ${holdStop.seq} (${holdStop.name})`, lat: point[0], lng: point[1] });
      await notify({ type: 'GEOFENCE_ARRIVAL', severity: 'INFO', roles: AUDIENCE.OPS, entityType: 'TRIP', entityId: t.id, title: `${t.vehicle_code} reached ${holdStop.name}`,
        body: `Trip ${t.code}: stop ${holdStop.seq} of ${t.stop_count} — confirm the delivery.`, dedupeKey: `geofence:${t.id}:stop${holdStop.seq}` });
    } else if (arrived) {
      await notify({
        type: 'GEOFENCE_ARRIVAL', severity: 'INFO', roles: AUDIENCE.OPS, entityType: 'TRIP', entityId: t.id,
        title: `${t.vehicle_code} reached ${t.status === 'RETURNING' ? 'the plant' : 'destination'}`,
        body: `Trip ${t.code}: ${t.status === 'RETURNING' ? 'confirm return to complete the trip.' : 'mark arrived and confirm delivery.'}`,
        dedupeKey: `geofence:${t.id}:${t.status === 'RETURNING' ? 'ret' : 'out'}`,
      });
    } else if (!waiting && t.status === 'IN_TRANSIT' && new Date(Date.now() + etaMin * 60_000).getTime() > new Date(t.planned_arrival).getTime() + 30 * 60_000) {
      try {
        await transitionTrip(null, undefined, t.id, 'DELAYED', { note: `projected ${Math.round((Date.now() + etaMin * 60_000 - new Date(t.planned_arrival).getTime()) / 60000)} min behind plan` });
      } catch (e) { logger.debug({ err: e }, 'delay auto-flag skipped'); }
    }
  }
  return trips.length;
}

export function startSimulator() {
  if (timer) return;
  const run = async () => {
    // Advisory lock held only for the duration of one tick on a dedicated connection.
    try {
      await sequelize.transaction(async (tx) => {
        const [row] = (await q<any>('SELECT pg_try_advisory_xact_lock(:k) AS ok', { k: LOCK_KEY }, tx));
        if (!row.ok) return;
        await simulateTick();
      });
    } catch (e) { logger.error({ err: e }, 'simulator tick failed'); }
  };
  timer = setInterval(run, config.SIM_TICK_SECONDS * 1000);
  timer.unref();
  logger.info(`GPS simulator started (tick ${config.SIM_TICK_SECONDS}s, speed-up x${config.SIM_SPEEDUP})`);
}
export function stopSimulator() { if (timer) clearInterval(timer); timer = null; }

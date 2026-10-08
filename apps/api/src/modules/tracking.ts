import { Router } from 'express';
import { z } from 'zod';
import { q, q1, exec, sequelize } from '../db/sequelize';
import { forbidden, notFound } from '../lib/errors';
import { id, parse, wrap } from '../lib/http';
import { MOVING_STATUS_SQL } from '../lib/sql';
import { progressOnPath, LatLng, haversineKm } from '../lib/geo';
import { requirePerm } from '../middleware/auth';
import { TtlCache } from '../lib/cache';

export const trackingRouter = Router();
const liveCache = new TtlCache<any>(2000);

/** Everything the live map needs in ONE indexed query (no per-vehicle round trips). */
trackingRouter.get('/live', requirePerm('tracking:view'), wrap(async (req, res) => {
  const out = await liveCache.get('live', async () => {
    const rows = await q(`
      SELECT t.id AS trip_id, t.code AS trip_code, t.status, t.progress_pct, t.cur_lat AS lat, t.cur_lng AS lng, t.cur_speed_kmh AS speed_kmh,
             t.eta_at, t.last_position_at, t.planned_arrival, t.delay_minutes, t.planned_load_mt,
             v.id AS vehicle_id, v.code AS vehicle_code, d.full_name AS driver_name,
             o.name AS origin_name, dl.name AS destination_name, o.lat AS origin_lat, o.lng AS origin_lng, dl.lat AS dest_lat, dl.lng AS dest_lng
        FROM trips t JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id
        JOIN locations o ON o.id = t.origin_location_id JOIN locations dl ON dl.id = t.destination_location_id
       WHERE t.status IN ('IN_TRANSIT','DELAYED','RETURNING','ARRIVED','DISPATCHED','ON_HOLD','DELIVERED') AND t.cur_lat IS NOT NULL
       ORDER BY t.status = 'DELAYED' DESC, t.last_position_at DESC NULLS LAST LIMIT 500`);
    const summary = {
      moving: rows.filter((r) => (r.speed_kmh ?? 0) > 3 && ['IN_TRANSIT', 'DELAYED', 'RETURNING'].includes(r.status)).length,
      stopped: rows.filter((r) => (r.speed_kmh ?? 0) <= 3).length,
      delayed: rows.filter((r) => r.status === 'DELAYED').length,
      total: rows.length,
    };
    return { data: rows, summary, serverTime: new Date().toISOString() };
  });
  let data = out.data;
  if (req.user!.role === 'DRIVER') data = data.filter((r: any) => false);
  res.json({ ...out, data });
}));

trackingRouter.get('/trips/:id', requirePerm('tracking:view', 'trips:view'), wrap(async (req, res) => {
  const tid = id(req);
  const t = await q1<any>(`SELECT t.id, t.code, t.status, t.progress_pct, t.cur_lat, t.cur_lng, t.cur_speed_kmh, t.eta_at, t.last_position_at, t.driver_id, t.route_id, t.delay_minutes,
                                  r.path, r.checkpoints, r.distance_km FROM trips t LEFT JOIN routes r ON r.id = t.route_id WHERE t.id = :id`, { id: tid });
  if (!t) throw notFound('Trip');
  if (req.user!.role === 'DRIVER' && t.driver_id !== req.user!.driverId) throw forbidden();
  const trail = await q(`SELECT lat, lng, speed_kmh, recorded_at FROM trip_positions WHERE trip_id = :id ORDER BY recorded_at DESC LIMIT 300`, { id: tid });
  res.json({ trip: { ...t, path: undefined, checkpoints: undefined }, path: t.path ?? [], checkpoints: t.checkpoints ?? [], trail: trail.reverse() });
}));

/**
 * Mobile GPS ingestion. Batched so a driver app can upload buffered offline pings in one request.
 * Idempotent on (trip_id, recorded_at) so retries never duplicate points.
 */
const posBody = z.object({
  positions: z.array(z.object({
    tripId: z.coerce.number().int().positive(),
    lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
    speedKmh: z.number().min(0).max(200).optional(), heading: z.number().min(0).max(360).optional(),
    recordedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s))),
  })).min(1).max(200),
});
trackingRouter.post('/positions', requirePerm('trips:progress'), wrap(async (req, res) => {
  const { positions } = parse(posBody, req.body);
  const tripIds = [...new Set(positions.map((p) => p.tripId))];
  const trips = await q<any>(`SELECT t.id, t.status, t.driver_id, t.vehicle_id, t.planned_arrival, r.path, r.distance_km FROM trips t LEFT JOIN routes r ON r.id = t.route_id WHERE t.id IN (:ids)`, { ids: tripIds });
  const byId = new Map(trips.map((t) => [t.id, t]));
  let accepted = 0;
  await sequelize.transaction(async (tx) => {
    const latest = new Map<number, (typeof positions)[number]>();
    for (const p of positions) {
      const t = byId.get(p.tripId);
      if (!t) continue;
      if (req.user!.role === 'DRIVER' && t.driver_id !== req.user!.driverId) throw forbidden('You can only send positions for your own trip.');
      if (!['IN_TRANSIT', 'DELAYED', 'RETURNING', 'DISPATCHED', 'ARRIVED'].includes(t.status)) continue;
      const dup = await q1(`SELECT 1 AS x FROM trip_positions WHERE trip_id = :t AND recorded_at = :at`, { t: p.tripId, at: new Date(p.recordedAt).toISOString() }, tx);
      if (dup) continue;
      await exec(`INSERT INTO trip_positions (trip_id, lat, lng, speed_kmh, heading, recorded_at) VALUES (:t, :lat, :lng, :sp, :hd, :at)`,
        { t: p.tripId, lat: p.lat, lng: p.lng, sp: p.speedKmh != null ? Math.round(p.speedKmh) : null, hd: p.heading != null ? Math.round(p.heading) : null, at: new Date(p.recordedAt).toISOString() }, tx);
      accepted++;
      const cur = latest.get(p.tripId);
      if (!cur || Date.parse(p.recordedAt) > Date.parse(cur.recordedAt)) latest.set(p.tripId, p);
    }
    for (const [tid, p] of latest) {
      const t = byId.get(tid)!;
      let progress: number | null = null; let eta: string | null = null;
      if (t.path?.length) {
        const frac = progressOnPath(t.path as LatLng[], [p.lat, p.lng]);
        progress = Math.round((t.status === 'RETURNING' ? frac : frac) * 1000) / 10;
        const remainingKm = Number(t.distance_km) * (1 - frac);
        const speed = Math.max(25, p.speedKmh ?? 45);
        eta = new Date(Date.now() + (remainingKm / speed) * 3600_000).toISOString();
      }
      await exec(`UPDATE trips SET cur_lat = :lat, cur_lng = :lng, cur_speed_kmh = :sp, last_position_at = :at, progress_pct = COALESCE(:pr, progress_pct), eta_at = COALESCE(:eta, eta_at) WHERE id = :id`,
        { id: tid, lat: p.lat, lng: p.lng, sp: Math.round(p.speedKmh ?? 0), at: new Date(p.recordedAt).toISOString(), pr: progress, eta }, tx);
      await exec(`UPDATE vehicles SET last_lat = :lat, last_lng = :lng, last_speed_kmh = :sp, last_position_at = :at WHERE id = :v`, { v: t.vehicle_id, lat: p.lat, lng: p.lng, sp: Math.round(p.speedKmh ?? 0), at: new Date(p.recordedAt).toISOString() }, tx);
    }
  });
  liveCache.clear();
  res.status(202).json({ accepted, received: positions.length });
}));

export { haversineKm };

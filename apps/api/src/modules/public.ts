import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { q, q1 } from '../db/sequelize';
import { notFound } from '../lib/errors';
import { wrap } from '../lib/http';

export const publicRouter = Router();
publicRouter.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } } }));

/**
 * Customer-facing tracking link (legacy header had a "Tracking Link"). Token-gated, read-only, minimal data:
 * no driver identity, phone numbers, financials or internal ids.
 */
publicRouter.get('/track/:token', wrap(async (req, res) => {
  const tok = String(req.params.token);
  if (!/^[\w-]{20,40}$/.test(tok)) throw notFound('Tracking link');
  const t = await q1<any>(
    `SELECT t.id, t.code, t.status, t.progress_pct, t.cur_lat, t.cur_lng, t.cur_speed_kmh, t.eta_at, t.last_position_at, t.scheduled_departure, t.planned_arrival, t.planned_load_mt, t.delivered_at, t.completed_at, t.delivered_mt,
            o.name AS origin_name, o.lat AS origin_lat, o.lng AS origin_lng, dl.name AS destination_name, dl.lat AS dest_lat, dl.lng AS dest_lng, v.code AS vehicle_code, r.path, t.stop_count
       FROM trips t JOIN locations o ON o.id = t.origin_location_id JOIN locations dl ON dl.id = t.destination_location_id LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN routes r ON r.id = t.route_id
      WHERE t.public_token = :tok AND t.status NOT IN ('DRAFT','CANCELLED')`, { tok });
  if (!t) throw notFound('Tracking link');
  const events = await q(`SELECT type, to_status, message, occurred_at FROM trip_events WHERE trip_id = :id AND (type = 'CHECKPOINT' OR (type = 'STATUS_CHANGE' AND to_status IN ('DISPATCHED','IN_TRANSIT','DELAYED','ON_HOLD','ARRIVED','DELIVERED','RETURNING','COMPLETED'))) ORDER BY occurred_at DESC LIMIT 12`, { id: t.id });
  const GENERIC: Record<string, string> = { DISPATCHED: 'Vehicle released from the loading point', IN_TRANSIT: 'Departed — on the way', DELAYED: 'Running late', ON_HOLD: 'Temporarily halted', ARRIVED: 'Arrived at destination', DELIVERED: 'Delivery completed', RETURNING: 'Vehicle returning', COMPLETED: 'Trip completed' };
  const stops = t.stop_count > 1 ? await q(`SELECT s.seq, COALESCE(l.city, l.name) AS place, s.status, s.eta_at, s.delivered_at FROM trip_stops s JOIN locations l ON l.id = s.location_id WHERE s.trip_id = :id ORDER BY s.seq`, { id: t.id }) : [];
  const { id: _omit, stop_count: _sc, ...pub } = t;
  res.json({ trip: pub, stops, events: events.map((e: any) => ({ at: e.occurred_at, text: e.type === 'CHECKPOINT' ? e.message : GENERIC[e.to_status] })) });
}));

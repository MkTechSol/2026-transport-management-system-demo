import { sequelize, q, q1, exec } from '../db/sequelize';
import { planStops } from '../services/trips';
import { addEvent } from '../services/tripStops';
import type { Rng } from './rng';

/**
 * Stops for every seeded trip. Every trip gets one stop (its destination); then a share of delivery trips is turned into
 * multi-drop trips (A -> B, C [, D]) using the same planner the API uses, so routes, ETAs and rates match what users create.
 */
export async function seedStops(c: { rng: Rng; NOW: number; log?: (m: string) => void }) {
  const { rng, NOW } = c;
  await exec(`INSERT INTO trip_stops (trip_id, seq, location_id, distributor_id, planned_mt, delivered_mt, status, route_frac, eta_at, arrived_at, delivered_at, received_by, delivery_note_no, pod_notes, freight_per_mt, bill_to_id)
    SELECT t.id, 1, t.destination_location_id, t.distributor_id, t.planned_load_mt, t.delivered_mt,
           CASE WHEN t.status IN ('DELIVERED','RETURNING','COMPLETED') THEN 'DELIVERED' WHEN t.status = 'ARRIVED' THEN 'ARRIVED' ELSE 'PENDING' END,
           1, t.planned_arrival, t.arrived_at, t.delivered_at, t.received_by, t.delivery_note_no, t.pod_notes, COALESCE(t.freight_per_mt, 0), COALESCE(t.bill_to_id, t.distributor_id) FROM trips t`);

  const trips = await q<any>(`SELECT t.*, l.region AS dest_region, l.city AS dest_city FROM trips t JOIN locations l ON l.id = t.destination_location_id
    WHERE t.trip_type = 'DELIVERY' AND t.distributor_id IS NOT NULL AND t.status <> 'CANCELLED' AND t.lpg_source = 'LOCAL' ORDER BY t.id`);
  const dists = await q<any>(`SELECT d.id, d.name, d.contact_name, d.location_id, l.region, l.city FROM distributors d JOIN locations l ON l.id = d.location_id WHERE d.status = 'ACTIVE' AND d.customer_type = 'DISTRIBUTOR'`);
  const LIVE = ['IN_TRANSIT', 'DELAYED', 'ASSIGNED', 'PLANNED'];
  let made = 0; let liveMade = 0;
  for (const t of trips) {
    const isLive = LIVE.includes(t.status);
    const eligible = (t.status === 'COMPLETED' && Number(t.delivered_mt) >= 12 && rng.chance(0.13)) || (isLive && t.status !== 'DELAYED' && Number(t.planned_load_mt) >= 12 && liveMade < 3 && Number(t.progress_pct) <= 40);
    if (!eligible) continue;
    // 1-2 extra drops in the same region, other than origin / final destination / each other
    const pool = rng.shuffle(dists.filter((d) => d.region === t.dest_region && d.location_id !== t.destination_location_id && d.location_id !== t.origin_location_id));
    const extras: any[] = [];
    for (const d of pool) { if (!extras.some((e) => e.location_id === d.location_id)) extras.push(d); if (extras.length >= (rng.chance(0.3) ? 2 : 1)) break; }
    if (!extras.length) continue;
    const total = Number(t.status === 'COMPLETED' ? t.delivered_mt : t.planned_load_mt);
    const shares = extras.map(() => Math.round(total * rng.float(0.22, 0.38) * 10) / 10);
    const last = Math.round((total - shares.reduce((a, b) => a + b, 0)) * 100) / 100;
    if (last < 3) continue;
    const input = [...extras.map((d, i) => ({ locationId: d.location_id, distributorId: d.id, plannedMt: shares[i] })), { locationId: t.destination_location_id, distributorId: t.distributor_id, plannedMt: last, billToId: t.bill_to_id ?? t.distributor_id }];
    await sequelize.transaction(async (tx) => {
      const plan = await planStops(tx, t.origin_location_id, input, { requireActiveDistributor: false });
      const first = plan.rows[0];
      // an in-flight trip must still have its first drop ahead of it
      if (isLive && t.status === 'IN_TRANSIT' && first.routeFrac * 100 <= Number(t.progress_pct) + 8) throw new Error('skip');
      const dep = new Date(t.scheduled_departure).getTime();
      const end = t.delivered_at ? new Date(t.delivered_at).getTime() : dep + plan.durationMin * 60_000;
      await exec('DELETE FROM trip_stops WHERE trip_id = :id', { id: t.id }, tx);
      for (const r of plan.rows) {
        const final = r.seq === plan.rows.length;
        const doneStop = t.status === 'COMPLETED';
        const at = final ? end : new Date(dep + (end - dep) * Math.min(0.95, r.routeFrac)).getTime();
        await exec(`INSERT INTO trip_stops (trip_id, seq, location_id, distributor_id, planned_mt, delivered_mt, status, route_frac, eta_at, arrived_at, delivered_at, received_by, delivery_note_no, freight_per_mt, bill_to_id)
          VALUES (:t, :seq, :loc, :dist, :mt, :dmt, :st, :frac, :eta, :arr, :del, :rb, :dn, :fr, :bill)`,
          { t: t.id, seq: r.seq, loc: r.locationId, dist: r.distributorId, mt: r.plannedMt, dmt: doneStop ? r.plannedMt : null, st: doneStop ? 'DELIVERED' : 'PENDING', frac: r.routeFrac,
            eta: new Date(dep + r.etaMin * 60_000).toISOString(), arr: doneStop ? new Date(at - 20 * 60_000).toISOString() : null, del: doneStop ? new Date(at).toISOString() : null,
            rb: doneStop ? (final ? t.received_by : extras[r.seq - 1].contact_name) ?? 'Station manager' : null, dn: doneStop ? (final ? t.delivery_note_no : `DN-${t.id}-${r.seq}`) : null, fr: r.freightPerMt, bill: r.billToId }, tx);
        if (doneStop && !final) await addEvent(tx, t.id, { type: 'STOP', message: `Delivered ${r.plannedMt} MT at stop ${r.seq} (${extras[r.seq - 1].name})`, at: new Date(at) });
      }
      await exec(`UPDATE trips SET route_id = :rid, stop_count = :sc, freight_per_mt = :fr, bill_to_id = COALESCE(bill_to_id, :bill), planned_load_mt = CASE WHEN status = 'COMPLETED' THEN planned_load_mt ELSE :load END WHERE id = :id`,
        { id: t.id, rid: plan.route.id, sc: plan.rows.length, fr: plan.rate, bill: plan.billToId, load: plan.load }, tx);
      if (t.status === 'COMPLETED') await exec(`UPDATE trips SET planned_arrival = :pa WHERE id = :id`, { id: t.id, pa: new Date(dep + plan.durationMin * 60_000).toISOString() }, tx);
      else await exec(`UPDATE trips SET planned_arrival = :pa WHERE id = :id`, { id: t.id, pa: new Date(dep + plan.durationMin * 60_000).toISOString() }, tx);
    }).then(() => { made++; if (isLive) liveMade++; }).catch((e) => { if (e.message !== 'skip') throw e; });
  }
  c.log?.(`multi-drop: ${made} trips with several delivery stops (${liveMade} in flight or upcoming)`);
  void NOW; void q1;
}

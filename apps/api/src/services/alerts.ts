import { DOC_TYPE_LABELS } from '@gasman/shared';
import { q } from '../db/sequelize';
import { logger } from '../logger';
import { AUDIENCE, notify } from './notify';

/** Derives compliance / maintenance notifications from live data. Idempotent (dedupe keys) - safe to run often. */
export async function generateComplianceAlerts(): Promise<number> {
  let n = 0;
  const docs = await q<any>(
    `SELECT d.id, d.doc_type, d.expires_on, (d.expires_on - CURRENT_DATE)::int AS days_left, v.id AS vehicle_id, v.code AS vehicle_code, dr.id AS driver_id, dr.full_name AS driver_name
       FROM documents d LEFT JOIN vehicles v ON v.id = d.vehicle_id LEFT JOIN drivers dr ON dr.id = d.driver_id
      WHERE d.expires_on <= CURRENT_DATE + 30 AND COALESCE(v.archived_at, dr.archived_at) IS NULL
        AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.doc_type = d.doc_type AND x.expires_on > d.expires_on AND x.vehicle_id IS NOT DISTINCT FROM d.vehicle_id AND x.driver_id IS NOT DISTINCT FROM d.driver_id)`,
  );
  for (const d of docs) {
    const owner = d.vehicle_code ? `Vehicle ${d.vehicle_code}` : `Driver ${d.driver_name}`;
    const name = DOC_TYPE_LABELS[d.doc_type] ?? d.doc_type;
    const expired = d.days_left < 0;
    await notify({
      type: d.driver_id ? (expired ? 'DRIVER_DOC_EXPIRED' : 'DRIVER_LICENSE_EXPIRING') : expired ? 'VEHICLE_DOC_EXPIRED' : 'VEHICLE_DOC_EXPIRING',
      severity: expired ? 'CRITICAL' : d.days_left <= 7 ? 'WARNING' : 'INFO', roles: AUDIENCE.FLEET,
      entityType: d.vehicle_id ? 'VEHICLE' : 'DRIVER', entityId: d.vehicle_id ?? d.driver_id,
      title: expired ? `${owner}: ${name} expired` : `${owner}: ${name} expires in ${d.days_left} day${d.days_left === 1 ? '' : 's'}`,
      body: `Expiry date ${String(d.expires_on)}. Renew before assigning to trips.`,
      dedupeKey: `doc:${d.id}:${expired ? 'expired' : d.days_left <= 7 ? 'w1' : 'w4'}`,
    });
    n++;
  }
  const maint = await q<any>(`SELECT m.id, m.title, m.scheduled_on, (m.scheduled_on - CURRENT_DATE)::int AS days_left, v.id AS vehicle_id, v.code FROM maintenance_records m JOIN vehicles v ON v.id = m.vehicle_id WHERE m.status = 'SCHEDULED' AND m.scheduled_on <= CURRENT_DATE + 7`);
  for (const m of maint) {
    await notify({ type: 'MAINTENANCE_DUE', severity: m.days_left < 0 ? 'CRITICAL' : 'WARNING', roles: AUDIENCE.FLEET, entityType: 'VEHICLE', entityId: m.vehicle_id,
      title: m.days_left < 0 ? `${m.code}: maintenance overdue — ${m.title}` : `${m.code}: maintenance due in ${m.days_left} day${m.days_left === 1 ? '' : 's'} — ${m.title}`,
      dedupeKey: `maint:${m.id}:${m.days_left < 0 ? 'overdue' : 'due'}` });
    n++;
  }
  logger.debug({ n }, 'compliance alerts evaluated');
  return n;
}

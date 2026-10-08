import type { Role } from '@gasman/shared';
import { exec } from '../db/sequelize';
import { logger } from '../logger';

export interface NotifyInput {
  userId?: number;
  roles?: Role[];
  type: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL' | 'SUCCESS';
  title: string;
  body?: string;
  entityType?: 'TRIP' | 'VEHICLE' | 'DRIVER' | 'INCIDENT' | 'MAINTENANCE';
  entityId?: number;
  /** When set, a second notification with the same key is silently ignored (idempotent alerts). */
  dedupeKey?: string;
  tx?: any;
}

const MGMT: Role[] = ['SUPER_ADMIN', 'TRANSPORT_MANAGER', 'DISPATCHER', 'FLEET_MANAGER', 'MANAGEMENT_VIEWER'];
export const AUDIENCE = {
  OPS: ['SUPER_ADMIN', 'TRANSPORT_MANAGER', 'DISPATCHER'] as Role[],
  FLEET: ['SUPER_ADMIN', 'TRANSPORT_MANAGER', 'FLEET_MANAGER'] as Role[],
  ALL_STAFF: MGMT,
};

export async function notify(n: NotifyInput) {
  try {
    const roles = n.userId ? null : n.roles ?? AUDIENCE.OPS;
    await exec(
      `INSERT INTO notifications (user_id, roles, type, severity, title, body, entity_type, entity_id, dedupe_key)
       VALUES (:uid, ${roles ? 'ARRAY[:roles]::varchar[]' : 'NULL'}, :type, :sev, :title, :body, :et, :eid, :dk)
       ON CONFLICT DO NOTHING`,
      {
        uid: n.userId ?? null,
        roles: roles ?? [],
        type: n.type,
        sev: n.severity ?? 'INFO',
        title: n.title,
        body: n.body ?? null,
        et: n.entityType ?? null,
        eid: n.entityId ?? null,
        dk: n.dedupeKey ?? null,
      },
      n.tx,
    );
  } catch (e) {
    logger.error({ err: e }, 'failed to create notification');
  }
}

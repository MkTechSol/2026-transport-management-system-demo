import type { Request } from 'express';
import { exec } from '../db/sequelize';
import { logger } from '../logger';

interface AuditInput {
  action: string;
  entityType?: string;
  entityId?: number | null;
  entityLabel?: string | null;
  meta?: Record<string, unknown>;
  tx?: any;
}

export async function audit(req: Request | undefined, input: AuditInput & { userId?: number; email?: string }) {
  try {
    await exec(
      `INSERT INTO audit_logs (user_id, user_email, action, entity_type, entity_id, entity_label, ip, meta)
       VALUES (:uid, :email, :action, :et, :eid, :label, :ip, :meta)`,
      {
        uid: req?.user?.id ?? input.userId ?? null,
        email: req?.user?.email ?? input.email ?? null,
        action: input.action,
        et: input.entityType ?? null,
        eid: input.entityId ?? null,
        label: input.entityLabel ?? null,
        ip: req?.ip ?? null,
        meta: input.meta ? JSON.stringify(input.meta) : null,
      },
      input.tx,
    );
  } catch (e) {
    // Audit failures must never break the business operation, but must be visible in logs.
    logger.error({ err: e }, 'failed to write audit log');
  }
}

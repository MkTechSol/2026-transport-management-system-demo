import type { Request } from 'express';
import type { Role } from '@gasman/shared';
import { q, q1, exec, sequelize } from '../db/sequelize';
import { badRequest, forbidden, notFound, conflict } from '../lib/errors';
import type { AuthUser } from '../middleware/auth';
import { audit } from './audit';
import { notify } from './notify';

export interface ApprovalHandler {
  onApproved: (entityId: number, ctx: { tx: any; user: AuthUser; req?: Request; note?: string }) => Promise<void>;
  onRejected: (entityId: number, ctx: { tx: any; user: AuthUser; req?: Request; note?: string }) => Promise<void>;
}
const handlers = new Map<string, ApprovalHandler>();
export const registerApprovalHandler = (type: string, h: ApprovalHandler) => handlers.set(type, h);

/** Picks the approver role from the rule with the highest min_amount not above the amount. */
export async function approverFor(entityType: string, amount: number | null, tx?: any): Promise<Role> {
  const r = await q1<{ approver_role: Role }>(
    `SELECT approver_role FROM approval_rules WHERE entity_type = :t AND active AND min_amount <= :a ORDER BY min_amount DESC LIMIT 1`, { t: entityType, a: amount ?? 0 }, tx);
  return r?.approver_role ?? 'TRANSPORT_MANAGER';
}

export async function requestApproval(o: { entityType: string; entityId: number; title: string; amount?: number | null; requestedBy?: number | null; tx?: any }) {
  const role = await approverFor(o.entityType, o.amount ?? null, o.tx);
  const row = await q1<any>(
    `INSERT INTO approvals (entity_type, entity_id, title, amount, requested_by, approver_role) VALUES (:t, :id, :title, :amt, :by, :role)
     ON CONFLICT (entity_type, entity_id) WHERE status = 'PENDING' DO NOTHING RETURNING *`,
    { t: o.entityType, id: o.entityId, title: o.title, amt: o.amount ?? null, by: o.requestedBy ?? null, role }, o.tx);
  if (row) await notify({ roles: role === 'SUPER_ADMIN' ? ['SUPER_ADMIN'] : [role, 'SUPER_ADMIN'], type: 'APPROVAL_REQUESTED', severity: 'INFO', title: `Approval needed: ${o.title}`, body: o.amount ? `PKR ${Number(o.amount).toLocaleString('en-US')}` : undefined, tx: o.tx });
  return row;
}

export async function decideApproval(user: AuthUser, req: Request | undefined, id: number, decision: 'APPROVED' | 'REJECTED', note?: string) {
  return sequelize.transaction(async (tx) => {
    const a = await q1<any>('SELECT * FROM approvals WHERE id = :id FOR UPDATE', { id }, tx);
    if (!a) throw notFound('Approval request');
    if (a.status !== 'PENDING') throw conflict(`This request was already ${a.status.toLowerCase()}.`);
    if (user.role !== 'SUPER_ADMIN' && user.role !== a.approver_role) throw forbidden(`This request must be decided by ${String(a.approver_role).replace(/_/g, ' ').toLowerCase()}.`);
    if (decision === 'REJECTED' && !note?.trim()) throw badRequest('Please give a reason for rejecting.', { fields: { note: 'Required when rejecting' } });
    await exec(`UPDATE approvals SET status = :s, decided_by = :u, decided_at = now(), decision_note = :n WHERE id = :id`, { s: decision, u: user.id, n: note ?? null, id }, tx);
    const h = handlers.get(a.entity_type);
    if (h) await (decision === 'APPROVED' ? h.onApproved : h.onRejected)(a.entity_id, { tx, user, req, note });
    await audit(req, { action: `APPROVAL_${decision}`, entityType: a.entity_type, entityId: a.entity_id, entityLabel: a.title, tx });
    if (a.requested_by) await notify({ userId: a.requested_by, type: 'APPROVAL_DECIDED', severity: decision === 'APPROVED' ? 'SUCCESS' : 'WARNING', title: `${decision === 'APPROVED' ? 'Approved' : 'Rejected'}: ${a.title}`, body: note, tx });
    return a.id as number;
  });
}
export const _q = q;

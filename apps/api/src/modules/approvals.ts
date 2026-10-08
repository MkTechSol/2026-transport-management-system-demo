import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '@gasman/shared';
import { q, q1, exec } from '../db/sequelize';
import { notFound } from '../lib/errors';
import { id, listResponse, paging, parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';
import { decideApproval } from '../services/approvals';

export const approvalsRouter = Router();

approvalsRouter.get('/', requirePerm('approvals:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ status: z.string().optional(), entityType: z.string().optional(), mine: z.enum(['true']).optional() }), req.query);
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset, role: req.user!.role };
  if (f.status) { where.push('a.status IN (:st)'); r.st = f.status.split(','); }
  if (f.entityType) { where.push('a.entity_type = :et'); r.et = f.entityType; }
  if (f.mine) where.push(`(a.approver_role = :role OR :role = 'SUPER_ADMIN')`);
  const w = where.join(' AND ');
  const from = `FROM approvals a LEFT JOIN users ru ON ru.id = a.requested_by LEFT JOIN users du ON du.id = a.decided_by WHERE ${w}`;
  const [rows, [{ total }], [stats]] = await Promise.all([
    q(`SELECT a.*, ru.full_name AS requested_by_name, du.full_name AS decided_by_name, (a.approver_role = :role OR :role = 'SUPER_ADMIN') AS can_decide
         ${from} ORDER BY (a.status = 'PENDING') DESC, a.requested_at DESC LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total ${from}`, r),
    q(`SELECT count(*) FILTER (WHERE status = 'PENDING' AND (approver_role = :role OR :role = 'SUPER_ADMIN'))::int AS pending_mine, count(*) FILTER (WHERE status = 'PENDING')::int AS pending_all,
              count(*) FILTER (WHERE status IN ('APPROVED','REJECTED') AND decided_at >= date_trunc('day', now()))::int AS decided_today,
              COALESCE(round(avg(extract(epoch FROM (decided_at - requested_at)) / 60) FILTER (WHERE decided_at IS NOT NULL AND decided_at > now() - interval '30 days')), 0)::int AS avg_decision_min,
              COALESCE(sum(amount) FILTER (WHERE status = 'PENDING'), 0)::float AS pending_amount FROM approvals`, { role: req.user!.role }),
  ]);
  res.json({ ...listResponse(rows, total, p.page, p.pageSize), stats });
}));

approvalsRouter.post('/:id/decide', requirePerm('approvals:decide'), wrap(async (req, res) => {
  const b = parse(z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().max(300).optional() }), req.body);
  await decideApproval(req.user!, req, id(req), b.decision, b.note);
  res.json({ ok: true });
}));

approvalsRouter.get('/rules', requirePerm('approvals:view'), wrap(async (_req, res) => {
  res.json({ data: await q('SELECT * FROM approval_rules ORDER BY entity_type, min_amount') });
}));
const rule = z.object({ entityType: z.string().trim().min(3).max(30), minAmount: z.coerce.number().min(0), approverRole: z.enum(ROLES), active: z.boolean().default(true), note: z.string().trim().max(200).optional() });
approvalsRouter.post('/rules', requirePerm('approvals:configure'), wrap(async (req, res) => {
  const b = parse(rule, req.body);
  const row = await q1(`INSERT INTO approval_rules (entity_type, min_amount, approver_role, active, note) VALUES (:t, :m, :r, :a, :n) RETURNING *`, { t: b.entityType.toUpperCase(), m: b.minAmount, r: b.approverRole, a: b.active, n: b.note ?? null });
  await audit(req, { action: 'APPROVAL_RULE_CREATED', entityType: 'SETTINGS', entityLabel: `${b.entityType} ≥ ${b.minAmount} → ${b.approverRole}` });
  res.status(201).json({ rule: row });
}));
approvalsRouter.patch('/rules/:id', requirePerm('approvals:configure'), wrap(async (req, res) => {
  const rid = id(req); const b = parse(rule.partial(), req.body);
  if (!(await q1('SELECT 1 AS x FROM approval_rules WHERE id = :id', { id: rid }))) throw notFound('Rule');
  await exec(`UPDATE approval_rules SET min_amount = COALESCE(:m, min_amount), approver_role = COALESCE(:r, approver_role), active = COALESCE(:a, active), note = COALESCE(:n, note) WHERE id = :id`, { id: rid, m: b.minAmount ?? null, r: b.approverRole ?? null, a: b.active ?? null, n: b.note ?? null });
  await audit(req, { action: 'APPROVAL_RULE_UPDATED', entityType: 'SETTINGS', entityId: rid });
  res.json({ rule: await q1('SELECT * FROM approval_rules WHERE id = :id', { id: rid }) });
}));
approvalsRouter.delete('/rules/:id', requirePerm('approvals:configure'), wrap(async (req, res) => {
  await exec('DELETE FROM approval_rules WHERE id = :id', { id: id(req) }); res.json({ ok: true });
}));

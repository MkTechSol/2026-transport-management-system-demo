import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db/sequelize';
import { likeTerm, listResponse, paging, parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';

export const auditRouter = Router();

auditRouter.get('/', requirePerm('audit:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ action: z.string().optional(), entityType: z.string().optional(), userId: z.coerce.number().optional(), entityId: z.coerce.number().optional(), from: z.string().optional(), to: z.string().optional() }), req.query);
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (f.action) { where.push('a.action = :action'); r.action = f.action; }
  if (f.entityType) { where.push('a.entity_type = :et'); r.et = f.entityType; }
  if (f.entityId) { where.push('a.entity_id = :eid'); r.eid = f.entityId; }
  if (f.userId) { where.push('a.user_id = :uid'); r.uid = f.userId; }
  if (f.from) { where.push('a.created_at >= :from'); r.from = f.from; }
  if (f.to) { where.push('a.created_at < (:to::date + 1)'); r.to = f.to; }
  if (p.q) { where.push('(a.user_email ILIKE :q OR a.entity_label ILIKE :q OR a.action ILIKE :q)'); r.q = likeTerm(p.q); }
  const w = where.join(' AND ');
  const [rows, [{ total }]] = await Promise.all([
    q(`SELECT a.* FROM audit_logs a WHERE ${w} ORDER BY a.id DESC LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total FROM audit_logs a WHERE ${w}`, r),
  ]);
  res.json(listResponse(rows, total, p.page, p.pageSize));
}));

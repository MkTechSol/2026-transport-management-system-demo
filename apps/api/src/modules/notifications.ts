import { Router } from 'express';
import { z } from 'zod';
import { q, q1, exec } from '../db/sequelize';
import { id, listResponse, paging, parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';

export const notificationsRouter = Router();
const VISIBLE = `(n.user_id = :uid OR (n.user_id IS NULL AND :role = ANY(n.roles)))`;
const UNREAD = `NOT EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.notification_id = n.id AND nr.user_id = :uid)`;

notificationsRouter.get('/', requirePerm('notifications:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ unread: z.enum(['true']).optional(), severity: z.string().optional() }), req.query);
  const r: Record<string, unknown> = { uid: req.user!.id, role: req.user!.role, lim: p.pageSize, off: p.offset };
  const where = [VISIBLE, `n.created_at > now() - interval '120 days'`];
  if (f.unread) where.push(UNREAD);
  if (f.severity) { where.push('n.severity IN (:sev)'); r.sev = f.severity.split(','); }
  const w = where.join(' AND ');
  const [rows, [{ total }]] = await Promise.all([
    q(`SELECT n.id, n.type, n.severity, n.title, n.body, n.entity_type, n.entity_id, n.created_at, ${UNREAD.replace('NOT EXISTS', 'NOT EXISTS')} AS unread FROM notifications n WHERE ${w} ORDER BY n.id DESC LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total FROM notifications n WHERE ${w}`, r),
  ]);
  res.json(listResponse(rows, total, p.page, p.pageSize));
}));

notificationsRouter.get('/unread-count', requirePerm('notifications:view'), wrap(async (req, res) => {
  const row = await q1<any>(`SELECT count(*)::int AS n FROM notifications n WHERE ${VISIBLE} AND ${UNREAD} AND n.created_at > now() - interval '120 days'`, { uid: req.user!.id, role: req.user!.role });
  res.json({ count: row.n });
}));

notificationsRouter.post('/read-all', requirePerm('notifications:view'), wrap(async (req, res) => {
  await exec(`INSERT INTO notification_reads (user_id, notification_id) SELECT :uid, n.id FROM notifications n WHERE ${VISIBLE} AND ${UNREAD} ON CONFLICT DO NOTHING`, { uid: req.user!.id, role: req.user!.role });
  res.json({ ok: true });
}));

notificationsRouter.post('/:id/read', requirePerm('notifications:view'), wrap(async (req, res) => {
  await exec(`INSERT INTO notification_reads (user_id, notification_id) SELECT :uid, n.id FROM notifications n WHERE n.id = :id AND ${VISIBLE} ON CONFLICT DO NOTHING`, { uid: req.user!.id, role: req.user!.role, id: id(req) });
  res.json({ ok: true });
}));

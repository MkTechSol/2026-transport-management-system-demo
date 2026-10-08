import { Router } from 'express';
import { z } from 'zod';
import { q, exec } from '../db/sequelize';
import { parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';
import { computeExceptions } from '../services/exceptions';

export const exceptionsRouter = Router();

exceptionsRouter.get('/', requirePerm('exceptions:view'), wrap(async (req, res) => {
  const includeAcked = req.query.acked === '1';
  const all = await computeExceptions(req.user!.role, includeAcked);
  const counts = { CRITICAL: 0, WARNING: 0, INFO: 0 } as Record<string, number>; const byCategory: Record<string, number> = {};
  for (const e of all.filter((x) => !x.acked)) { counts[e.severity]++; byCategory[e.category] = (byCategory[e.category] ?? 0) + 1; }
  res.json({ data: all, counts, byCategory, total: all.filter((x) => !x.acked).length });
}));
exceptionsRouter.get('/count', requirePerm('exceptions:view'), wrap(async (req, res) => {
  const all = await computeExceptions(req.user!.role);
  res.json({ critical: all.filter((x) => x.severity === 'CRITICAL').length, total: all.length });
}));
exceptionsRouter.post('/ack', requirePerm('exceptions:view'), wrap(async (req, res) => {
  const b = parse(z.object({ key: z.string().min(3).max(120), note: z.string().trim().max(250).optional() }), req.body);
  await exec(`INSERT INTO exception_acks (key, note, acked_by) VALUES (:k, :n, :u) ON CONFLICT (key) DO UPDATE SET note = :n, acked_by = :u, acked_at = now()`, { k: b.key, n: b.note ?? null, u: req.user!.id });
  await audit(req, { action: 'EXCEPTION_ACKNOWLEDGED', entityType: 'EXCEPTION', entityLabel: `${b.key}${b.note ? `: ${b.note}` : ''}` });
  res.json({ ok: true });
}));
exceptionsRouter.delete('/ack', requirePerm('exceptions:view'), wrap(async (req, res) => {
  const b = parse(z.object({ key: z.string().min(3).max(120) }), req.query);
  await exec('DELETE FROM exception_acks WHERE key = :k', { k: b.key });
  res.json({ ok: true });
}));
void q;

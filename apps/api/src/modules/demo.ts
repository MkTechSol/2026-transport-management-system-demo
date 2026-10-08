import { Router } from 'express';
import { config } from '../config';
import { forbidden } from '../lib/errors';
import { wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';

export const demoRouter = Router();

demoRouter.get('/status', wrap(async (_req, res) => {
  res.json({ demo: config.APP_ENV === 'demo' || config.APP_ENV === 'local', env: config.APP_ENV, simulator: config.simEnabled });
}));

/** Restores the seeded demo data. Only available when APP_ENV is demo/local/test, never in production. */
demoRouter.post('/reset', requirePerm('demo:reset'), wrap(async (req, res) => {
  if (!['demo', 'local', 'test'].includes(config.APP_ENV)) throw forbidden('Demo reset is disabled in this environment.');
  const { seedDemo } = await import('../seed/seedDemo');
  await audit(req, { action: 'DEMO_RESET', entityType: 'SYSTEM' });
  const summary = await seedDemo({ log: false });
  res.json({ ok: true, summary });
}));

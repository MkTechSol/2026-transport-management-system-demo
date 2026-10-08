import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db/sequelize';
import { badRequest } from '../lib/errors';
import { parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';
import { bustSettings, SETTING_DEFAULTS, allSettings } from '../services/settings';
import { exec } from '../db/sequelize';

export const settingsRouter = Router();

settingsRouter.get('/', requirePerm('settings:view'), wrap(async (_req, res) => {
  const cur = await allSettings();
  res.json({ data: Object.entries(SETTING_DEFAULTS).map(([key, d]) => ({ key, label: d.label, description: d.description, group: d.group, value: cur[key], default: d.value, type: typeof d.value })) });
}));

settingsRouter.patch('/', requirePerm('settings:manage'), wrap(async (req, res) => {
  const b = parse(z.record(z.union([z.number(), z.boolean(), z.string()])), req.body);
  for (const [k, v] of Object.entries(b)) {
    const d = SETTING_DEFAULTS[k];
    if (!d) throw badRequest(`Unknown setting "${k}".`);
    if (typeof v !== typeof d.value) throw badRequest(`"${d.label}" expects a ${typeof d.value}.`, { fields: { [k]: `Expected ${typeof d.value}` } });
    if (typeof v === 'number' && (v < 0 || v > 10_000_000)) throw badRequest(`"${d.label}" is out of range.`, { fields: { [k]: 'Out of range' } });
    await exec(`INSERT INTO settings (key, value, label, description, group_name, updated_by, updated_at) VALUES (:k, :v, :l, :d, :g, :u, now())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, { k, v: JSON.stringify(v), l: d.label, d: d.description, g: d.group, u: req.user!.id });
  }
  bustSettings();
  await audit(req, { action: 'SETTINGS_UPDATED', entityType: 'SETTINGS', entityLabel: Object.keys(b).join(', '), meta: b });
  res.json({ ok: true });
}));

/** Security overview for Settings → Security (sessions, failed sign-ins, locked accounts). */
settingsRouter.get('/security', requirePerm('settings:view'), wrap(async (_req, res) => {
  const [stats] = await q(`SELECT (SELECT count(*)::int FROM users WHERE status = 'ACTIVE') AS active_users,
       (SELECT count(*)::int FROM users WHERE status = 'DISABLED') AS disabled_users,
       (SELECT count(*)::int FROM users WHERE locked_until > now()) AS locked_users,
       (SELECT count(*)::int FROM refresh_tokens WHERE revoked_at IS NULL AND expires_at > now()) AS active_sessions,
       (SELECT count(*)::int FROM audit_logs WHERE action = 'LOGIN_FAILED' AND created_at > now() - interval '24 hours') AS failed_logins_24h,
       (SELECT count(*)::int FROM audit_logs WHERE action = 'LOGIN' AND created_at > now() - interval '24 hours') AS logins_24h`);
  const recent = await q(`SELECT user_email, action, ip, created_at FROM audit_logs WHERE action IN ('LOGIN','LOGIN_FAILED','PASSWORD_CHANGED','USER_DISABLED','PASSWORD_RESET') ORDER BY id DESC LIMIT 12`);
  const byRole = await q(`SELECT role, count(*)::int AS n FROM users GROUP BY role ORDER BY n DESC`);
  res.json({ stats, recent, byRole, policy: { passwordMinLength: 10, lockoutAfter: 5, lockoutMinutes: 10, accessTokenMinutes: 15, refreshTokenDays: 14 } });
}));

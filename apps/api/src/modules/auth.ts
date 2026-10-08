import crypto from 'node:crypto';
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ROLE_PERMISSIONS } from '@gasman/shared';
import { config } from '../config';
import { exec, q1 } from '../db/sequelize';
import { AppError, unauthorized } from '../lib/errors';
import { parse, wrap } from '../lib/http';
import { authenticate, signAccessToken, AuthUser } from '../middleware/auth';
import { audit } from '../services/audit';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.RATE_LIMIT_LOGIN_PER_15MIN,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Please wait a few minutes.' } },
});

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const COOKIE = 'gm_refresh';

function userPayload(u: any) {
  return {
    id: u.id,
    email: u.email,
    name: u.full_name,
    role: u.role,
    driverId: u.driver_id ?? null,
    permissions: ROLE_PERMISSIONS[u.role as keyof typeof ROLE_PERMISSIONS] ?? [],
  };
}

async function issueTokens(res: Response, u: any, familyId: string, ua?: string) {
  const authUser: AuthUser = { id: u.id, email: u.email, name: u.full_name, role: u.role, driverId: u.driver_id ?? null };
  const accessToken = signAccessToken(authUser);
  const refreshToken = crypto.randomBytes(40).toString('base64url');
  await exec(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent)
     VALUES (:uid, :h, :fam, now() + (:days || ' days')::interval, :ua)`,
    { uid: u.id, h: sha(refreshToken), fam: familyId, days: String(config.REFRESH_TOKEN_TTL_DAYS), ua: (ua ?? '').slice(0, 240) },
  );
  res.cookie(COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    path: '/api/v1/auth',
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
  return { accessToken, refreshToken, expiresIn: config.ACCESS_TOKEN_TTL_MIN * 60 };
}

authRouter.post(
  '/login',
  loginLimiter,
  wrap(async (req, res) => {
    const body = parse(z.object({ email: z.string().email().max(190), password: z.string().min(1).max(200) }), req.body);
    const u = await q1<any>('SELECT * FROM users WHERE lower(email) = lower(:e)', { e: body.email });
    const hash = u?.password_hash ?? DUMMY_HASH;
    const locked = u?.locked_until && new Date(u.locked_until) > new Date();
    const ok = await bcrypt.compare(body.password, hash);
    if (!u || u.status !== 'ACTIVE' || locked || !ok) {
      if (u && !ok) {
        await exec(
          `UPDATE users SET failed_logins = failed_logins + 1,
             locked_until = CASE WHEN failed_logins + 1 >= 5 THEN now() + interval '10 minutes' ELSE locked_until END
           WHERE id = :id`,
          { id: u.id },
        );
      }
      await audit(req, { action: 'LOGIN_FAILED', entityType: 'USER', entityLabel: body.email });
      throw new AppError(
        401,
        locked ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
        locked ? 'Too many failed attempts. This account is locked for a few minutes.' : 'Incorrect email or password.',
      );
    }
    await exec('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = :id', { id: u.id });
    const tokens = await issueTokens(res, u, crypto.randomUUID(), req.headers['user-agent']);
    await audit(req, { userId: u.id, email: u.email, action: 'LOGIN', entityType: 'USER', entityId: u.id, entityLabel: u.full_name });
    res.json({ ...tokens, user: userPayload(u) });
  }),
);

authRouter.post(
  '/refresh',
  wrap(async (req: Request, res: Response) => {
    // Web uses the httpOnly cookie; mobile apps send the token in the body.
    const token: string | undefined = req.cookies?.[COOKIE] ?? req.body?.refreshToken;
    if (!token || typeof token !== 'string') throw unauthorized();
    const row = await q1<any>('SELECT * FROM refresh_tokens WHERE token_hash = :h', { h: sha(token) });
    if (!row) throw unauthorized();
    if (row.revoked_at) {
      // Token reuse => assume theft, revoke the whole family.
      await exec('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = :f AND revoked_at IS NULL', { f: row.family_id });
      throw unauthorized('Session is no longer valid. Please sign in again.');
    }
    if (new Date(row.expires_at) < new Date()) throw unauthorized('Your session has expired. Please sign in again.');
    const u = await q1<any>('SELECT * FROM users WHERE id = :id', { id: row.user_id });
    if (!u || u.status !== 'ACTIVE') throw unauthorized();
    await exec('UPDATE refresh_tokens SET revoked_at = now() WHERE id = :id', { id: row.id });
    const tokens = await issueTokens(res, u, row.family_id, req.headers['user-agent']);
    res.json({ ...tokens, user: userPayload(u) });
  }),
);

authRouter.post(
  '/logout',
  wrap(async (req, res) => {
    const token: string | undefined = req.cookies?.[COOKIE] ?? req.body?.refreshToken;
    if (token) await exec('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = :h AND revoked_at IS NULL', { h: sha(token) });
    res.clearCookie(COOKIE, { path: '/api/v1/auth' });
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  wrap(async (req, res) => {
    const u = await q1<any>('SELECT * FROM users WHERE id = :id', { id: req.user!.id });
    if (!u || u.status !== 'ACTIVE') throw unauthorized();
    res.json({ user: userPayload(u) });
  }),
);

authRouter.post(
  '/change-password',
  authenticate,
  wrap(async (req, res) => {
    const b = parse(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10, 'Use at least 10 characters.').max(100) }), req.body);
    const u = await q1<any>('SELECT * FROM users WHERE id = :id', { id: req.user!.id });
    if (!u || !(await bcrypt.compare(b.currentPassword, u.password_hash))) throw new AppError(400, 'BAD_REQUEST', 'Current password is incorrect.');
    await exec('UPDATE users SET password_hash = :h, updated_at = now() WHERE id = :id', { h: await bcrypt.hash(b.newPassword, 10), id: u.id });
    await exec('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = :id AND revoked_at IS NULL', { id: u.id });
    await audit(req, { action: 'PASSWORD_CHANGED', entityType: 'USER', entityId: u.id, entityLabel: u.full_name });
    res.json({ ok: true });
  }),
);

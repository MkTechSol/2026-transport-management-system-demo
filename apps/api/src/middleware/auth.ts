import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { can, Permission, Role } from '@gasman/shared';
import { config } from '../config';
import { forbidden, unauthorized } from '../lib/errors';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  driverId: number | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signAccessToken(u: AuthUser): string {
  return jwt.sign({ email: u.email, name: u.name, role: u.role, driverId: u.driverId }, config.JWT_ACCESS_SECRET, {
    subject: String(u.id),
    expiresIn: `${config.ACCESS_TOKEN_TTL_MIN}m`,
    algorithm: 'HS256',
  });
}

/** Stateless verification: no DB hit per request (important at 1000s of concurrent mobile/web clients). */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next(unauthorized());
  try {
    const p = jwt.verify(h.slice(7), config.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    req.user = { id: Number(p.sub), email: p.email, name: p.name, role: p.role, driverId: p.driverId ?? null };
    next();
  } catch {
    next(unauthorized('Your session has expired. Please sign in again.'));
  }
}

export const requirePerm =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (perms.some((p) => can(req.user!.role, p))) return next();
    next(forbidden(`Your role (${req.user.role.replace(/_/g, ' ').toLowerCase()}) is not allowed to do this.`));
  };

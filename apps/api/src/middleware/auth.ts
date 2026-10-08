import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Permission, Role } from '@gasman/shared';
import { resolveRole } from '../services/roles';
import { config } from '../config';
import { forbidden, unauthorized } from '../lib/errors';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  /** Behaviour role: the built-in role (or a custom role's `based_on`) that drives workflow rules and own-data scoping. */
  role: Role;
  /** The role actually assigned to the user (built-in code or custom role code). */
  roleCode: string;
  /** Effective permissions of the assigned role. */
  perms: ReadonlySet<string>;
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
  return jwt.sign({ email: u.email, name: u.name, role: u.roleCode, driverId: u.driverId }, config.JWT_ACCESS_SECRET, {
    subject: String(u.id),
    expiresIn: `${config.ACCESS_TOKEN_TTL_MIN}m`,
    algorithm: 'HS256',
  });
}

/** Stateless verification: no DB hit per request (important at 1000s of concurrent mobile/web clients). */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next(unauthorized());
  let p: jwt.JwtPayload;
  try {
    p = jwt.verify(h.slice(7), config.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
  } catch {
    return next(unauthorized('Your session has expired. Please sign in again.'));
  }
  try {
    // Built-in roles resolve from code; custom roles from a short-lived cache, so permission edits apply within seconds.
    const role = await resolveRole(p.role);
    if (!role) return next(unauthorized('Your role no longer exists. Please contact an administrator.'));
    req.user = { id: Number(p.sub), email: p.email, name: p.name, role: role.baseRole, roleCode: role.code, perms: role.perms, driverId: p.driverId ?? null };
    next();
  } catch (e) { next(e); }
}

export const requirePerm =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (perms.some((p) => req.user!.perms.has(p))) return next();
    next(forbidden(`Your role (${req.user.roleCode.replace(/_/g, ' ').toLowerCase()}) is not allowed to do this.`));
  };

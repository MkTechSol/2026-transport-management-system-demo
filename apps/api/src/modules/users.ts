import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { MODULE_MATRIX } from '@gasman/shared';
import { allRoleCodes, listRoles, resolveRole } from '../services/roles';
import { q, q1, exec } from '../db/sequelize';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { id, likeTerm, listResponse, orderBy, paging, parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';

export const usersRouter = Router();

usersRouter.get('/roles', requirePerm('users:view'), wrap(async (_req, res) => {
  res.json({ roles: await listRoles(), modules: MODULE_MATRIX });
}));

/** Nobody can hand out more access than they hold: only a super admin assigns super-admin or roles with permissions the assigner lacks. */
async function assertCanAssign(actor: { roleCode: string; perms: ReadonlySet<string> }, roleCode: string) {
  const role = await resolveRole(roleCode);
  if (!role || !(await allRoleCodes()).includes(roleCode)) throw badRequest('Choose a valid role.', { fields: { role: 'Unknown role' } });
  if (actor.roleCode === 'SUPER_ADMIN') return role;
  if (roleCode === 'SUPER_ADMIN' || [...role.perms].some((p) => !actor.perms.has(p))) throw forbidden('You cannot assign a role with more access than your own.');
  return role;
}

usersRouter.get('/', requirePerm('users:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ role: z.string().optional(), status: z.string().optional() }), req.query);
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (f.role) { where.push('u.role = :role'); r.role = f.role; }
  if (f.status) { where.push('u.status = :status'); r.status = f.status; }
  if (p.q) { where.push('(u.full_name ILIKE :q OR u.email ILIKE :q)'); r.q = likeTerm(p.q); }
  const w = where.join(' AND ');
  const [rows, [{ total }]] = await Promise.all([
    q(`SELECT u.id, u.email, u.full_name, u.role, u.phone, u.status, u.driver_id, u.last_login_at, u.created_at, d.full_name AS driver_name
         FROM users u LEFT JOIN drivers d ON d.id = u.driver_id WHERE ${w} ORDER BY ${orderBy(p.sort, p.dir, { name: 'u.full_name', role: 'u.role', lastLogin: 'u.last_login_at' }, 'u.full_name')} LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total FROM users u WHERE ${w}`, r),
  ]);
  res.json(listResponse(rows, total, p.page, p.pageSize));
}));

const body = z.object({
  email: z.string().trim().email().max(190),
  fullName: z.string().trim().min(2).max(120),
  role: z.string().trim().min(2).max(30),
  phone: z.string().trim().max(30).optional().nullable(),
  driverId: z.coerce.number().int().positive().optional().nullable(),
  password: z.string().min(10, 'Use at least 10 characters.').max(100),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});

usersRouter.post('/', requirePerm('users:manage'), wrap(async (req, res) => {
  const b = parse(body, req.body);
  const assigned = await assertCanAssign(req.user!, b.role);
  if (assigned.baseRole === 'DRIVER' && !b.driverId) throw badRequest('Link driver accounts to a driver profile.', { fields: { driverId: 'Required for driver role' } });
  if (await q1('SELECT 1 AS x FROM users WHERE lower(email) = lower(:e)', { e: b.email })) throw conflict('A user with this email already exists.');
  const row = await q1<any>(`INSERT INTO users (email, password_hash, full_name, role, phone, driver_id, status) VALUES (:e, :h, :n, :r, :p, :d, :s) RETURNING id, email, full_name, role, status`,
    { e: b.email.toLowerCase(), h: await bcrypt.hash(b.password, 10), n: b.fullName, r: b.role, p: b.phone ?? null, d: assigned.baseRole === 'DRIVER' ? b.driverId : null, s: b.status ?? 'ACTIVE' });
  await audit(req, { action: 'CREATE', entityType: 'USER', entityId: row.id, entityLabel: row.email, meta: { role: b.role } });
  res.status(201).json({ user: row });
}));

usersRouter.patch('/:id', requirePerm('users:manage'), wrap(async (req, res) => {
  const uid = id(req);
  const b = parse(body.partial().omit({ email: true }), req.body);
  const cur = await q1<any>('SELECT * FROM users WHERE id = :id', { id: uid });
  if (!cur) throw notFound('User');
  if (cur.role === 'SUPER_ADMIN' && req.user!.roleCode !== 'SUPER_ADMIN') throw forbidden('Only a super admin can change a super admin account.');
  if (b.role) await assertCanAssign(req.user!, b.role);
  if (uid === req.user!.id && (b.status === 'DISABLED' || (b.role && b.role !== cur.role))) throw conflict('You cannot disable or change the role of your own account.');
  const sets: string[] = []; const r: Record<string, unknown> = { id: uid };
  if (b.fullName) { sets.push('full_name = :n'); r.n = b.fullName; }
  if (b.role) { sets.push('role = :r'); r.r = b.role; }
  if (b.phone !== undefined) { sets.push('phone = :p'); r.p = b.phone; }
  if (b.driverId !== undefined) { sets.push('driver_id = :d'); r.d = b.driverId; }
  if (b.status) { sets.push('status = :s'); r.s = b.status; }
  if (b.password) { sets.push('password_hash = :h', 'failed_logins = 0', 'locked_until = NULL'); r.h = await bcrypt.hash(b.password, 10); }
  if (sets.length) await exec(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = :id`, r);
  if (b.status === 'DISABLED' || b.password) await exec('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = :id AND revoked_at IS NULL', { id: uid });
  await audit(req, { action: b.status === 'DISABLED' ? 'USER_DISABLED' : b.password ? 'PASSWORD_RESET' : 'UPDATE', entityType: 'USER', entityId: uid, entityLabel: cur.email });
  res.json({ user: await q1('SELECT id, email, full_name, role, status, driver_id FROM users WHERE id = :id', { id: uid }) });
}));

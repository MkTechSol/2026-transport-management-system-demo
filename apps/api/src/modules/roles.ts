import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS, ROLES, ROLE_LABELS } from '@gasman/shared';
import { q, q1, exec } from '../db/sequelize';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { wrap, parse } from '../lib/http';
import { audit } from '../services/audit';
import { invalidateRoles, isBuiltIn, listRoles, NON_GRANTABLE, permissionGroups } from '../services/roles';

/** Custom role management. Super admin only — roles decide who can see and do what, so this is not delegable via permissions. */
export const rolesRouter = Router();
rolesRouter.use((req, _res, next) => (req.user?.roleCode === 'SUPER_ADMIN' ? next() : next(forbidden('Only the super admin can manage roles.'))));

const body = z.object({
  name: z.string().trim().min(3, 'Give the role a name (at least 3 characters).').max(60),
  description: z.string().trim().max(250).optional().nullable(),
  basedOn: z.enum(ROLES).refine((r) => r !== 'SUPER_ADMIN', 'Choose a working style other than Super admin.'),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
});
const clean = (perms: readonly string[]) => [...new Set(perms)].filter((p) => !(NON_GRANTABLE as string[]).includes(p));

rolesRouter.get('/', wrap(async (_req, res) => {
  res.json({ roles: await listRoles(), groups: permissionGroups(), baseOptions: ROLES.filter((r) => r !== 'SUPER_ADMIN').map((r) => ({ value: r, label: ROLE_LABELS[r] })) });
}));

rolesRouter.post('/', wrap(async (req, res) => {
  const b = parse(body, req.body);
  if (!clean(b.permissions).length) throw unprocessable('Select at least one permission.', { fields: { permissions: 'Select at least one permission' } });
  if (Object.values(ROLE_LABELS).some((l) => l.toLowerCase() === b.name.toLowerCase()) || (await q1('SELECT 1 AS x FROM custom_roles WHERE lower(name) = lower(:n)', { n: b.name })))
    throw conflict('A role with this name already exists.', { fields: { name: 'Already in use' } });
  const slug = b.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 22) || 'ROLE';
  let code = `CR_${slug}`; let i = 1;
  while (isBuiltIn(code) || (await q1('SELECT 1 AS x FROM custom_roles WHERE code = :c', { c: code }))) code = `CR_${slug.slice(0, 20)}_${++i}`;
  await exec('INSERT INTO custom_roles (code, name, description, based_on, permissions, created_by) VALUES (:c, :n, :d, :b, ARRAY[:p]::text[], :u)',
    { c: code, n: b.name, d: b.description || null, b: b.basedOn, p: clean(b.permissions), u: req.user!.id });
  invalidateRoles();
  await audit(req, { action: 'ROLE_CREATED', entityType: 'ROLE', entityLabel: b.name, meta: { code, permissions: clean(b.permissions).length } });
  res.status(201).json({ role: (await listRoles()).find((r) => r.role === code) });
}));

rolesRouter.patch('/:code', wrap(async (req, res) => {
  const code = String(req.params.code);
  if (isBuiltIn(code)) throw unprocessable('Built-in roles are fixed. Create a new role (you can start from the same permissions) instead.');
  const cur = await q1<any>('SELECT * FROM custom_roles WHERE code = :c', { c: code });
  if (!cur) throw notFound('Role');
  const b = parse(body, req.body);
  if (!clean(b.permissions).length) throw unprocessable('Select at least one permission.', { fields: { permissions: 'Select at least one permission' } });
  if (Object.values(ROLE_LABELS).some((l) => l.toLowerCase() === b.name.toLowerCase()) || (await q1('SELECT 1 AS x FROM custom_roles WHERE lower(name) = lower(:n) AND code <> :c', { n: b.name, c: code })))
    throw conflict('A role with this name already exists.', { fields: { name: 'Already in use' } });
  await exec('UPDATE custom_roles SET name = :n, description = :d, based_on = :b, permissions = ARRAY[:p]::text[], updated_at = now() WHERE code = :c', { c: code, n: b.name, d: b.description || null, b: b.basedOn, p: clean(b.permissions) });
  invalidateRoles();
  await audit(req, { action: 'ROLE_UPDATED', entityType: 'ROLE', entityLabel: b.name, meta: { code, permissions: clean(b.permissions).length } });
  res.json({ role: (await listRoles()).find((r) => r.role === code) });
}));

rolesRouter.delete('/:code', wrap(async (req, res) => {
  const code = String(req.params.code);
  if (isBuiltIn(code)) throw unprocessable('Built-in roles cannot be deleted.');
  const cur = await q1<any>('SELECT name FROM custom_roles WHERE code = :c', { c: code });
  if (!cur) throw notFound('Role');
  const n = await q1<any>('SELECT count(*)::int AS n FROM users WHERE role = :c', { c: code });
  if (n.n) throw conflict(`${n.n} user(s) still have this role. Move them to another role first.`);
  await exec('DELETE FROM custom_roles WHERE code = :c', { c: code });
  invalidateRoles();
  await audit(req, { action: 'ROLE_DELETED', entityType: 'ROLE', entityLabel: cur.name, meta: { code } });
  res.json({ ok: true });
}));
void q;

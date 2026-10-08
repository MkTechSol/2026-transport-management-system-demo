import { PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS, ROLES, Permission, Role } from '@gasman/shared';
import { q, q1 } from '../db/sequelize';
import { TtlCache } from '../lib/cache';

export interface ResolvedRole { code: string; label: string; baseRole: Role; perms: ReadonlySet<Permission>; custom: boolean }

/** Permissions that can never be handed to a custom role. */
export const NON_GRANTABLE: Permission[] = ['demo:reset'];
export const isBuiltIn = (code: string): code is Role => (ROLES as readonly string[]).includes(code);

const cache = new TtlCache<ResolvedRole | null>(3000);

/** Effective role for a role code: built-in (from code) or custom (from the database). Cached for a few seconds so edits apply quickly. */
export async function resolveRole(code: string): Promise<ResolvedRole | null> {
  if (isBuiltIn(code)) return { code, label: ROLE_LABELS[code], baseRole: code, perms: new Set(ROLE_PERMISSIONS[code]), custom: false };
  return cache.get(code, async () => {
    const r = await q1<any>('SELECT code, name, based_on, permissions FROM custom_roles WHERE code = :c', { c: code });
    if (!r) return null;
    const valid = new Set<string>(PERMISSIONS);
    return { code: r.code, label: r.name, baseRole: (isBuiltIn(r.based_on) ? r.based_on : 'DISPATCHER') as Role, perms: new Set((r.permissions as string[]).filter((p) => valid.has(p)) as Permission[]), custom: true };
  });
}
export const invalidateRoles = () => cache.clear();

export async function allRoleCodes(): Promise<string[]> {
  return [...ROLES, ...(await q<any>('SELECT code FROM custom_roles ORDER BY name')).map((r: any) => r.code)];
}

export const userCan = (u: { perms: ReadonlySet<string> }, perm: string) => u.perms.has(perm);

import { MODULE_MATRIX } from '@gasman/shared';

/** Permission catalogue for the role editor: the module matrix plus anything not listed there. */
export function permissionGroups() {
  const listed = new Set<string>(MODULE_MATRIX.flatMap((m) => m.perms));
  const rest = PERMISSIONS.filter((p) => !listed.has(p) && !NON_GRANTABLE.includes(p));
  return [...MODULE_MATRIX.map((m) => ({ module: m.module, perms: m.perms as string[] })), ...(rest.length ? [{ module: 'Other', perms: rest as string[] }] : [])];
}

export async function listRoles() {
  const counts = await q<any>('SELECT role, count(*)::int AS n FROM users GROUP BY role');
  const n = (c: string) => counts.find((x: any) => x.role === c)?.n ?? 0;
  const custom = await q<any>('SELECT code, name, description, based_on, permissions FROM custom_roles ORDER BY name');
  return [
    ...ROLES.map((r) => ({ role: r, label: ROLE_LABELS[r], custom: false, basedOn: r, description: null as string | null, users: n(r), permissions: [...ROLE_PERMISSIONS[r]] as string[] })),
    ...custom.map((c: any) => ({ role: c.code, label: c.name, custom: true, basedOn: c.based_on, description: c.description as string | null, users: n(c.code), permissions: c.permissions as string[] })),
  ];
}

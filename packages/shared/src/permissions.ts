import type { Role } from './enums';

export const PERMISSIONS = [
  'dashboard:view',
  'vehicles:view', 'vehicles:create', 'vehicles:update', 'vehicles:archive',
  'drivers:view', 'drivers:create', 'drivers:update', 'drivers:archive',
  'locations:view', 'locations:manage',
  'distributors:view', 'distributors:manage',
  'trips:view', 'trips:create', 'trips:update', 'trips:assign', 'trips:dispatch', 'trips:progress', 'trips:cancel',
  'tracking:view',
  'maintenance:view', 'maintenance:manage',
  'documents:view', 'documents:manage',
  'safety:view', 'safety:report', 'safety:manage',
  'reports:view', 'reports:export',
  'notifications:view',
  'audit:view',
  'users:view', 'users:manage',
  'demo:reset',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEW_ALL: Permission[] = [
  'dashboard:view', 'vehicles:view', 'drivers:view', 'locations:view', 'distributors:view',
  'trips:view', 'tracking:view', 'maintenance:view', 'documents:view', 'safety:view',
  'reports:view', 'notifications:view',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  TRANSPORT_MANAGER: PERMISSIONS.filter((p) => p !== 'users:manage' && p !== 'demo:reset'),
  DISPATCHER: [
    ...VIEW_ALL,
    'trips:create', 'trips:update', 'trips:assign', 'trips:dispatch', 'trips:progress', 'trips:cancel',
    'safety:report',
  ],
  FLEET_MANAGER: [
    ...VIEW_ALL,
    'vehicles:create', 'vehicles:update', 'vehicles:archive',
    'drivers:create', 'drivers:update', 'drivers:archive',
    'maintenance:manage', 'documents:manage', 'safety:report', 'safety:manage', 'reports:export',
  ],
  DRIVER: [
    'trips:view', 'trips:progress', 'vehicles:view', 'drivers:view', 'documents:view',
    'safety:report', 'notifications:view',
  ],
  MANAGEMENT_VIEWER: [...VIEW_ALL, 'reports:export'],
};

export function can(role: Role | undefined, perm: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(perm);
}

/** Module-level matrix used by the Users & Roles screen and docs. */
export const MODULE_MATRIX: { module: string; perms: Permission[] }[] = [
  { module: 'Dashboard', perms: ['dashboard:view'] },
  { module: 'Vehicles', perms: ['vehicles:view', 'vehicles:create', 'vehicles:update', 'vehicles:archive'] },
  { module: 'Drivers', perms: ['drivers:view', 'drivers:create', 'drivers:update', 'drivers:archive'] },
  { module: 'Plants & Locations', perms: ['locations:view', 'locations:manage'] },
  { module: 'Distributors', perms: ['distributors:view', 'distributors:manage'] },
  { module: 'Trips', perms: ['trips:view', 'trips:create', 'trips:update', 'trips:cancel'] },
  { module: 'Dispatch', perms: ['trips:assign', 'trips:dispatch'] },
  { module: 'Trip Progress', perms: ['trips:progress'] },
  { module: 'Tracking', perms: ['tracking:view'] },
  { module: 'Maintenance', perms: ['maintenance:view', 'maintenance:manage'] },
  { module: 'Documents', perms: ['documents:view', 'documents:manage'] },
  { module: 'Safety', perms: ['safety:view', 'safety:report', 'safety:manage'] },
  { module: 'Reports', perms: ['reports:view', 'reports:export'] },
  { module: 'Audit Log', perms: ['audit:view'] },
  { module: 'Users & Roles', perms: ['users:view', 'users:manage'] },
];

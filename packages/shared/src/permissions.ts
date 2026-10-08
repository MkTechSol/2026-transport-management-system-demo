import type { Role } from './enums';

export const PERMISSIONS = [
  'dashboard:view',
  'vehicles:view', 'vehicles:create', 'vehicles:update', 'vehicles:archive',
  'drivers:view', 'drivers:create', 'drivers:update', 'drivers:archive',
  'locations:view', 'locations:manage',
  'routes:view', 'routes:manage',
  'distributors:view', 'distributors:manage',
  'trips:view', 'trips:create', 'trips:update', 'trips:assign', 'trips:dispatch', 'trips:progress', 'trips:cancel',
  'tracking:view',
  'maintenance:view', 'maintenance:manage',
  'documents:view', 'documents:manage',
  'safety:view', 'safety:report', 'safety:manage',
  'fuel:view', 'fuel:record', 'fuel:manage',
  'expenses:view', 'expenses:record', 'expenses:approve',
  'approvals:view', 'approvals:decide', 'approvals:configure',
  'finance:view', 'finance:post',
  'sales:view', 'sales:manage',
  'vendors:view', 'vendors:manage',
  'procurement:view', 'procurement:manage',
  'inventory:view', 'inventory:manage',
  'tyres:view', 'tyres:manage',
  'hr:view', 'hr:manage', 'payroll:manage',
  'exceptions:view',
  'ai:use',
  'settings:view', 'settings:manage',
  'reports:view', 'reports:export',
  'notifications:view',
  'audit:view',
  'users:view', 'users:manage',
  'demo:reset',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const OPS_VIEW: Permission[] = [
  'dashboard:view', 'vehicles:view', 'drivers:view', 'locations:view', 'routes:view', 'distributors:view', 'trips:view', 'tracking:view',
  'maintenance:view', 'documents:view', 'safety:view', 'fuel:view', 'expenses:view', 'exceptions:view', 'reports:view', 'notifications:view',
];
const EVERYTHING_VIEW: Permission[] = [
  ...OPS_VIEW, 'approvals:view', 'finance:view', 'sales:view', 'vendors:view', 'procurement:view', 'inventory:view', 'tyres:view', 'hr:view', 'settings:view', 'ai:use',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  TRANSPORT_MANAGER: [
    ...EVERYTHING_VIEW,
    'vehicles:create', 'vehicles:update', 'vehicles:archive', 'drivers:create', 'drivers:update', 'drivers:archive',
    'locations:manage', 'routes:manage', 'distributors:manage',
    'trips:create', 'trips:update', 'trips:assign', 'trips:dispatch', 'trips:progress', 'trips:cancel',
    'maintenance:manage', 'documents:manage', 'safety:report', 'safety:manage', 'fuel:record', 'fuel:manage', 'expenses:record', 'expenses:approve',
    'approvals:decide', 'approvals:configure', 'sales:manage', 'reports:export', 'audit:view', 'users:view', 'settings:manage',
  ],
  DISPATCHER: [
    ...OPS_VIEW,
    'trips:create', 'trips:update', 'trips:assign', 'trips:dispatch', 'trips:progress', 'trips:cancel',
    'safety:report', 'fuel:record', 'expenses:record', 'ai:use',
  ],
  FLEET_MANAGER: [
    ...OPS_VIEW, 'inventory:view', 'tyres:view', 'ai:use',
    'vehicles:create', 'vehicles:update', 'vehicles:archive', 'drivers:create', 'drivers:update', 'drivers:archive',
    'maintenance:manage', 'documents:manage', 'safety:report', 'safety:manage', 'fuel:record', 'fuel:manage', 'expenses:record',
    'tyres:manage', 'reports:export',
  ],
  DRIVER: [
    'trips:view', 'trips:progress', 'vehicles:view', 'drivers:view', 'documents:view', 'safety:report', 'notifications:view',
    'fuel:record', 'fuel:view', 'expenses:record', 'expenses:view',
  ],
  MANAGEMENT_VIEWER: [...EVERYTHING_VIEW, 'reports:export'],
  ACCOUNTANT: [
    'dashboard:view', 'trips:view', 'vehicles:view', 'drivers:view', 'locations:view', 'routes:view', 'routes:manage', 'distributors:view', 'distributors:manage',
    'fuel:view', 'expenses:view', 'expenses:approve', 'approvals:view', 'approvals:decide', 'finance:view', 'finance:post',
    'sales:view', 'sales:manage', 'vendors:view', 'vendors:manage', 'procurement:view', 'inventory:view', 'hr:view', 'payroll:manage',
    'reports:view', 'reports:export', 'notifications:view', 'exceptions:view', 'ai:use', 'settings:view',
  ],
  STORE_MANAGER: [
    'dashboard:view', 'vehicles:view', 'maintenance:view', 'maintenance:manage', 'vendors:view', 'vendors:manage', 'procurement:view', 'procurement:manage',
    'inventory:view', 'inventory:manage', 'tyres:view', 'tyres:manage', 'approvals:view', 'expenses:view', 'reports:view', 'notifications:view', 'exceptions:view', 'ai:use',
  ],
  HR_MANAGER: [
    'dashboard:view', 'drivers:view', 'drivers:create', 'drivers:update', 'documents:view', 'documents:manage', 'hr:view', 'hr:manage', 'payroll:manage',
    'approvals:view', 'approvals:decide', 'reports:view', 'notifications:view', 'exceptions:view',
  ],
};

export function can(role: Role | undefined, perm: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(perm);
}

/** Module-level matrix used by the Users & Roles screen and docs. */
export const MODULE_MATRIX: { module: string; perms: Permission[] }[] = [
  { module: 'Control Tower', perms: ['dashboard:view'] },
  { module: 'Vehicles / Bowzers', perms: ['vehicles:view', 'vehicles:create', 'vehicles:update', 'vehicles:archive'] },
  { module: 'Drivers', perms: ['drivers:view', 'drivers:create', 'drivers:update', 'drivers:archive'] },
  { module: 'Plants & Locations', perms: ['locations:view', 'locations:manage'] },
  { module: 'Routes & Freight', perms: ['routes:view', 'routes:manage'] },
  { module: 'Customers', perms: ['distributors:view', 'distributors:manage'] },
  { module: 'Trips', perms: ['trips:view', 'trips:create', 'trips:update', 'trips:cancel'] },
  { module: 'Dispatch', perms: ['trips:assign', 'trips:dispatch'] },
  { module: 'Trip Progress', perms: ['trips:progress'] },
  { module: 'Live Tracking', perms: ['tracking:view'] },
  { module: 'Fuel', perms: ['fuel:view', 'fuel:record', 'fuel:manage'] },
  { module: 'Trip Expenses', perms: ['expenses:view', 'expenses:record', 'expenses:approve'] },
  { module: 'Approvals', perms: ['approvals:view', 'approvals:decide', 'approvals:configure'] },
  { module: 'Workshop / Maintenance', perms: ['maintenance:view', 'maintenance:manage'] },
  { module: 'Inventory', perms: ['inventory:view', 'inventory:manage'] },
  { module: 'Tyres', perms: ['tyres:view', 'tyres:manage'] },
  { module: 'Vendors', perms: ['vendors:view', 'vendors:manage'] },
  { module: 'Procurement', perms: ['procurement:view', 'procurement:manage'] },
  { module: 'Sales & Invoicing', perms: ['sales:view', 'sales:manage'] },
  { module: 'Finance & Accounts', perms: ['finance:view', 'finance:post'] },
  { module: 'HR & Payroll', perms: ['hr:view', 'hr:manage', 'payroll:manage'] },
  { module: 'Documents', perms: ['documents:view', 'documents:manage'] },
  { module: 'Safety', perms: ['safety:view', 'safety:report', 'safety:manage'] },
  { module: 'Exceptions', perms: ['exceptions:view'] },
  { module: 'AI Assistant', perms: ['ai:use'] },
  { module: 'Reports', perms: ['reports:view', 'reports:export'] },
  { module: 'Settings', perms: ['settings:view', 'settings:manage'] },
  { module: 'Audit Log', perms: ['audit:view'] },
  { module: 'Users & Roles', perms: ['users:view', 'users:manage'] },
];

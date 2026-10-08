export const ROLES = [
  'SUPER_ADMIN',
  'TRANSPORT_MANAGER',
  'DISPATCHER',
  'FLEET_MANAGER',
  'DRIVER',
  'MANAGEMENT_VIEWER',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  TRANSPORT_MANAGER: 'Transport Manager',
  DISPATCHER: 'Dispatcher',
  FLEET_MANAGER: 'Fleet Manager',
  DRIVER: 'Driver',
  MANAGEMENT_VIEWER: 'Management (Viewer)',
};

export const TRIP_STATUSES = [
  'DRAFT',
  'PLANNED',
  'ASSIGNED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELAYED',
  'ON_HOLD',
  'ARRIVED',
  'DELIVERED',
  'RETURNING',
  'COMPLETED',
  'CANCELLED',
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  DRAFT: 'Draft',
  PLANNED: 'Planned',
  ASSIGNED: 'Assigned',
  DISPATCHED: 'Dispatched',
  IN_TRANSIT: 'In Transit',
  DELAYED: 'Delayed',
  ON_HOLD: 'On Hold',
  ARRIVED: 'Arrived',
  DELIVERED: 'Delivered',
  RETURNING: 'Returning',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const VEHICLE_STATUSES = ['AVAILABLE', 'ON_TRIP', 'MAINTENANCE', 'INACTIVE'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const DRIVER_STATUSES = ['AVAILABLE', 'ON_TRIP', 'OFF_DUTY', 'ON_LEAVE', 'SUSPENDED'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const FLEET_TYPES = ['OWNED', 'HIRED'] as const;
export const VEHICLE_CATEGORIES = ['BOWZER', 'CYLINDER_TRUCK'] as const;
export const LOCATION_TYPES = ['PLANT', 'TERMINAL', 'DEPOT', 'DISTRIBUTOR', 'PARKING'] as const;
export const REGIONS = ['KPK', 'PUNJAB', 'AJK', 'GILGIT_BALTISTAN', 'ISLAMABAD', 'SINDH'] as const;
export const LPG_SOURCES = ['LOCAL', 'IMPORTED'] as const;
export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

export const DOC_TYPES = {
  VEHICLE: ['REGISTRATION', 'INSURANCE', 'FITNESS', 'ROUTE_PERMIT', 'TANK_PRESSURE_TEST'],
  DRIVER: ['LICENSE', 'MEDICAL', 'LPG_HANDLING_CERT'],
} as const;
export const DOC_TYPE_LABELS: Record<string, string> = {
  REGISTRATION: 'Registration',
  INSURANCE: 'Insurance',
  FITNESS: 'Fitness / Inspection',
  ROUTE_PERMIT: 'Route Permit',
  TANK_PRESSURE_TEST: 'Tank Pressure Test',
  LICENSE: 'Driving License',
  MEDICAL: 'Medical Fitness',
  LPG_HANDLING_CERT: 'LPG Handling Certificate',
};

/** Documents that must be valid before a vehicle / driver may be assigned to a trip. */
export const REQUIRED_VEHICLE_DOCS = ['REGISTRATION', 'INSURANCE', 'FITNESS', 'TANK_PRESSURE_TEST'] as const;
export const REQUIRED_DRIVER_DOCS = ['LICENSE', 'LPG_HANDLING_CERT'] as const;

export const MAINTENANCE_TYPES = ['PREVENTIVE', 'CORRECTIVE', 'INSPECTION'] as const;
export const MAINTENANCE_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export const INCIDENT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const INCIDENT_CATEGORIES = ['GAS_LEAK', 'ACCIDENT', 'BREAKDOWN', 'ROUTE_BLOCKED', 'DELAY', 'SECURITY', 'OTHER'] as const;
export const INCIDENT_STATUSES = ['OPEN', 'INVESTIGATING', 'CLOSED'] as const;

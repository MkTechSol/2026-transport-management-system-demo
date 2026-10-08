import type { Role, TripStatus } from './enums';

export interface Transition {
  from: TripStatus;
  to: TripStatus;
  /** Roles allowed to perform this transition (driver transitions additionally require trip ownership). */
  roles: Role[];
  label: string;
  /** Timestamp column stamped on the trip when this transition happens. */
  stamp?: string;
}

const OPS: Role[] = ['SUPER_ADMIN', 'TRANSPORT_MANAGER', 'DISPATCHER'];
const OPS_DRIVER: Role[] = [...OPS, 'DRIVER'];

export const TRANSITIONS: Transition[] = [
  { from: 'DRAFT', to: 'PLANNED', roles: OPS, label: 'Confirm plan' },
  { from: 'PLANNED', to: 'ASSIGNED', roles: OPS, label: 'Assign vehicle & driver' }, // via assign endpoint
  { from: 'ASSIGNED', to: 'PLANNED', roles: OPS, label: 'Unassign' },
  { from: 'ASSIGNED', to: 'DISPATCHED', roles: OPS, label: 'Dispatch', stamp: 'dispatched_at' },
  { from: 'DISPATCHED', to: 'IN_TRANSIT', roles: OPS_DRIVER, label: 'Start trip', stamp: 'departed_at' },
  { from: 'IN_TRANSIT', to: 'DELAYED', roles: OPS, label: 'Mark delayed' },
  { from: 'DELAYED', to: 'IN_TRANSIT', roles: OPS, label: 'Resume' },
  { from: 'IN_TRANSIT', to: 'ARRIVED', roles: OPS_DRIVER, label: 'Mark arrived', stamp: 'arrived_at' },
  { from: 'DELAYED', to: 'ARRIVED', roles: OPS_DRIVER, label: 'Mark arrived', stamp: 'arrived_at' },
  { from: 'ARRIVED', to: 'DELIVERED', roles: OPS_DRIVER, label: 'Confirm delivery', stamp: 'delivered_at' },
  { from: 'DELIVERED', to: 'RETURNING', roles: OPS_DRIVER, label: 'Start return', stamp: 'return_started_at' },
  { from: 'RETURNING', to: 'COMPLETED', roles: OPS_DRIVER, label: 'Complete trip', stamp: 'completed_at' },
  { from: 'DELIVERED', to: 'COMPLETED', roles: OPS, label: 'Complete trip', stamp: 'completed_at' },
  // Holds & cancellation
  { from: 'PLANNED', to: 'ON_HOLD', roles: OPS, label: 'Put on hold' },
  { from: 'ASSIGNED', to: 'ON_HOLD', roles: OPS, label: 'Put on hold' },
  { from: 'DISPATCHED', to: 'ON_HOLD', roles: OPS, label: 'Put on hold' },
  { from: 'IN_TRANSIT', to: 'ON_HOLD', roles: OPS, label: 'Put on hold' },
  { from: 'DRAFT', to: 'CANCELLED', roles: OPS, label: 'Cancel trip', stamp: 'cancelled_at' },
  { from: 'PLANNED', to: 'CANCELLED', roles: OPS, label: 'Cancel trip', stamp: 'cancelled_at' },
  { from: 'ASSIGNED', to: 'CANCELLED', roles: OPS, label: 'Cancel trip', stamp: 'cancelled_at' },
  { from: 'DISPATCHED', to: 'CANCELLED', roles: OPS, label: 'Cancel trip', stamp: 'cancelled_at' },
  { from: 'ON_HOLD', to: 'CANCELLED', roles: OPS, label: 'Cancel trip', stamp: 'cancelled_at' },
];
// ON_HOLD -> (previous status) is handled specially: "Resume" returns to status_before_hold.

/** Statuses in which a vehicle / driver is physically committed to the trip. */
export const EXECUTION_STATUSES: TripStatus[] = [
  'DISPATCHED', 'IN_TRANSIT', 'DELAYED', 'ON_HOLD', 'ARRIVED', 'DELIVERED', 'RETURNING',
];
/** Statuses in which a vehicle / driver is reserved for a scheduled slot. */
export const RESERVING_STATUSES: TripStatus[] = ['ASSIGNED', ...EXECUTION_STATUSES];
/** Moving statuses that the tracking simulator / mobile GPS updates. */
export const MOVING_STATUSES: TripStatus[] = ['IN_TRANSIT', 'DELAYED', 'RETURNING'];
export const OPEN_STATUSES: TripStatus[] = [
  'DRAFT', 'PLANNED', 'ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'DELAYED', 'ON_HOLD', 'ARRIVED', 'DELIVERED', 'RETURNING',
];

export function findTransition(from: TripStatus, to: TripStatus): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

/** True when `role` may move a trip INTO `to` from at least one state (used to answer 403 before 409). */
export function roleCanTarget(to: TripStatus, role: Role): boolean {
  return TRANSITIONS.some((t) => t.to === to && t.roles.includes(role));
}

export function allowedTransitions(from: TripStatus, role: Role): Transition[] {
  return TRANSITIONS.filter((t) => t.from === from && t.roles.includes(role));
}

/** The 9-step happy path shown as the trip stepper in the UI. */
export const TRIP_STEPPER: TripStatus[] = [
  'DRAFT', 'PLANNED', 'ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'RETURNING', 'COMPLETED',
];

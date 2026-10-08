import { describe, expect, it } from 'vitest';
import { allowedTransitions, can, documentStatus, findTransition, ROLES, ROLE_PERMISSIONS } from '@gasman/shared';
import { seedDemo } from '../src/seed/seedDemo';
import { q, sequelize } from '../src/db/sequelize';

describe('document status logic', () => {
  const now = new Date('2026-10-08T10:00:00Z');
  it('classifies by calendar days', () => {
    expect(documentStatus('2026-10-07', now)).toBe('EXPIRED');
    expect(documentStatus('2026-10-08', now)).toBe('EXPIRING_SOON');
    expect(documentStatus('2026-11-07', now)).toBe('EXPIRING_SOON');
    expect(documentStatus('2026-11-08', now)).toBe('ACTIVE');
  });
});

describe('trip state machine', () => {
  it('only allows defined transitions', () => {
    expect(findTransition('DRAFT', 'DISPATCHED')).toBeUndefined();
    expect(findTransition('COMPLETED', 'IN_TRANSIT')).toBeUndefined();
    expect(findTransition('DISPATCHED', 'IN_TRANSIT')).toBeTruthy();
  });
  it('driver can progress a trip but never dispatch or cancel', () => {
    const labels = (s: any) => allowedTransitions(s, 'DRIVER').map((t) => t.to);
    expect(labels('DISPATCHED')).toEqual(['IN_TRANSIT']);
    expect(labels('ASSIGNED')).toEqual([]);
    expect(labels('PLANNED')).toEqual([]);
  });
  it('permission matrix is consistent', () => {
    expect(can('SUPER_ADMIN', 'users:manage')).toBe(true);
    expect(can('MANAGEMENT_VIEWER', 'trips:create')).toBe(false);
    for (const r of ROLES) expect(ROLE_PERMISSIONS[r].length).toBeGreaterThan(0);
  });
});

describe('seed is deterministic and relationally consistent', () => {
  it('produces identical structure for the same anchor and has no orphans', async () => {
    const anchor = new Date('2026-10-08T06:30:00Z');
    const a = await seedDemo({ anchor: new Date(anchor), log: false });
    const codesA = (await q<any>('SELECT code, status, vehicle_id, driver_id FROM trips ORDER BY id')).map((t) => `${t.code}:${t.status}:${t.vehicle_id}:${t.driver_id}`);
    const b = await seedDemo({ anchor: new Date(anchor), log: false });
    const codesB = (await q<any>('SELECT code, status, vehicle_id, driver_id FROM trips ORDER BY id')).map((t) => `${t.code}:${t.status}:${t.vehicle_id}:${t.driver_id}`);
    expect(a).toEqual(b);
    expect(codesA).toEqual(codesB);
    const [orph] = await q<any>(`SELECT
      (SELECT count(*) FROM trips WHERE status IN ('ASSIGNED','DISPATCHED','IN_TRANSIT','DELAYED','ON_HOLD','ARRIVED','DELIVERED','RETURNING','COMPLETED') AND (vehicle_id IS NULL OR driver_id IS NULL))::int AS unassigned,
      (SELECT count(*) FROM trips t WHERE t.status = 'COMPLETED' AND NOT EXISTS (SELECT 1 FROM trip_events e WHERE e.trip_id = t.id AND e.to_status = 'COMPLETED'))::int AS no_events,
      (SELECT count(*) FROM vehicles v WHERE v.status = 'ON_TRIP' AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.vehicle_id = v.id AND t.status IN ('DISPATCHED','IN_TRANSIT','DELAYED','ON_HOLD','ARRIVED','DELIVERED','RETURNING')))::int AS ghost_vehicles,
      (SELECT count(*) FROM drivers d WHERE d.status = 'ON_TRIP' AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.driver_id = d.id AND t.status IN ('DISPATCHED','IN_TRANSIT','DELAYED','ON_HOLD','ARRIVED','DELIVERED','RETURNING')))::int AS ghost_drivers`);
    expect(orph).toEqual({ unassigned: 0, no_events: 0, ghost_vehicles: 0, ghost_drivers: 0 });
    expect(a.vehicles).toBe(26); expect(a.drivers).toBe(36);
    await sequelize.query('SELECT 1');
  });
});

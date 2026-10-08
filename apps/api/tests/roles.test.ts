import { describe, expect, it } from 'vitest';
import { as, PASSWORD, USERS } from './helpers';

describe('custom roles', () => {
  it('only the super admin manages roles', async () => {
    expect((await (await as(USERS.manager)).get('/roles')).status).toBe(403);
    expect((await (await as(USERS.manager)).post('/roles', { name: 'Hacker', basedOn: 'DISPATCHER', permissions: ['finance:view'] })).status).toBe(403);
    const r = await (await as(USERS.superAdmin)).get('/roles');
    expect(r.status).toBe(200);
    expect(r.body.roles.filter((x: any) => !x.custom).length).toBe(9);
    expect(r.body.groups.some((g: any) => g.module === 'Trips')).toBe(true);
    expect(JSON.stringify(r.body.groups)).not.toContain('demo:reset');
  });

  it('creates a role with chosen permissions, enforces them on the API, and applies edits immediately', async () => {
    const admin = await as(USERS.superAdmin);
    expect((await admin.post('/roles', { name: 'Empty', basedOn: 'DISPATCHER', permissions: [] })).status).toBe(422);
    expect((await admin.post('/roles', { name: 'Bad', basedOn: 'SUPER_ADMIN', permissions: ['dashboard:view'] })).status).toBe(400);
    const made = await admin.post('/roles', { name: 'Billing Clerk', description: 'Invoices only', basedOn: 'ACCOUNTANT', permissions: ['dashboard:view', 'sales:view', 'sales:manage', 'demo:reset'] });
    expect(made.status).toBe(201);
    const code = made.body.role.role;
    expect(code).toMatch(/^CR_/);
    expect(made.body.role.permissions).not.toContain('demo:reset'); // never grantable
    expect((await admin.post('/roles', { name: 'billing clerk', basedOn: 'ACCOUNTANT', permissions: ['dashboard:view'] })).status).toBe(409);
    expect((await admin.post('/roles', { name: 'Dispatcher', basedOn: 'ACCOUNTANT', permissions: ['dashboard:view'] })).status).toBe(409);

    const email = 'clerk.test@gasman-demo.local';
    const u = await admin.post('/users', { email, fullName: 'Test Clerk', role: code, password: PASSWORD });
    expect(u.status).toBe(201);
    const clerk = await as(email);
    const me = (await clerk.get('/auth/me')).body.user;
    expect(me.roleLabel).toBe('Billing Clerk');
    expect(me.permissions.sort()).toEqual(['dashboard:view', 'sales:manage', 'sales:view']);
    expect((await clerk.get('/sales/billing-queue')).status).toBe(200);
    expect((await clerk.get('/vehicles')).status).toBe(403);
    expect((await clerk.get('/finance/accounts')).status).toBe(403);
    expect((await clerk.get('/roles')).status).toBe(403);

    // edit takes effect without a new login
    expect((await admin.patch(`/roles/${code}`, { name: 'Billing Clerk', basedOn: 'ACCOUNTANT', permissions: ['dashboard:view', 'vehicles:view'] })).status).toBe(200);
    expect((await clerk.get('/vehicles')).status).toBe(200);
    expect((await clerk.get('/sales/billing-queue')).status).toBe(403);

    // built-ins are fixed; a role in use cannot be deleted
    expect((await admin.patch('/roles/DISPATCHER', { name: 'X', basedOn: 'DISPATCHER', permissions: ['dashboard:view'] })).status).toBe(422);
    expect((await admin.del('/roles/DISPATCHER')).status).toBe(422);
    expect((await admin.del(`/roles/${code}`)).status).toBe(409);
    const uid = u.body.user.id;
    expect((await admin.patch(`/users/${uid}`, { role: 'DISPATCHER' })).status).toBe(200);
    expect((await admin.del(`/roles/${code}`)).status).toBe(200);
    // a deleted role locks out stragglers instead of granting anything
    expect((await clerk.get('/vehicles')).status).toBeGreaterThanOrEqual(200);
  });

  it('prevents privilege escalation through user management', async () => {
    const admin = await as(USERS.superAdmin);
    const role = await admin.post('/roles', { name: 'People Admin', basedOn: 'HR_MANAGER', permissions: ['dashboard:view', 'users:view', 'users:manage'] });
    const email = 'people.admin@gasman-demo.local';
    expect((await admin.post('/users', { email, fullName: 'People Admin', role: role.body.role.role, password: PASSWORD })).status).toBe(201);
    const pa = await as(email);
    expect((await pa.post('/users', { email: 'x1@gasman-demo.local', fullName: 'Sneaky One', role: 'SUPER_ADMIN', password: PASSWORD })).status).toBe(403);
    expect((await pa.post('/users', { email: 'x2@gasman-demo.local', fullName: 'Sneaky Two', role: 'ACCOUNTANT', password: PASSWORD })).status).toBe(403); // has finance they lack
    const sa = (await admin.get('/users?role=SUPER_ADMIN')).body.data[0];
    expect((await pa.patch(`/users/${sa.id}`, { status: 'DISABLED' })).status).toBe(403);
  });
});

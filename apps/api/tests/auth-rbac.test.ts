import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, as, PASSWORD, USERS } from './helpers';

describe('authentication', () => {
  it('logs in with valid credentials and returns tokens + permissions', async () => {
    const r = await request(app).post('/api/v1/auth/login').send({ email: USERS.dispatcher, password: PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBeTruthy();
    expect(r.body.refreshToken).toBeTruthy();
    expect(r.body.user.role).toBe('DISPATCHER');
    expect(r.body.user.permissions).toContain('trips:dispatch');
    expect(r.body.user.permissions).not.toContain('vehicles:create');
  });

  it('rejects wrong password with a generic message (no user enumeration)', async () => {
    const a = await request(app).post('/api/v1/auth/login').send({ email: USERS.dispatcher, password: 'nope-nope-nope' });
    const b = await request(app).post('/api/v1/auth/login').send({ email: 'ghost@gasman-demo.local', password: 'nope-nope-nope' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('requires a token for API routes', async () => {
    expect((await request(app).get('/api/v1/vehicles')).status).toBe(401);
    expect((await request(app).get('/api/v1/vehicles').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });

  it('locks an account after repeated failures', async () => {
    const admin = await as(USERS.superAdmin);
    const created = await admin.post('/users', { email: 'locktest@gasman-demo.local', fullName: 'Lock Test', role: 'MANAGEMENT_VIEWER', password: 'LockTest#2026!' });
    expect(created.status).toBe(201);
    for (let i = 0; i < 5; i++) await request(app).post('/api/v1/auth/login').send({ email: 'locktest@gasman-demo.local', password: 'wrong-password-1' });
    const r = await request(app).post('/api/v1/auth/login').send({ email: 'locktest@gasman-demo.local', password: 'LockTest#2026!' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: USERS.viewer, password: PASSWORD });
    const t1 = login.body.refreshToken;
    const r1 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: t1 });
    expect(r1.status).toBe(200);
    const t2 = r1.body.refreshToken;
    expect(t2).not.toBe(t1);
    // replaying the old token = theft signal: whole family revoked
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: t1 })).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: t2 })).status).toBe(401);
  });
});

describe('role based access control (enforced by the API, not just the UI)', () => {
  it('management viewer is read-only', async () => {
    const v = await as(USERS.viewer);
    expect((await v.get('/vehicles')).status).toBe(200);
    expect((await v.get('/dashboard')).status).toBe(200);
    expect((await v.post('/vehicles', { code: 'X', registrationNo: 'X', fleetType: 'OWNED', capacityMt: 10 })).status).toBe(403);
    expect((await v.post('/trips', {})).status).toBe(403);
    expect((await v.get('/audit-logs')).status).toBe(403);
    expect((await v.get('/users')).status).toBe(403);
  });

  it('dispatcher can plan trips but cannot manage fleet or users', async () => {
    const d = await as(USERS.dispatcher);
    expect((await d.get('/trips')).status).toBe(200);
    expect((await d.post('/vehicles', { code: 'X-1', registrationNo: 'X-1', fleetType: 'OWNED', capacityMt: 10 })).status).toBe(403);
    expect((await d.post('/drivers', {})).status).toBe(403);
    expect((await d.post('/users', {})).status).toBe(403);
    expect((await d.post('/maintenance', {})).status).toBe(403);
  });

  it('fleet manager manages vehicles but cannot dispatch', async () => {
    const f = await as(USERS.fleet);
    expect((await f.post('/trips', {})).status).toBe(403);
    const t = (await (await as(USERS.superAdmin)).get('/trips?status=ASSIGNED&pageSize=1')).body.data[0];
    expect((await f.post(`/trips/${t.id}/transition`, { to: 'DISPATCHED' })).status).toBe(403);
  });

  it('only super admin manages users and resets demo data', async () => {
    expect((await (await as(USERS.manager)).post('/users', {})).status).toBe(403);
    expect((await (await as(USERS.manager)).get('/users')).status).toBe(200);
    expect((await (await as(USERS.manager)).post('/demo/reset')).status).toBe(403);
  });

  it('driver only sees own trips and cannot read other drivers or admin data', async () => {
    const d = await as(USERS.driver);
    const me = (await d.get('/auth/me')).body.user;
    const mine = await d.get('/trips?pageSize=100');
    expect(mine.status).toBe(200);
    expect(mine.body.data.length).toBeGreaterThan(0);
    expect(mine.body.data.every((t: any) => t.driver_id === me.driverId)).toBe(true);
    const all = (await (await as(USERS.superAdmin)).get('/trips?pageSize=100')).body.data;
    const others = all.find((t: any) => t.driver_id !== me.driverId && t.driver_id);
    expect((await d.get(`/trips/${others.id}`)).status).toBe(403);
    expect((await d.get('/drivers/1')).status === 403 || me.driverId === 1).toBe(true);
    expect((await d.get('/users')).status).toBe(403);
    expect((await d.get('/dashboard')).status).toBe(403);
    expect((await d.get('/reports/trips')).status).toBe(403);
    expect((await d.get('/audit-logs')).status).toBe(403);
  });
});

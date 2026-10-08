import request from 'supertest';
import { createApp } from '../src/app';

export const app = createApp();
export const PASSWORD = 'GasMan@Demo2026';
export const USERS = {
  superAdmin: 'superadmin@gasman-demo.local',
  manager: 'transport.manager@gasman-demo.local',
  dispatcher: 'dispatcher@gasman-demo.local',
  fleet: 'fleet.manager@gasman-demo.local',
  driver: 'driver@gasman-demo.local',
  viewer: 'management@gasman-demo.local',
  accountant: 'accountant@gasman-demo.local',
  store: 'store.manager@gasman-demo.local',
  hr: 'hr.manager@gasman-demo.local',
};
const cache = new Map<string, string>();
export async function tokenFor(email: string): Promise<string> {
  if (cache.has(email)) return cache.get(email)!;
  const r = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  cache.set(email, r.body.accessToken);
  return r.body.accessToken;
}
export const as = async (email: string) => {
  const t = await tokenFor(email);
  const h = { Authorization: `Bearer ${t}` };
  return {
    get: (p: string) => request(app).get(`/api/v1${p}`).set(h),
    post: (p: string, b?: object) => request(app).post(`/api/v1${p}`).set(h).send(b ?? {}),
    patch: (p: string, b?: object) => request(app).patch(`/api/v1${p}`).set(h).send(b ?? {}),
    del: (p: string) => request(app).delete(`/api/v1${p}`).set(h),
  };
};

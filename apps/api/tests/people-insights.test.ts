import { describe, expect, it } from 'vitest';
import { as, USERS } from './helpers';
import { q1 } from '../src/db/sequelize';

describe('HR & payroll', () => {
  it('salary figures are visible only to payroll managers', async () => {
    const hr = (await (await as(USERS.hr)).get('/hr/employees?pageSize=3')).body.data[0];
    expect(hr.basic_salary).toBeGreaterThan(0);
    const viewer = (await (await as(USERS.viewer)).get('/hr/employees?pageSize=3')).body.data[0];
    expect(viewer.basic_salary).toBeUndefined();
    expect((await (await as(USERS.viewer)).get('/hr/payroll')).status).toBe(403);
    expect((await (await as(USERS.dispatcher)).get('/hr/employees')).status).toBe(403);
    expect((await (await as(USERS.driver)).get('/hr/employees')).status).toBe(403);
  });

  it('attendance cannot be marked in the future; leave goes through approval and lands on the sheet', async () => {
    const hr = await as(USERS.hr); const admin = await as(USERS.superAdmin);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    expect((await hr.post('/hr/attendance/mark', { date: tomorrow, allPresent: true })).status).toBe(422);
    const emp = await q1<any>("SELECT id FROM employees WHERE employee_type = 'STAFF' AND status = 'ACTIVE' ORDER BY id DESC LIMIT 1");
    const from = new Date(Date.now() - 40 * 86400000); while (from.getUTCDay() === 0) from.setUTCDate(from.getUTCDate() + 1);
    const day = from.toISOString().slice(0, 10);
    await q1("DELETE FROM attendance WHERE employee_id = :e AND work_date = :d RETURNING 1", { e: emp.id, d: day });
    const lv = await hr.post('/hr/leave', { employeeId: emp.id, leaveType: 'CASUAL', fromDate: day, toDate: day, reason: 'test' });
    expect(lv.status).toBe(201);
    const clash = await hr.post('/hr/leave', { employeeId: emp.id, leaveType: 'SICK', fromDate: day, toDate: day });
    expect(clash.status).toBe(409);
    const ap = await q1<any>("SELECT id FROM approvals WHERE entity_type = 'LEAVE' AND entity_id = :id AND status = 'PENDING'", { id: lv.body.leave.id });
    expect((await admin.post(`/approvals/${ap.id}/decide`, { decision: 'APPROVED' })).status).toBe(200);
    const row = await q1<any>('SELECT status FROM attendance WHERE employee_id = :e AND work_date = :d', { e: emp.id, d: day });
    expect(row.status).toBe('L');
  });

  it('payroll: submit → approve posts to the ledger → pay clears salaries payable', async () => {
    const hr = await as(USERS.hr); const admin = await as(USERS.superAdmin);
    const period = new Date().toISOString().slice(0, 7);
    const built = await hr.post('/hr/payroll', { period });
    expect(built.status).toBe(201); expect(Number(built.body.run.net)).toBeGreaterThan(0);
    expect((await hr.post('/hr/payroll', { period: '2099-01' })).status).toBe(422); // future month
    const pay0 = await hr.post(`/hr/payroll/${built.body.run.id}/pay`, { mode: 'CASH' });
    expect(pay0.status).toBe(422); // not approved yet
    expect((await hr.post(`/hr/payroll/${built.body.run.id}/submit`)).status).toBe(200);
    expect((await hr.post('/hr/payroll', { period })).status).toBe(422); // locked once submitted
    const ap = await q1<any>("SELECT id FROM approvals WHERE entity_type = 'PAYROLL' AND entity_id = :id AND status = 'PENDING'", { id: built.body.run.id });
    expect((await (await as(USERS.manager)).post(`/approvals/${ap.id}/decide`, { decision: 'APPROVED' })).status).toBe(403); // payroll needs the super admin by rule
    expect((await admin.post(`/approvals/${ap.id}/decide`, { decision: 'APPROVED' })).status).toBe(200);
    const run = await q1<any>('SELECT status, voucher_id FROM payroll_runs WHERE id = :id', { id: built.body.run.id });
    expect(run.status).toBe('POSTED'); expect(run.voucher_id).toBeGreaterThan(0);
    expect((await hr.post(`/hr/payroll/${built.body.run.id}/pay`, { mode: 'BANK' })).status).toBe(400); // bank required
    const bank = await q1<any>('SELECT id FROM banks ORDER BY id LIMIT 1');
    expect((await hr.post(`/hr/payroll/${built.body.run.id}/pay`, { mode: 'BANK', bankId: bank.id })).status).toBe(200);
    expect((await q1<any>('SELECT status FROM payroll_runs WHERE id = :id', { id: built.body.run.id })).status).toBe('PAID');
  });
});

describe('exceptions, assistant, setup & trip vouchers', () => {
  it('exceptions are role-filtered and can be marked reviewed', async () => {
    const mgr = await as(USERS.manager);
    const r = (await mgr.get('/exceptions')).body;
    expect(r.total).toBeGreaterThan(5);
    expect((await (await as(USERS.driver)).get('/exceptions')).status).toBe(403);
    const fleet = (await (await as(USERS.fleet)).get('/exceptions')).body;
    expect(fleet.data.every((e: any) => !['Finance', 'People'].includes(e.category))).toBe(true);
    const first = r.data[0];
    expect((await mgr.post('/exceptions/ack', { key: first.key, note: 'seen' })).status).toBe(200);
    const after = (await mgr.get('/exceptions')).body;
    expect(after.data.find((e: any) => e.key === first.key)).toBeUndefined();
    expect((await mgr.get('/exceptions?acked=1')).body.data.find((e: any) => e.key === first.key)?.acked?.note).toBe('seen');
  });

  it('assistant answers from live data, respects permissions and says what it is', async () => {
    const acc = await as(USERS.accountant);
    const r = (await acc.post('/assistant/ask', { question: 'Who owes us the most?' })).body;
    expect(r.intent).toBe('receivables'); expect(r.rows.length).toBeGreaterThan(0); expect(r.notice).toMatch(/not a language model/i);
    const denied = (await (await as(USERS.dispatcher)).post('/assistant/ask', { question: 'Who owes us the most?' })).body;
    expect(denied.intent).toBe('denied');
    const unknown = (await acc.post('/assistant/ask', { question: 'Tell me a joke about camels' })).body;
    expect(unknown.intent).toBe('unknown'); expect(unknown.suggestions.length).toBeGreaterThan(2);
    expect((await (await as(USERS.driver)).post('/assistant/ask', { question: 'hello there' })).status).toBe(403);
    const trip = await q1<any>("SELECT code FROM trips WHERE status = 'COMPLETED' LIMIT 1");
    expect((await (await as(USERS.dispatcher)).post('/assistant/ask', { question: `status of ${trip.code}` })).body.intent).toBe('trip');
  });

  it('setup integrity checks pass on the seeded data; expense defaults are editable by admins only', async () => {
    const r = (await (await as(USERS.superAdmin)).get('/setup/integrity')).body;
    expect(r.checks.filter((c: any) => !c.ok)).toEqual([]);
    const upd = await (await as(USERS.superAdmin)).patch('/setup/expense-definitions/TOLL', { defaultAmount: 1800 });
    expect(upd.status).toBe(200);
    expect((await (await as(USERS.dispatcher)).patch('/setup/expense-definitions/TOLL', { defaultAmount: 1 })).status).toBe(403);
  });

  it('trip voucher registers hide money from non-finance roles and scope drivers to themselves', async () => {
    const dispatcher = await as(USERS.dispatcher);
    const comp = (await dispatcher.get('/trip-vouchers/reports/trip-completion?from=2020-01-01')).body;
    expect(comp.columns.some((c: any) => c.key === 'income')).toBe(false);
    const fin = (await (await as(USERS.manager)).get('/trip-vouchers/reports/trip-completion?from=2020-01-01')).body;
    expect(fin.columns.some((c: any) => c.key === 'income')).toBe(true);
    const up = (await dispatcher.get('/trip-vouchers/reports/uplifting?from=2020-01-01')).body;
    expect(up.rows.length).toBeGreaterThan(0);
    const mine = (await (await as(USERS.driver)).get('/trip-vouchers/reports/trip-start?from=2020-01-01')).body;
    const drv = await q1<any>("SELECT d.full_name FROM users u JOIN drivers d ON d.id = u.driver_id WHERE u.email = :e", { e: USERS.driver });
    expect(mine.rows.every((r: any) => r.driver === drv.full_name)).toBe(true);
    expect((await (await as(USERS.driver)).get('/trip-vouchers/reports/trip-expense')).status).toBe(200);
  });
});

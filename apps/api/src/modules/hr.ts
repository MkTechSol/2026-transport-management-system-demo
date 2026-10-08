import { Router } from 'express';
import { z } from 'zod';
import { can } from '@gasman/shared';
import { q, q1, exec, sequelize } from '../db/sequelize';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors';
import { id, likeTerm, listResponse, paging, parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';
import { requestApproval } from '../services/approvals';
import { buildPayrollRun, payPayroll, submitPayroll } from '../services/hr';

export const hrRouter = Router();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const today = () => new Date().toISOString().slice(0, 10);

hrRouter.get('/summary', requirePerm('hr:view'), wrap(async (req, res) => {
  const day = today();
  const [s] = await q(`SELECT (SELECT count(*)::int FROM employees WHERE status = 'ACTIVE') AS headcount,
      (SELECT count(*)::int FROM attendance WHERE work_date = :d AND status IN ('P','H')) AS present_today, (SELECT count(*)::int FROM attendance WHERE work_date = :d AND status = 'A') AS absent_today, (SELECT count(*)::int FROM attendance WHERE work_date = :d AND status = 'L') AS on_leave_today,
      (SELECT count(*)::int FROM leave_requests WHERE status = 'PENDING') AS pending_leave`, { d: day });
  const payroll = can(req.user!.role, 'payroll:manage') ? await q1(`SELECT period, status, net::float AS net FROM payroll_runs ORDER BY period DESC LIMIT 1`) : null;
  res.json({ ...s, payroll });
}));

// ---------- Departments & employees ----------
hrRouter.get('/departments', requirePerm('hr:view'), wrap(async (_req, res) => res.json({ data: await q('SELECT d.*, (SELECT count(*)::int FROM employees e WHERE e.department_id = d.id AND e.status = \'ACTIVE\') AS headcount FROM departments d ORDER BY d.name') })));
hrRouter.post('/departments', requirePerm('hr:manage'), wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(80) }), req.body);
  if (await q1('SELECT 1 FROM departments WHERE lower(name) = lower(:n)', { n: b.name })) throw conflict('This department already exists.', { fields: { name: 'Already exists' } });
  res.status(201).json({ department: await q1('INSERT INTO departments (name) VALUES (:n) RETURNING *', { n: b.name }) });
}));

const empBody = z.object({
  fullName: z.string().trim().min(2).max(120), departmentId: z.coerce.number().int().positive().nullish(), designation: z.string().trim().max(80).nullish(), employeeType: z.enum(['STAFF', 'DRIVER', 'HELPER', 'MANAGER']).default('STAFF'),
  driverId: z.coerce.number().int().positive().nullish(), phone: z.string().trim().max(30).nullish(), joinedOn: dateStr.optional(), basicSalary: z.coerce.number().min(0).max(5_000_000).default(0), allowances: z.coerce.number().min(0).max(5_000_000).default(0),
  tripRate: z.coerce.number().min(0).max(100_000).default(0), bankName: z.string().trim().max(80).nullish(), bankAccount: z.string().trim().max(40).nullish(),
});
hrRouter.get('/employees', requirePerm('hr:view'), wrap(async (req, res) => {
  const p = paging(req.query); const f = parse(z.object({ departmentId: z.coerce.number().optional(), type: z.string().optional(), status: z.string().optional() }), req.query);
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (f.departmentId) { where.push('e.department_id = :dep'); r.dep = f.departmentId; }
  if (f.type) { where.push('e.employee_type = :type'); r.type = f.type; }
  where.push(`e.status = :st`); r.st = f.status ?? 'ACTIVE';
  if (p.q) { where.push('(e.full_name ILIKE :q OR e.code ILIKE :q OR e.designation ILIKE :q)'); r.q = likeTerm(p.q); }
  const pay = can(req.user!.role, 'payroll:manage');
  const from = `FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE ${where.join(' AND ')}`;
  const [rows, [{ total }]] = await Promise.all([
    q(`SELECT e.id, e.code, e.full_name, e.designation, e.employee_type, e.phone, e.joined_on, e.status, e.driver_id, d.name AS department ${pay ? ', e.basic_salary::float, e.allowances::float, e.trip_rate::float, e.bank_name, e.bank_account' : ''} ${from} ORDER BY e.full_name LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total ${from}`, r),
  ]);
  res.json(listResponse(rows, total, p.page, p.pageSize));
}));
hrRouter.post('/employees', requirePerm('hr:manage'), wrap(async (req, res) => {
  const b = parse(empBody, req.body);
  if ((b.basicSalary || b.allowances || b.tripRate) && !can(req.user!.role, 'payroll:manage')) throw badRequest('Only payroll managers can set salary figures.');
  const n = await q1<any>('SELECT count(*)::int + 1 AS n FROM employees');
  const row = await q1<any>(`INSERT INTO employees (code, full_name, department_id, designation, employee_type, driver_id, phone, joined_on, basic_salary, allowances, trip_rate, bank_name, bank_account)
    VALUES (:c, :n, :d, :des, :t, :dr, :ph, :j, :b, :a, :tr, :bn, :ba) RETURNING id, code, full_name`,
    { c: `EMP-${String(n.n).padStart(4, '0')}`, n: b.fullName, d: b.departmentId ?? null, des: b.designation ?? null, t: b.employeeType, dr: b.driverId ?? null, ph: b.phone ?? null, j: b.joinedOn ?? today(), b: b.basicSalary, a: b.allowances, tr: b.tripRate, bn: b.bankName ?? null, ba: b.bankAccount ?? null });
  await audit(req, { action: 'EMPLOYEE_CREATED', entityType: 'EMPLOYEE', entityId: row.id, entityLabel: `${row.code} ${row.full_name}` });
  res.status(201).json({ employee: row });
}));
hrRouter.patch('/employees/:id', requirePerm('hr:manage'), wrap(async (req, res) => {
  const b = parse(empBody.partial().extend({ status: z.enum(['ACTIVE', 'LEFT']).optional() }), req.body);
  const salary = b.basicSalary !== undefined || b.allowances !== undefined || b.tripRate !== undefined;
  if (salary && !can(req.user!.role, 'payroll:manage')) throw badRequest('Only payroll managers can change salary figures.');
  const row = await q1<any>(`UPDATE employees SET full_name = COALESCE(:n, full_name), department_id = COALESCE(:d, department_id), designation = COALESCE(:des, designation), phone = COALESCE(:ph, phone), basic_salary = COALESCE(:b, basic_salary), allowances = COALESCE(:a, allowances),
      trip_rate = COALESCE(:tr, trip_rate), bank_name = COALESCE(:bn, bank_name), bank_account = COALESCE(:ba, bank_account), status = COALESCE(:st, status) WHERE id = :id RETURNING id, code, full_name`,
    { n: b.fullName ?? null, d: b.departmentId ?? null, des: b.designation ?? null, ph: b.phone ?? null, b: b.basicSalary ?? null, a: b.allowances ?? null, tr: b.tripRate ?? null, bn: b.bankName ?? null, ba: b.bankAccount ?? null, st: b.status ?? null, id: id(req) });
  if (!row) throw notFound('Employee');
  await audit(req, { action: salary ? 'EMPLOYEE_SALARY_CHANGED' : 'EMPLOYEE_UPDATED', entityType: 'EMPLOYEE', entityId: row.id, entityLabel: `${row.code} ${row.full_name}` });
  res.json({ employee: row });
}));

// ---------- Attendance ----------
hrRouter.get('/attendance', requirePerm('hr:view'), wrap(async (req, res) => {
  const f = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), departmentId: z.coerce.number().optional(), q: z.string().optional() }), req.query);
  const month = f.month ?? today().slice(0, 7);
  const [y, m] = month.split('-').map(Number); const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const emps = await q<any>(`SELECT e.id, e.code, e.full_name, d.name AS department FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.status = 'ACTIVE' AND e.joined_on <= :to ${f.departmentId ? 'AND e.department_id = :dep' : ''} ${f.q ? 'AND e.full_name ILIKE :q' : ''} ORDER BY e.full_name LIMIT 200`, { to: `${month}-${String(days).padStart(2, '0')}`, dep: f.departmentId, q: f.q ? likeTerm(f.q) : undefined });
  const att = emps.length ? await q<any>(`SELECT employee_id, extract(day FROM work_date)::int AS d, status FROM attendance WHERE employee_id IN (:ids) AND work_date BETWEEN :f AND :t`, { ids: emps.map((e) => e.id), f: `${month}-01`, t: `${month}-${String(days).padStart(2, '0')}` }) : [];
  const by = new Map<number, Record<number, string>>(); for (const a of att) { const o = by.get(a.employee_id) ?? {}; o[a.d] = a.status; by.set(a.employee_id, o); }
  res.json({ month, days, data: emps.map((e) => { const cells = by.get(e.id) ?? {}; const vals = Object.values(cells); return { ...e, cells, present: vals.filter((v) => v === 'P').length + vals.filter((v) => v === 'H').length * 0.5, absent: vals.filter((v) => v === 'A').length, leave: vals.filter((v) => v === 'L').length }; }) });
}));
hrRouter.post('/attendance/mark', requirePerm('hr:manage'), wrap(async (req, res) => {
  const b = parse(z.object({ date: dateStr, allPresent: z.boolean().optional(), entries: z.array(z.object({ employeeId: z.coerce.number().int().positive(), status: z.enum(['P', 'A', 'L', 'H', 'OFF']), checkIn: z.string().regex(/^\d{2}:\d{2}$/).nullish(), checkOut: z.string().regex(/^\d{2}:\d{2}$/).nullish(), note: z.string().max(200).nullish() })).max(500).optional() }), req.body);
  if (b.date > today()) throw unprocessable('Attendance cannot be marked for a future date.');
  const n = await sequelize.transaction(async (tx) => {
    if (b.allPresent) {
      const r = await q<any>(`INSERT INTO attendance (employee_id, work_date, status, check_in) SELECT e.id, :d, 'P', '08:30' FROM employees e WHERE e.status = 'ACTIVE' AND e.joined_on <= :d ON CONFLICT (employee_id, work_date) DO NOTHING RETURNING employee_id`, { d: b.date }, tx);
      return r.length;
    }
    for (const e of b.entries ?? []) await exec(`INSERT INTO attendance (employee_id, work_date, status, check_in, check_out, note) VALUES (:e, :d, :s, :ci, :co, :n) ON CONFLICT (employee_id, work_date) DO UPDATE SET status = :s, check_in = :ci, check_out = :co, note = :n`, { e: e.employeeId, d: b.date, s: e.status, ci: e.checkIn ?? null, co: e.checkOut ?? null, n: e.note ?? null }, tx);
    return b.entries?.length ?? 0;
  });
  await audit(req, { action: 'ATTENDANCE_MARKED', entityType: 'ATTENDANCE', entityLabel: `${b.date}: ${n} record(s)` });
  res.json({ marked: n });
}));

// ---------- Leave ----------
hrRouter.get('/leave', requirePerm('hr:view'), wrap(async (req, res) => {
  const p = paging(req.query); const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (status) { where.push('l.status IN (:st)'); r.st = status.split(','); }
  if (p.q) { where.push('(e.full_name ILIKE :q OR e.code ILIKE :q)'); r.q = likeTerm(p.q); }
  const from = `FROM leave_requests l JOIN employees e ON e.id = l.employee_id WHERE ${where.join(' AND ')}`;
  const [rows, [{ total }]] = await Promise.all([q(`SELECT l.*, e.full_name, e.code FROM leave_requests l JOIN employees e ON e.id = l.employee_id WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT :lim OFFSET :off`, r), q(`SELECT count(*)::int AS total ${from}`, r)]);
  res.json(listResponse(rows, total, p.page, p.pageSize));
}));
hrRouter.post('/leave', requirePerm('hr:manage'), wrap(async (req, res) => {
  const b = parse(z.object({ employeeId: z.coerce.number().int().positive(), leaveType: z.enum(['ANNUAL', 'SICK', 'CASUAL', 'UNPAID']), fromDate: dateStr, toDate: dateStr, reason: z.string().trim().max(250).optional() }), req.body);
  if (b.toDate < b.fromDate) throw badRequest('The end date cannot be before the start date.', { fields: { toDate: 'Before start date' } });
  const out = await sequelize.transaction(async (tx) => {
    if (!(await q1('SELECT 1 FROM employees WHERE id = :id AND status = \'ACTIVE\'', { id: b.employeeId }, tx))) throw notFound('Employee');
    const clash = await q1('SELECT 1 FROM leave_requests WHERE employee_id = :e AND status IN (\'PENDING\',\'APPROVED\') AND from_date <= :t AND to_date >= :f', { e: b.employeeId, f: b.fromDate, t: b.toDate }, tx);
    if (clash) throw conflict('This employee already has leave booked in that period.');
    const days = (await q1<any>(`SELECT count(*) FILTER (WHERE extract(dow FROM d) <> 0)::float AS n FROM generate_series(:f::date, :t::date, interval '1 day') d`, { f: b.fromDate, t: b.toDate }, tx)).n;
    if (!(days > 0)) throw badRequest('The selected dates fall only on weekly offs.');
    const l = await q1<any>(`INSERT INTO leave_requests (employee_id, leave_type, from_date, to_date, days, reason, requested_by) VALUES (:e, :lt, :f, :t, :d, :r, :u) RETURNING *`, { e: b.employeeId, lt: b.leaveType, f: b.fromDate, t: b.toDate, d: days, r: b.reason ?? null, u: req.user!.id }, tx);
    const emp = await q1<any>('SELECT full_name FROM employees WHERE id = :id', { id: b.employeeId }, tx);
    await requestApproval({ entityType: 'LEAVE', entityId: l.id, title: `${emp.full_name} · ${days} day(s) ${b.leaveType.toLowerCase()} leave`, requestedBy: req.user!.id, tx });
    return l;
  });
  res.status(201).json({ leave: out });
}));

// ---------- Payroll ----------
hrRouter.get('/payroll', requirePerm('payroll:manage'), wrap(async (_req, res) => {
  res.json({ data: await q(`SELECT r.*, r.gross::float AS gross_f, (SELECT count(*)::int FROM payroll_lines l WHERE l.run_id = r.id) AS employees FROM payroll_runs r ORDER BY r.period DESC LIMIT 24`) });
}));
hrRouter.get('/payroll/:id', requirePerm('payroll:manage'), wrap(async (req, res) => {
  const run = await q1<any>('SELECT * FROM payroll_runs WHERE id = :id', { id: id(req) });
  if (!run) throw notFound('Payroll run');
  const lines = await q(`SELECT l.*, e.full_name, e.code, e.employee_type, d.name AS department FROM payroll_lines l JOIN employees e ON e.id = l.employee_id LEFT JOIN departments d ON d.id = e.department_id WHERE l.run_id = :id ORDER BY e.full_name`, { id: run.id });
  res.json({ run, lines });
}));
hrRouter.post('/payroll', requirePerm('payroll:manage'), wrap(async (req, res) => {
  const b = parse(z.object({ period: z.string() }), req.body);
  res.status(201).json({ run: await buildPayrollRun(req.user!, req, b.period) });
}));
hrRouter.post('/payroll/:id/submit', requirePerm('payroll:manage'), wrap(async (req, res) => { await submitPayroll(req.user!, req, id(req)); res.json({ ok: true }); }));
hrRouter.post('/payroll/:id/pay', requirePerm('payroll:manage'), wrap(async (req, res) => {
  const b = parse(z.object({ mode: z.enum(['BANK', 'CASH']), bankId: z.coerce.number().int().positive().nullish() }), req.body);
  await payPayroll(req.user!, req, id(req), b.mode, b.bankId); res.json({ ok: true });
}));

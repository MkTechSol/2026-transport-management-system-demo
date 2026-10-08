import { q, q1, exec, sequelize } from '../db/sequelize';
import { requestApproval } from '../services/approvals';
import { buildPayrollRun, payPayroll, postPayroll } from '../services/hr';
import type { Rng } from './rng';

const DAY = 86400000;
const DEPTS = ['Transport Operations', 'Fleet & Workshop', 'Finance & Accounts', 'Stores & Procurement', 'HR & Admin', 'Management'];
const STAFF: [string, string, string, number][] = [
  ['Muhammad Ali', 'Chief Executive (demo)', 'Management', 285000], ['Sana Qureshi', 'Transport Manager', 'Transport Operations', 165000], ['Bilal Ahmed', 'Dispatcher', 'Transport Operations', 72000], ['Hamza Farooq', 'Dispatcher', 'Transport Operations', 70000],
  ['Rukhsana Iqbal', 'Senior Accountant', 'Finance & Accounts', 118000], ['Adeel Shah', 'Accounts Assistant', 'Finance & Accounts', 62000], ['Naveed Anjum', 'Store & Procurement Manager', 'Stores & Procurement', 98000], ['Kashif Mehmood', 'Store Keeper', 'Stores & Procurement', 54000],
  ['Farah Naz', 'HR Manager', 'HR & Admin', 112000], ['Saima Bibi', 'Office Assistant', 'HR & Admin', 46000], ['Tariq Hussain', 'Fleet Manager', 'Fleet & Workshop', 128000], ['Imtiaz Gul', 'Workshop Supervisor', 'Fleet & Workshop', 86000],
  ['Waqar Younas', 'Mechanic', 'Fleet & Workshop', 58000], ['Zeeshan Ali', 'Auto Electrician', 'Fleet & Workshop', 60000], ['Ayesha Khan', 'Safety Officer', 'Transport Operations', 84000], ['Rizwan Ullah', 'Tyre Technician', 'Fleet & Workshop', 52000],
];

export async function seedHr(c: { rng: Rng; NOW: number; log?: (m: string) => void }) {
  const { rng, NOW } = c;
  const dayStr = (off: number) => new Date(NOW + off * DAY).toISOString().slice(0, 10);
  const today = dayStr(0);
  const start = (await q1<any>('SELECT min(voucher_date)::text AS d FROM vouchers'))!.d as string;
  for (const [i, n] of DEPTS.entries()) await exec('INSERT INTO departments (id, name) VALUES (:i, :n)', { i: i + 1, n });
  const dep = (n: string) => DEPTS.indexOf(n) + 1;
  let k = 1; const code = () => `EMP-${String(k++).padStart(4, '0')}`;
  const drivers = await q<any>('SELECT id, full_name, phone FROM drivers ORDER BY id');
  const emps: any[] = [];
  for (const d of drivers) emps.push({ code: code(), full_name: d.full_name, department_id: dep('Transport Operations'), designation: 'Bowzer driver', employee_type: 'DRIVER', driver_id: d.id, phone: d.phone, joined_on: dayStr(-rng.int(200, 2400)), basic_salary: rng.int(42, 68) * 1000, allowances: 6000, trip_rate: 1500, bank_name: 'Demo Bank Ltd', bank_account: `PK00DEMO${rng.int(1e11, 9e11)}` });
  const helperNames = ['Sher Ali', 'Gul Zaman', 'Noor Alam', 'Rahim Dad', 'Fazal Rabbi', 'Habib Ullah', 'Iqbal Hussain', 'Zahid Khan', 'Anwar Shah', 'Ghulam Nabi', 'Yaqoob Ali', 'Saeed Anwar'];
  for (const n of helperNames) emps.push({ code: code(), full_name: n, department_id: dep('Transport Operations'), designation: 'Bowzer helper', employee_type: 'HELPER', driver_id: null, phone: `0300-555${rng.int(1000, 9999)}`, joined_on: dayStr(-rng.int(100, 1500)), basic_salary: rng.int(32, 38) * 1000, allowances: 3000, trip_rate: 800, bank_name: null, bank_account: null });
  for (const [n, des, dp, sal] of STAFF) emps.push({ code: code(), full_name: n, department_id: dep(dp), designation: des, employee_type: sal > 150000 ? 'MANAGER' : 'STAFF', driver_id: null, phone: `0300-555${rng.int(1000, 9999)}`, joined_on: dayStr(-rng.int(300, 3000)), basic_salary: sal, allowances: Math.round(sal * 0.08 / 500) * 500, trip_rate: 0, bank_name: 'Demo Bank Ltd', bank_account: `PK00DEMO${rng.int(1e11, 9e11)}` });
  await sequelize.getQueryInterface().bulkInsert('employees', emps);
  await exec(`SELECT setval(pg_get_serial_sequence('departments','id'), ${DEPTS.length}), setval(pg_get_serial_sequence('employees','id'), (SELECT max(id) FROM employees))`);
  const ids = (await q<any>('SELECT id, driver_id, employee_type FROM employees ORDER BY id'));

  // leave: a few approved in the past (attendance 'L'), some pending / one rejected for the approval centre
  const hrUser = (await q1<any>(`SELECT id FROM users WHERE role = 'HR_MANAGER'`))?.id ?? null;
  const leaveRow = async (empId: number, type: string, fromOff: number, days: number, status: string, reason: string) => {
    const f = dayStr(fromOff); const t = dayStr(fromOff + days - 1);
    const l = await q1<any>(`INSERT INTO leave_requests (employee_id, leave_type, from_date, to_date, days, reason, status, requested_by, decided_by, decided_at) VALUES (:e, :lt, :f, :t, :d, :r, :s, :u, :db, :da) RETURNING *`,
      { e: empId, lt: type, f, t, d: days, r: reason, s: status, u: hrUser, db: status === 'APPROVED' || status === 'REJECTED' ? hrUser : null, da: status === 'APPROVED' || status === 'REJECTED' ? new Date(NOW + (fromOff - 3) * DAY) : null });
    if (status === 'PENDING') await requestApproval({ entityType: 'LEAVE', entityId: l.id, title: `${(await q1<any>('SELECT full_name FROM employees WHERE id = :id', { id: empId }))!.full_name} · ${days} day(s) ${type.toLowerCase()} leave`, requestedBy: hrUser });
    return l;
  };
  const leaveEmps = ids.filter((e: any) => e.employee_type !== 'MANAGER');
  const approved: { e: number; f: number; d: number; t: string }[] = [];
  for (const [i, [type, off, days]] of ([['SICK', -33, 2], ['ANNUAL', -27, 5], ['CASUAL', -19, 1], ['SICK', -12, 3], ['ANNUAL', -9, 4], ['UNPAID', -22, 3]] as const).entries()) {
    const e = leaveEmps[(i * 7 + 3) % leaveEmps.length]; if (dayStr(off) < start) continue;
    await leaveRow(e.id, type, off, days, 'APPROVED', 'Approved leave'); approved.push({ e: e.id, f: off, d: days, t: type });
  }
  await leaveRow(leaveEmps[11].id, 'ANNUAL', 3, 4, 'PENDING', 'Family event'); await leaveRow(leaveEmps[17].id, 'SICK', 1, 2, 'PENDING', 'Medical appointment'); await leaveRow(leaveEmps[25].id, 'CASUAL', 6, 1, 'PENDING', 'Personal work');
  await leaveRow(leaveEmps[5].id, 'ANNUAL', -5, 10, 'REJECTED', 'Peak dispatch period');

  // attendance (Mon–Sat) from the start of the data window up to yesterday
  const rows: any[] = []; const leaveSet = new Set<string>();
  for (const a of approved) for (let d = 0; d < a.d; d++) leaveSet.add(`${a.e}|${dayStr(a.f + d)}`);
  for (let off = -75; off < 0; off++) {
    const d = dayStr(off); if (d < start) continue; const dow = new Date(`${d}T00:00:00Z`).getUTCDay(); if (dow === 0) continue;
    for (const e of ids) {
      if (leaveSet.has(`${e.id}|${d}`)) { rows.push({ employee_id: e.id, work_date: d, status: 'L', check_in: null, check_out: null, note: 'Approved leave' }); continue; }
      const r = rng.float(0, 1);
      if (r < 0.028) rows.push({ employee_id: e.id, work_date: d, status: 'A', check_in: null, check_out: null, note: null });
      else if (r < 0.04) rows.push({ employee_id: e.id, work_date: d, status: 'H', check_in: '08:40', check_out: '13:10', note: 'Half day' });
      else { const m = rng.int(0, 55); rows.push({ employee_id: e.id, work_date: d, status: 'P', check_in: `08:${String(m).padStart(2, '0')}`, check_out: `${rng.int(17, 18)}:${String(rng.int(0, 59)).padStart(2, '0')}`, note: m > 40 ? 'Late' : null }); }
    }
  }
  for (let i = 0; i < rows.length; i += 500) await sequelize.getQueryInterface().bulkInsert('attendance', rows.slice(i, i + 500));

  // payroll: closed months posted (the oldest also paid), current month left as a draft to demonstrate the run
  const admin = { id: 1, role: 'SUPER_ADMIN', email: 'superadmin@gasman-demo.local' } as any;
  const months: string[] = []; for (let m = 2; m >= 0; m--) { const d = new Date(NOW); d.setUTCMonth(d.getUTCMonth() - m, 1); months.push(d.toISOString().slice(0, 7)); }
  const firstWithData = start.slice(0, 7);
  for (const [i, p] of months.entries()) {
    if (p <= firstWithData) continue; // the ledger starts part-way through its first month: payroll begins with the next full month
    const run = await buildPayrollRun(admin, undefined, p);
    if (i < months.length - 1) {
      await sequelize.transaction(async (tx) => { await exec(`UPDATE payroll_runs SET status = 'APPROVED' WHERE id = :id`, { id: run.id }, tx); await postPayroll(run.id, admin, tx); });
      if (i < months.length - 2) { const bank = await q1<any>('SELECT id FROM banks ORDER BY id LIMIT 1'); await payPayroll(admin, undefined, run.id, 'BANK', bank.id); }
    }
  }
  c.log?.(`HR seed complete: ${emps.length} employees, ${rows.length} attendance rows`);
}

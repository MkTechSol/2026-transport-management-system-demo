import { q, q1, exec, sequelize } from '../db/sequelize';
import { badRequest, notFound, unprocessable } from '../lib/errors';
import type { AuthUser } from '../middleware/auth';
import { audit } from './audit';
import { registerApprovalHandler, requestApproval } from './approvals';
import { accountId, postVoucher } from './ledger';

const r2 = (n: number) => Math.round(n * 100) / 100;
const lastDay = (period: string) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const firstDay = (period: string) => `${period}-01`;
const today = () => new Date().toISOString().slice(0, 10);

/** Builds (or rebuilds) a DRAFT payroll run: basic + allowances + driver trip bonus − absence deduction. */
export async function buildPayrollRun(user: AuthUser, req: any, period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw badRequest('Use the month format YYYY-MM.', { fields: { period: 'Invalid month' } });
  if (period > today().slice(0, 7)) throw unprocessable('Payroll cannot be prepared for a future month.');
  return sequelize.transaction(async (tx) => {
    let run = await q1<any>('SELECT * FROM payroll_runs WHERE period = :p FOR UPDATE', { p: period }, tx);
    if (run && run.status !== 'DRAFT') throw unprocessable(`Payroll for ${period} is already ${run.status.toLowerCase()} and can no longer be rebuilt.`);
    if (!run) run = await q1<any>(`INSERT INTO payroll_runs (period, created_by) VALUES (:p, :u) RETURNING *`, { p: period, u: user.id }, tx);
    await exec('DELETE FROM payroll_lines WHERE run_id = :r', { r: run.id }, tx);
    const from = firstDay(period); const to = lastDay(period);
    const emps = await q<any>(`SELECT e.id, e.basic_salary::float AS basic, e.allowances::float AS allowances, e.trip_rate::float AS trip_rate, e.driver_id FROM employees e WHERE e.status = 'ACTIVE' AND e.joined_on <= :to ORDER BY e.id`, { to }, tx);
    let gross = 0; let ded = 0; let net = 0;
    for (const e of emps) {
      const att = await q1<any>(`SELECT count(*) FILTER (WHERE status = 'A')::float + 0.5 * count(*) FILTER (WHERE status = 'H')::float AS absent FROM attendance WHERE employee_id = :e AND work_date BETWEEN :f AND :t`, { e: e.id, f: from, t: to }, tx);
      const unpaid = await q1<any>(`SELECT COALESCE(sum(GREATEST(0, LEAST(to_date, :t::date) - GREATEST(from_date, :f::date) + 1)), 0)::float AS d FROM leave_requests WHERE employee_id = :e AND status = 'APPROVED' AND leave_type = 'UNPAID' AND from_date <= :t AND to_date >= :f`, { e: e.id, f: from, t: to }, tx);
      const trips = e.driver_id ? (await q1<any>(`SELECT count(*)::int AS n FROM trips WHERE driver_id = :d AND status = 'COMPLETED' AND (completed_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN :f AND :t`, { d: e.driver_id, f: from, t: to }, tx)).n : 0;
      const absent = r2(att.absent + unpaid.d);
      const bonus = r2(trips * e.trip_rate); const absDed = r2(e.basic / 30 * absent);
      const n = r2(e.basic + e.allowances + bonus - absDed);
      await exec(`INSERT INTO payroll_lines (run_id, employee_id, basic, allowances, trips, trip_bonus, absent_days, absence_deduction, net) VALUES (:r, :e, :b, :a, :t, :tb, :ad, :ded, :n)`,
        { r: run.id, e: e.id, b: e.basic, a: e.allowances, t: trips, tb: bonus, ad: absent, ded: absDed, n }, tx);
      gross += e.basic + e.allowances + bonus; ded += absDed; net += n;
    }
    run = await q1<any>('UPDATE payroll_runs SET gross = :g, deductions = :d, net = :n WHERE id = :id RETURNING *', { g: r2(gross), d: r2(ded), n: r2(net), id: run.id }, tx);
    await audit(req, { action: 'PAYROLL_BUILT', entityType: 'PAYROLL', entityId: run.id, entityLabel: `${period} · net PKR ${run.net}`, tx });
    return run;
  });
}

export async function submitPayroll(user: AuthUser, req: any, id: number) {
  return sequelize.transaction(async (tx) => {
    const run = await q1<any>('SELECT * FROM payroll_runs WHERE id = :id FOR UPDATE', { id }, tx);
    if (!run) throw notFound('Payroll run');
    if (run.status !== 'DRAFT') throw unprocessable(`This run is already ${run.status.toLowerCase()}.`);
    if (!(run.net > 0)) throw unprocessable('There is nothing to pay in this run. Rebuild it first.');
    await exec(`UPDATE payroll_runs SET status = 'PENDING' WHERE id = :id`, { id }, tx);
    await requestApproval({ entityType: 'PAYROLL', entityId: id, title: `Payroll ${run.period}`, amount: Math.round(run.net), requestedBy: user.id, tx });
    await audit(req, { action: 'PAYROLL_SUBMITTED', entityType: 'PAYROLL', entityId: id, entityLabel: run.period, tx });
  });
}

/** Posts the approved run to the ledger: salary & bonus expense against salaries payable. */
export async function postPayroll(id: number, user: AuthUser | null, tx: any) {
  const run = await q1<any>('SELECT * FROM payroll_runs WHERE id = :id FOR UPDATE', { id }, tx);
  if (!run || run.status === 'POSTED' || run.status === 'PAID') return;
  const t = await q1<any>(`SELECT COALESCE(sum(basic + allowances - absence_deduction), 0)::float AS sal, COALESCE(sum(trip_bonus), 0)::float AS bonus FROM payroll_lines WHERE run_id = :id`, { id }, tx);
  const date = lastDay(run.period) > today() ? today() : lastDay(run.period);
  const lines: any[] = [{ accountKey: 'exp_salaries', debit: r2(t.sal) }];
  if (t.bonus > 0) lines.push({ accountKey: 'exp_bonus', debit: r2(t.bonus) });
  lines.push({ accountKey: 'salaries_payable', credit: r2(t.sal + t.bonus) });
  const v = await postVoucher({ type: 'PAYROLL', date, narration: `Payroll ${run.period}`, lines, sourceType: 'PAYROLL', sourceId: id, user }, tx);
  await exec(`UPDATE payroll_runs SET status = 'POSTED', voucher_id = :v, net = :n WHERE id = :id`, { v: v.id, n: r2(t.sal + t.bonus), id }, tx);
}

export async function payPayroll(user: AuthUser, req: any, id: number, mode: 'BANK' | 'CASH', bankId?: number | null) {
  return sequelize.transaction(async (tx) => {
    const run = await q1<any>('SELECT * FROM payroll_runs WHERE id = :id FOR UPDATE', { id }, tx);
    if (!run) throw notFound('Payroll run');
    if (run.status !== 'POSTED') throw unprocessable(run.status === 'PAID' ? 'This payroll has already been paid.' : 'Payroll must be approved and posted before it can be paid.');
    let acct: number;
    if (mode === 'BANK') { const b = bankId ? await q1<any>('SELECT account_id FROM banks WHERE id = :id', { id: bankId }, tx) : null; if (!b) throw badRequest('Choose the bank account salaries are paid from.', { fields: { bankId: 'Required' } }); acct = b.account_id; } else acct = await accountId('cash', tx);
    const v = await postVoucher({ type: mode === 'BANK' ? 'BANK_PAYMENT' : 'CASH_PAYMENT', date: today(), narration: `Salaries paid — ${run.period}`, lines: [{ accountKey: 'salaries_payable', debit: run.net }, { accountId: acct, credit: run.net }], sourceType: 'PAYROLL_PAY', sourceId: id, user }, tx);
    await exec(`UPDATE payroll_runs SET status = 'PAID', paid_voucher_id = :v WHERE id = :id`, { v: v.id, id }, tx);
    await audit(req, { action: 'PAYROLL_PAID', entityType: 'PAYROLL', entityId: id, entityLabel: `${run.period} · PKR ${run.net}`, tx });
  });
}

registerApprovalHandler('PAYROLL', {
  async onApproved(id, { tx, user }) { await exec(`UPDATE payroll_runs SET status = 'APPROVED' WHERE id = :id`, { id }, tx); await postPayroll(id, user, tx); },
  async onRejected(id, { tx }) { await exec(`UPDATE payroll_runs SET status = 'DRAFT' WHERE id = :id AND status = 'PENDING'`, { id }, tx); },
});

registerApprovalHandler('LEAVE', {
  async onApproved(id, { tx, user }) {
    const l = await q1<any>(`UPDATE leave_requests SET status = 'APPROVED', decided_by = :u, decided_at = now() WHERE id = :id RETURNING *`, { u: user.id, id }, tx);
    // mark the leave days on the attendance sheet (weekly off days are left alone)
    await exec(`INSERT INTO attendance (employee_id, work_date, status, note) SELECT :e, d::date, 'L', :n FROM generate_series(:f::date, :t::date, interval '1 day') d WHERE extract(dow FROM d) <> 0
                ON CONFLICT (employee_id, work_date) DO UPDATE SET status = 'L', note = EXCLUDED.note, check_in = NULL, check_out = NULL`, { e: l.employee_id, f: l.from_date, t: l.to_date, n: `${l.leave_type.toLowerCase()} leave` }, tx);
  },
  async onRejected(id, { tx, user, note }) { await exec(`UPDATE leave_requests SET status = 'REJECTED', decided_by = :u, decided_at = now(), decision_note = :n WHERE id = :id`, { u: user.id, n: note ?? null, id }, tx); },
});

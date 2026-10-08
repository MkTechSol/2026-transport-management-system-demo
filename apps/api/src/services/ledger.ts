import { q, q1, exec, sequelize } from '../db/sequelize';
import { badRequest, notFound, unprocessable } from '../lib/errors';
import type { AuthUser } from '../middleware/auth';

export type PartyType = 'CUSTOMER' | 'VENDOR' | 'EMPLOYEE' | 'OWNER';
export interface LineInput { accountId?: number; accountKey?: string; debit?: number; credit?: number; vehicleId?: number | null; partyType?: PartyType | null; partyId?: number | null; tripId?: number | null; memo?: string }
export interface VoucherInput {
  type: string; date?: string; narration?: string; lines: LineInput[]; vehicleId?: number | null; partyType?: PartyType | null; partyId?: number | null; tripId?: number | null;
  sourceType?: string; sourceId?: number; user?: AuthUser | null;
}

export const VOUCHER_PREFIX: Record<string, string> = {
  CASH_PAYMENT: 'CPV', CASH_RECEIPT: 'CRV', BANK_PAYMENT: 'BPV', BANK_RECEIVE: 'BRV', JOURNAL: 'JV', BOWZER_EXPENSE: 'BEV', SALE_INVOICE: 'INV', SALE_RETURN: 'SRV',
  PURCHASE: 'PUR', PURCHASE_RETURN: 'PRV', PAYROLL: 'PAY', TRIP_EXPENSE: 'TEV', TRIP_FREIGHT: 'TFV', STOCK: 'STV', OPENING: 'OPV',
};
export const VOUCHER_LABELS: Record<string, string> = {
  CASH_PAYMENT: 'Cash payment', CASH_RECEIPT: 'Cash receipt', BANK_PAYMENT: 'Bank payment', BANK_RECEIVE: 'Bank receive', JOURNAL: 'Journal voucher', BOWZER_EXPENSE: 'Bowzer expense',
  SALE_INVOICE: 'Sale invoice', SALE_RETURN: 'Sale return', PURCHASE: 'Purchase', PURCHASE_RETURN: 'Purchase return', PAYROLL: 'Payroll', TRIP_EXPENSE: 'Trip expense', TRIP_FREIGHT: 'Trip freight', STOCK: 'Stock voucher', OPENING: 'Opening balance',
};

const keyCache = new Map<string, number>();
export async function accountId(key: string, tx?: any): Promise<number> {
  const hit = keyCache.get(key); if (hit) return hit;
  const a = await q1<{ id: number }>('SELECT id FROM accounts WHERE system_key = :k', { k: key }, tx);
  if (!a) throw new Error(`System account '${key}' is missing`);
  keyCache.set(key, a.id); return a.id;
}

export async function fiscalYearFor(date: string, tx?: any) {
  const fy = await q1<any>('SELECT * FROM fiscal_years WHERE :d BETWEEN starts_on AND ends_on', { d: date }, tx);
  if (!fy) throw unprocessable(`No fiscal year covers ${date}. Add one under Setup → Fiscal years.`);
  if (fy.status === 'CLOSED') throw unprocessable(`Fiscal year ${fy.label} is closed; vouchers cannot be posted into it.`);
  return fy;
}

async function nextNo(type: string, fyId: number, fyLabel: string, tx: any) {
  const prefix = VOUCHER_PREFIX[type] ?? 'VCH';
  const r = await q1<{ last_no: number }>(
    `INSERT INTO voucher_counters (prefix, fiscal_year_id, last_no) VALUES (:p, :fy, 1)
     ON CONFLICT (prefix, fiscal_year_id) DO UPDATE SET last_no = voucher_counters.last_no + 1 RETURNING last_no`, { p: prefix, fy: fyId }, tx);
  return `${prefix}-${fyLabel.slice(2, 4)}${fyLabel.slice(-2)}-${String(r!.last_no).padStart(5, '0')}`;
}

/** Keeps the running balance tables in step with posted/voided vouchers (sign +1 to apply, -1 to reverse). */
export async function applyBalances(voucherId: number, sign: 1 | -1, tx: any) {
  await exec(`INSERT INTO account_balances (account_id, debit, credit) SELECT account_id, sum(debit) * :s, sum(credit) * :s FROM voucher_lines WHERE voucher_id = :v GROUP BY account_id
              ON CONFLICT (account_id) DO UPDATE SET debit = account_balances.debit + EXCLUDED.debit, credit = account_balances.credit + EXCLUDED.credit`, { v: voucherId, s: sign }, tx);
  await exec(`INSERT INTO party_balances (party_type, party_id, account_id, debit, credit) SELECT party_type, party_id, account_id, sum(debit) * :s, sum(credit) * :s FROM voucher_lines WHERE voucher_id = :v AND party_id IS NOT NULL GROUP BY party_type, party_id, account_id
              ON CONFLICT (party_type, party_id, account_id) DO UPDATE SET debit = party_balances.debit + EXCLUDED.debit, credit = party_balances.credit + EXCLUDED.credit`, { v: voucherId, s: sign }, tx);
}

/** Posts a balanced voucher. Must run inside (or creates) a transaction so all lines commit together. */
export async function postVoucher(input: VoucherInput, tx?: any): Promise<any> {
  if (!tx) return sequelize.transaction((t) => postVoucher(input, t));
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const fy = await fiscalYearFor(date, tx);
  if (!input.lines.length) throw badRequest('A voucher needs at least two lines.');
  const resolved: any[] = [];
  for (const l of input.lines) {
    const id = l.accountId ?? (l.accountKey ? await accountId(l.accountKey, tx) : undefined);
    if (!id) throw badRequest('Every line needs an account.');
    const debit = Math.round((l.debit ?? 0) * 100) / 100; const credit = Math.round((l.credit ?? 0) * 100) / 100;
    if (debit < 0 || credit < 0 || (debit > 0 && credit > 0) || (debit === 0 && credit === 0)) throw badRequest('Each line must have either a debit or a credit amount greater than zero.');
    resolved.push({ ...l, accountId: id, debit, credit });
  }
  const accs = await q<any>('SELECT id, code, name, postable, active FROM accounts WHERE id IN (:ids)', { ids: [...new Set(resolved.map((l) => l.accountId))] }, tx);
  const am = new Map(accs.map((a: any) => [a.id, a]));
  for (const l of resolved) {
    const a = am.get(l.accountId); if (!a) throw notFound('Account');
    if (!a.postable || !a.active) throw unprocessable(`Account ${a.code} ${a.name} is a heading or inactive and cannot be posted to.`);
  }
  const d = resolved.reduce((s, l) => s + l.debit, 0); const c = resolved.reduce((s, l) => s + l.credit, 0);
  if (Math.round((d - c) * 100) !== 0) throw unprocessable(`Voucher does not balance: debit ${d.toFixed(2)} vs credit ${c.toFixed(2)}.`);
  const no = await nextNo(input.type, fy.id, fy.label, tx);
  const v = await q1<any>(
    `INSERT INTO vouchers (voucher_no, type, voucher_date, fiscal_year_id, narration, total, vehicle_id, party_type, party_id, trip_id, source_type, source_id, created_by)
     VALUES (:no, :type, :date, :fy, :nar, :tot, :veh, :pt, :pid, :trip, :st, :sid, :u) RETURNING *`,
    { no, type: input.type, date, fy: fy.id, nar: input.narration ?? null, tot: d, veh: input.vehicleId ?? null, pt: input.partyType ?? null, pid: input.partyId ?? null, trip: input.tripId ?? null, st: input.sourceType ?? null, sid: input.sourceId ?? null, u: input.user?.id ?? null }, tx);
  let n = 1;
  for (const l of resolved) {
    await exec(
      `INSERT INTO voucher_lines (voucher_id, line_no, account_id, debit, credit, vehicle_id, party_type, party_id, trip_id, memo)
       VALUES (:v, :n, :a, :d, :c, :veh, :pt, :pid, :trip, :m)`,
      { v: v.id, n: n++, a: l.accountId, d: l.debit, c: l.credit, veh: l.vehicleId ?? input.vehicleId ?? null, pt: l.partyType ?? null, pid: l.partyId ?? null, trip: l.tripId ?? input.tripId ?? null, m: l.memo ?? null }, tx);
  }
  await applyBalances(v.id, 1, tx);
  return v;
}

export async function voidVoucher(user: AuthUser, id: number, reason: string, tx?: any): Promise<any> {
  if (!tx) return sequelize.transaction((t) => voidVoucher(user, id, reason, t));
  const v = await q1<any>('SELECT * FROM vouchers WHERE id = :id FOR UPDATE', { id }, tx);
  if (!v) throw notFound('Voucher');
  if (v.status === 'VOID') throw unprocessable('This voucher is already void.');
  await fiscalYearFor(v.voucher_date, tx);
  if (v.source_type === 'INVOICE') throw unprocessable('Invoice vouchers are voided from the invoice screen.');
  const alloc = await q1<{ n: number }>('SELECT count(*)::int AS n FROM voucher_allocations WHERE voucher_id = :id', { id }, tx);
  if (alloc!.n) {
    const rows = await q<any>('SELECT invoice_id, amount FROM voucher_allocations WHERE voucher_id = :id', { id }, tx);
    for (const r of rows) await exec(`UPDATE sales_invoices SET paid = paid - :a, status = CASE WHEN paid - :a <= 0 THEN 'UNPAID' ELSE 'PARTIAL' END WHERE id = :i`, { a: r.amount, i: r.invoice_id }, tx);
    await exec('DELETE FROM voucher_allocations WHERE voucher_id = :id', { id }, tx);
  }
  await exec(`UPDATE vouchers SET status = 'VOID', void_reason = :r WHERE id = :id`, { r: reason, id }, tx);
  await applyBalances(id, -1, tx);
  if (v.source_type === 'TRIP_EXPENSE') await exec(`UPDATE trip_expenses SET voucher_id = NULL WHERE id = :s`, { s: v.source_id }, tx);
  return v;
}

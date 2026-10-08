import { Router } from 'express';
import { z } from 'zod';
import { q, q1, exec } from '../db/sequelize';
import { badRequest, conflict, notFound } from '../lib/errors';
import { id, likeTerm, listResponse, paging, parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';
import { accountId, postVoucher, voidVoucher, VOUCHER_LABELS } from '../services/ledger';

export const financeRouter = Router();
const today = () => new Date().toISOString().slice(0, 10);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// ---------- Chart of accounts ----------
financeRouter.get('/accounts', requirePerm('finance:view'), wrap(async (req, res) => {
  const withBalance = req.query.balances === '1';
  const rows = await q(
    `SELECT a.*, p.name AS parent_name ${withBalance ? `, COALESCE(b.bal, 0)::float AS balance` : ''}
       FROM accounts a LEFT JOIN accounts p ON p.id = a.parent_id
       ${withBalance ? `LEFT JOIN (SELECT l.account_id, sum(l.debit - l.credit) AS bal FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED' GROUP BY 1) b ON b.account_id = a.id` : ''}
      ORDER BY a.code`);
  res.json({ data: rows });
}));
const accountBody = z.object({ code: z.string().trim().min(2).max(20), name: z.string().trim().min(2).max(120), parentId: z.coerce.number().int().positive(), postable: z.boolean().default(true) });
financeRouter.post('/accounts', requirePerm('finance:post'), wrap(async (req, res) => {
  const b = parse(accountBody, req.body);
  const parent = await q1<any>('SELECT id, type, level FROM accounts WHERE id = :id', { id: b.parentId });
  if (!parent) throw notFound('Parent account');
  if (await q1('SELECT 1 FROM accounts WHERE code = :c', { c: b.code })) throw conflict(`Account code ${b.code} already exists.`, { fields: { code: 'Already used' } });
  const row = await q1<any>(`INSERT INTO accounts (code, name, type, parent_id, level, postable) VALUES (:c, :n, :t, :p, :l, :pp) RETURNING *`, { c: b.code, n: b.name, t: parent.type, p: parent.id, l: parent.level + 1, pp: b.postable });
  await audit(req, { action: 'ACCOUNT_CREATED', entityType: 'ACCOUNT', entityId: row.id, entityLabel: `${row.code} ${row.name}` });
  res.status(201).json({ account: row });
}));
financeRouter.patch('/accounts/:id', requirePerm('finance:post'), wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(120).optional(), active: z.boolean().optional() }), req.body);
  const row = await q1<any>(`UPDATE accounts SET name = COALESCE(:n, name), active = COALESCE(:a, active) WHERE id = :id RETURNING *`, { n: b.name ?? null, a: b.active ?? null, id: id(req) });
  if (!row) throw notFound('Account');
  await audit(req, { action: 'ACCOUNT_UPDATED', entityType: 'ACCOUNT', entityId: row.id, entityLabel: `${row.code} ${row.name}` });
  res.json({ account: row });
}));

// ---------- Banks & fiscal years ----------
financeRouter.get('/banks', requirePerm('finance:view'), wrap(async (_req, res) => {
  res.json({ data: await q(`SELECT b.*, a.code AS account_code, COALESCE(x.bal, 0)::float AS balance FROM banks b JOIN accounts a ON a.id = b.account_id
    LEFT JOIN (SELECT l.account_id, sum(l.debit - l.credit) AS bal FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED' GROUP BY 1) x ON x.account_id = b.account_id ORDER BY b.name`) });
}));
financeRouter.post('/banks', requirePerm('finance:post'), wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(120), branch: z.string().trim().max(120).optional(), accountNo: z.string().trim().max(40).optional() }), req.body);
  const parent = await accountId('bank_control');
  const par = await q1<any>('SELECT id, level FROM accounts WHERE id = :p', { p: parent });
  const n = await q1<{ n: number }>(`SELECT count(*)::int + 1 AS n FROM accounts WHERE parent_id = :p`, { p: parent });
  const acc = await q1<any>(`INSERT INTO accounts (code, name, type, parent_id, level, postable) VALUES (:c, :n, 'ASSET', :p, :l, true) RETURNING id`, { c: `1120-${String(n!.n).padStart(2, '0')}`, n: `Bank — ${b.name}`, p: par.id, l: par.level + 1 });
  const bank = await q1<any>(`INSERT INTO banks (name, branch, account_no, account_id) VALUES (:n, :br, :no, :a) RETURNING *`, { n: b.name, br: b.branch ?? null, no: b.accountNo ?? null, a: acc.id });
  // the control account becomes a heading once it has children
  await exec('UPDATE accounts SET postable = false WHERE id = :p', { p: parent });
  await audit(req, { action: 'BANK_CREATED', entityType: 'BANK', entityId: bank.id, entityLabel: b.name });
  res.status(201).json({ bank });
}));
financeRouter.get('/fiscal-years', requirePerm('finance:view'), wrap(async (_req, res) => res.json({ data: await q('SELECT * FROM fiscal_years ORDER BY starts_on DESC') })));
financeRouter.post('/fiscal-years', requirePerm('finance:post'), wrap(async (req, res) => {
  const b = parse(z.object({ label: z.string().trim().min(4).max(20), startsOn: dateStr, endsOn: dateStr }), req.body);
  if (b.endsOn <= b.startsOn) throw badRequest('End date must be after the start date.', { fields: { endsOn: 'Must be after start' } });
  const overlap = await q1('SELECT 1 FROM fiscal_years WHERE starts_on <= :e AND ends_on >= :s', { s: b.startsOn, e: b.endsOn });
  if (overlap) throw conflict('That period overlaps an existing fiscal year.');
  res.status(201).json({ fiscalYear: await q1(`INSERT INTO fiscal_years (label, starts_on, ends_on) VALUES (:l, :s, :e) RETURNING *`, { l: b.label, s: b.startsOn, e: b.endsOn }) });
}));
financeRouter.post('/fiscal-years/:id/close', requirePerm('finance:post'), wrap(async (req, res) => {
  const row = await q1<any>(`UPDATE fiscal_years SET status = 'CLOSED' WHERE id = :id RETURNING *`, { id: id(req) });
  if (!row) throw notFound('Fiscal year');
  await audit(req, { action: 'FISCAL_YEAR_CLOSED', entityType: 'FISCAL_YEAR', entityId: row.id, entityLabel: row.label });
  res.json({ fiscalYear: row });
}));

// ---------- Vouchers ----------
financeRouter.get('/vouchers', requirePerm('finance:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ type: z.string().optional(), from: dateStr.optional(), to: dateStr.optional(), vehicleId: z.coerce.number().optional(), partyId: z.coerce.number().optional(), partyType: z.string().optional(), status: z.string().optional() }), req.query);
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (f.type) { where.push('v.type IN (:types)'); r.types = f.type.split(','); }
  if (f.from) { where.push('v.voucher_date >= :from'); r.from = f.from; }
  if (f.to) { where.push('v.voucher_date <= :to'); r.to = f.to; }
  if (f.vehicleId) { where.push('EXISTS (SELECT 1 FROM voucher_lines l WHERE l.voucher_id = v.id AND l.vehicle_id = :veh)'); r.veh = f.vehicleId; }
  if (f.partyId) { where.push('EXISTS (SELECT 1 FROM voucher_lines l WHERE l.voucher_id = v.id AND l.party_id = :pid AND l.party_type = :pt)'); r.pid = f.partyId; r.pt = f.partyType ?? 'CUSTOMER'; }
  if (f.status) { where.push('v.status = :st'); r.st = f.status; }
  if (p.q) { where.push('(v.voucher_no ILIKE :q OR v.narration ILIKE :q)'); r.q = likeTerm(p.q); }
  const w = where.join(' AND ');
  const [rows, [{ total }]] = await Promise.all([
    q(`SELECT v.*, u.full_name AS created_by_name, ve.code AS vehicle_code FROM vouchers v LEFT JOIN users u ON u.id = v.created_by LEFT JOIN vehicles ve ON ve.id = v.vehicle_id
        WHERE ${w} ORDER BY v.voucher_date DESC, v.id DESC LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total FROM vouchers v WHERE ${w}`, r),
  ]);
  res.json({ ...listResponse(rows, total, p.page, p.pageSize), labels: VOUCHER_LABELS });
}));

financeRouter.get('/vouchers/:id', requirePerm('finance:view'), wrap(async (req, res) => {
  const v = await q1<any>(`SELECT v.*, u.full_name AS created_by_name, t.code AS trip_code, ve.code AS vehicle_code FROM vouchers v LEFT JOIN users u ON u.id = v.created_by LEFT JOIN trips t ON t.id = v.trip_id LEFT JOIN vehicles ve ON ve.id = v.vehicle_id WHERE v.id = :id`, { id: id(req) });
  if (!v) throw notFound('Voucher');
  const lines = await q(`SELECT l.*, a.code AS account_code, a.name AS account_name, ve.code AS vehicle_code, t.code AS trip_code,
      CASE l.party_type WHEN 'CUSTOMER' THEN (SELECT name FROM distributors WHERE id = l.party_id) WHEN 'VENDOR' THEN (SELECT name FROM vendors WHERE id = l.party_id) END AS party_name
    FROM voucher_lines l JOIN accounts a ON a.id = l.account_id LEFT JOIN vehicles ve ON ve.id = l.vehicle_id LEFT JOIN trips t ON t.id = l.trip_id WHERE l.voucher_id = :id ORDER BY l.line_no`, { id: v.id });
  const allocations = await q(`SELECT al.amount, i.invoice_no, i.id AS invoice_id FROM voucher_allocations al JOIN sales_invoices i ON i.id = al.invoice_id WHERE al.voucher_id = :id`, { id: v.id });
  res.json({ voucher: v, lines, allocations, label: VOUCHER_LABELS[v.type] });
}));

const lineBody = z.object({ accountId: z.coerce.number().int().positive(), amount: z.coerce.number().positive().optional(), debit: z.coerce.number().min(0).optional(), credit: z.coerce.number().min(0).optional(),
  vehicleId: z.coerce.number().int().positive().nullish(), partyType: z.enum(['CUSTOMER', 'VENDOR', 'EMPLOYEE', 'OWNER']).nullish(), partyId: z.coerce.number().int().positive().nullish(), tripId: z.coerce.number().int().positive().nullish(), memo: z.string().max(250).optional() });
const voucherBody = z.object({
  type: z.enum(['CASH_PAYMENT', 'CASH_RECEIPT', 'BANK_PAYMENT', 'BANK_RECEIVE', 'JOURNAL', 'BOWZER_EXPENSE']),
  date: dateStr.optional(), narration: z.string().trim().max(300).optional(), bankId: z.coerce.number().int().positive().optional(),
  vehicleId: z.coerce.number().int().positive().nullish(), lines: z.array(lineBody).min(1).max(60),
});
financeRouter.post('/vouchers', requirePerm('finance:post'), wrap(async (req, res) => {
  const b = parse(voucherBody, req.body);
  let lines: any[]; let tp: string = b.type;
  if (b.type === 'JOURNAL') {
    if (b.lines.length < 2) throw badRequest('A journal voucher needs at least two lines.');
    lines = b.lines.map((l) => ({ ...l }));
  } else {
    // Single-sided entry: the cash/bank account is the balancing side.
    const isBank = b.type.startsWith('BANK'); const isPay = b.type.endsWith('PAYMENT') || b.type === 'BOWZER_EXPENSE';
    let cashAcc: number;
    if (isBank) { if (!b.bankId) throw badRequest('Choose the bank account.', { fields: { bankId: 'Required' } }); const bk = await q1<any>('SELECT account_id FROM banks WHERE id = :id', { id: b.bankId }); if (!bk) throw notFound('Bank'); cashAcc = bk.account_id; }
    else cashAcc = await accountId('cash');
    if (b.type === 'BOWZER_EXPENSE' && !b.vehicleId && !b.lines.every((l) => l.vehicleId)) throw badRequest('Choose the bowzer this expense belongs to.', { fields: { vehicleId: 'Required' } });
    const total = b.lines.reduce((s, l) => s + (l.amount ?? 0), 0);
    if (!(total > 0)) throw badRequest('Enter an amount on every line.');
    lines = b.lines.map((l) => ({ ...l, [isPay ? 'debit' : 'credit']: l.amount }));
    lines.push({ accountId: cashAcc, [isPay ? 'credit' : 'debit']: Math.round(total * 100) / 100, vehicleId: b.vehicleId ?? null });
    if (b.type === 'BOWZER_EXPENSE') tp = 'BOWZER_EXPENSE';
  }
  const v = await postVoucher({ type: tp, date: b.date, narration: b.narration, lines, vehicleId: b.vehicleId ?? null, user: req.user }); 
  await audit(req, { action: 'VOUCHER_POSTED', entityType: 'VOUCHER', entityId: v.id, entityLabel: `${v.voucher_no} · PKR ${v.total}` });
  res.status(201).json({ voucher: v });
}));

financeRouter.post('/vouchers/:id/void', requirePerm('finance:post'), wrap(async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters).').max(250) }), req.body);
  const v = await voidVoucher(req.user!, id(req), b.reason);
  await audit(req, { action: 'VOUCHER_VOIDED', entityType: 'VOUCHER', entityId: v.id, entityLabel: `${v.voucher_no}: ${b.reason}` });
  res.json({ ok: true });
}));

// ---------- Reports (generic tabular shape: columns, rows, totals) ----------
type Col = { key: string; label: string; type?: 'money' | 'date' | 'num' | 'text' | 'pct'; };
interface Report { title: string; subtitle?: string; columns: Col[]; rows: any[]; totals?: Record<string, number | string>; }
type Params = { from: string; to: string; asOf: string; accountId?: number; vehicleId?: number; partyType?: string; partyId?: number; bankId?: number };
const POSTED = `JOIN vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED'`;

const fyStart = async () => (await q1<any>(`SELECT starts_on FROM fiscal_years WHERE CURRENT_DATE BETWEEN starts_on AND ends_on`))?.starts_on ?? `${today().slice(0, 4)}-01-01`;
const money: Col = { key: '', label: '', type: 'money' };
const sum = (rows: any[], key: string) => Math.round(rows.reduce((s, r) => s + Number(r[key] ?? 0), 0) * 100) / 100;

const REPORTS: Record<string, { title: string; run: (p: Params) => Promise<Report> }> = {
  'trial-balance': { title: 'Trial balance', run: async (p) => {
    const rows = await q(`SELECT a.code, a.name, a.type,
        COALESCE(sum(l.debit - l.credit) FILTER (WHERE v.voucher_date < :from), 0)::float AS opening,
        COALESCE(sum(l.debit) FILTER (WHERE v.voucher_date BETWEEN :from AND :to), 0)::float AS debit,
        COALESCE(sum(l.credit) FILTER (WHERE v.voucher_date BETWEEN :from AND :to), 0)::float AS credit,
        COALESCE(sum(l.debit - l.credit) FILTER (WHERE v.voucher_date <= :to), 0)::float AS closing
      FROM accounts a JOIN voucher_lines l ON l.account_id = a.id ${POSTED} GROUP BY a.id HAVING sum(l.debit) + sum(l.credit) > 0 ORDER BY a.code`, p);
    const out = rows.map((r: any) => ({ ...r, closing_dr: r.closing > 0 ? r.closing : 0, closing_cr: r.closing < 0 ? -r.closing : 0 }));
    return { title: 'Trial balance', subtitle: `${p.from} to ${p.to}`, columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'opening', label: 'Opening (Dr+/Cr−)', type: 'money' }, { key: 'debit', label: 'Debit', type: 'money' }, { key: 'credit', label: 'Credit', type: 'money' }, { key: 'closing_dr', label: 'Closing Dr', type: 'money' }, { key: 'closing_cr', label: 'Closing Cr', type: 'money' }],
      rows: out, totals: { debit: sum(out, 'debit'), credit: sum(out, 'credit'), closing_dr: sum(out, 'closing_dr'), closing_cr: sum(out, 'closing_cr'), opening: sum(out, 'opening') } };
  } },
  'ledger': { title: 'Account ledger', run: async (p) => {
    if (!p.accountId && !p.vehicleId && !p.partyId) throw badRequest('Choose an account, bowzer or party for the ledger.');
    const cond: string[] = []; const r: any = { ...p };
    if (p.accountId) cond.push('l.account_id = :accountId');
    if (p.vehicleId) cond.push('l.vehicle_id = :vehicleId');
    if (p.partyId) { cond.push(`l.party_id = :partyId AND l.party_type = :pt`); r.pt = p.partyType ?? 'CUSTOMER'; if (!p.accountId) cond.push(`l.account_id IN (SELECT id FROM accounts WHERE system_key IN ('receivable','payable','advances','salaries_payable'))`); }
    const c = cond.join(' AND ');
    const [{ opening }] = await q(`SELECT COALESCE(sum(l.debit - l.credit), 0)::float AS opening FROM voucher_lines l ${POSTED} WHERE ${c} AND v.voucher_date < :from`, r);
    const lines = await q(`SELECT v.voucher_date AS date, v.voucher_no, v.id AS voucher_id, a.code || ' ' || a.name AS account, COALESCE(ve.code, '') AS vehicle, COALESCE(l.memo, v.narration) AS narration, l.debit::float AS debit, l.credit::float AS credit
        FROM voucher_lines l ${POSTED} JOIN accounts a ON a.id = l.account_id LEFT JOIN vehicles ve ON ve.id = l.vehicle_id WHERE ${c} AND v.voucher_date BETWEEN :from AND :to ORDER BY v.voucher_date, v.id, l.line_no`, r);
    let bal = opening;
    const rows: any[] = [{ date: p.from, voucher_no: '', account: '', vehicle: '', narration: 'Opening balance', debit: opening > 0 ? opening : 0, credit: opening < 0 ? -opening : 0, balance: opening, opening: true }];
    for (const l of lines) { bal = Math.round((bal + l.debit - l.credit) * 100) / 100; rows.push({ ...l, balance: bal }); }
    const label = p.accountId ? (await q1<any>('SELECT code || \' \' || name AS n FROM accounts WHERE id = :a', { a: p.accountId }))?.n : p.vehicleId ? `Bowzer ${(await q1<any>('SELECT code FROM vehicles WHERE id = :v', { v: p.vehicleId }))?.code}` : 'Party ledger';
    return { title: `Ledger — ${label}`, subtitle: `${p.from} to ${p.to}`, columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'voucher_no', label: 'Voucher' }, { key: 'account', label: 'Account' }, { key: 'vehicle', label: 'Bowzer' }, { key: 'narration', label: 'Narration' }, { key: 'debit', label: 'Debit', type: 'money' }, { key: 'credit', label: 'Credit', type: 'money' }, { key: 'balance', label: 'Balance (Dr+/Cr−)', type: 'money' }],
      rows, totals: { debit: sum(lines, 'debit'), credit: sum(lines, 'credit'), balance: bal } };
  } },
  'daybook': { title: 'Day book', run: async (p) => {
    const rows = await q(`SELECT v.voucher_date AS date, v.id AS voucher_id, v.voucher_no, v.type, COALESCE(v.narration, '') AS narration, COALESCE(ve.code, '') AS vehicle, v.total::float AS amount, v.status
        FROM vouchers v LEFT JOIN vehicles ve ON ve.id = v.vehicle_id WHERE v.voucher_date BETWEEN :from AND :to ORDER BY v.voucher_date, v.id`, p);
    const out = rows.map((r: any) => ({ ...r, type: VOUCHER_LABELS[r.type] ?? r.type }));
    return { title: 'Day book', subtitle: `${p.from} to ${p.to}`, columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'voucher_no', label: 'Voucher' }, { key: 'type', label: 'Type' }, { key: 'narration', label: 'Narration' }, { key: 'vehicle', label: 'Bowzer' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'status', label: 'Status' }], rows: out, totals: { amount: sum(out.filter((r: any) => r.status === 'POSTED'), 'amount') } };
  } },
  'cash-book': { title: 'Cash book', run: async (p) => REPORTS.ledger.run({ ...p, accountId: await accountId('cash') }).then((r) => ({ ...r, title: 'Cash book' })) },
  'bank-balances': { title: 'Bank balances', run: async (p) => {
    const rows = await q(`SELECT b.name, b.branch, b.account_no, COALESCE(sum(l.debit - l.credit), 0)::float AS balance FROM banks b LEFT JOIN voucher_lines l ON l.account_id = b.account_id LEFT JOIN vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED' AND v.voucher_date <= :asOf GROUP BY b.id ORDER BY b.name`, p);
    return { title: 'Bank balances', subtitle: `As of ${p.asOf}`, columns: [{ key: 'name', label: 'Bank' }, { key: 'branch', label: 'Branch' }, { key: 'account_no', label: 'Account no.' }, { key: 'balance', label: 'Balance', type: 'money' }], rows, totals: { balance: sum(rows, 'balance') } };
  } },
  'profit-loss': { title: 'Profit & loss', run: async (p) => {
    const rows = await q(`SELECT a.code, a.name, a.type, COALESCE(sum(l.credit - l.debit), 0)::float AS net FROM accounts a JOIN voucher_lines l ON l.account_id = a.id ${POSTED}
        WHERE a.type IN ('INCOME','EXPENSE') AND v.voucher_date BETWEEN :from AND :to ${p.vehicleId ? 'AND l.vehicle_id = :vehicleId' : ''} GROUP BY a.id ORDER BY a.code`, p);
    const inc = rows.filter((r: any) => r.type === 'INCOME').map((r: any) => ({ ...r, amount: r.net, section: 'Income' }));
    const exp = rows.filter((r: any) => r.type === 'EXPENSE').map((r: any) => ({ ...r, amount: -r.net, section: 'Expenses' }));
    const ti = sum(inc, 'amount'); const te = sum(exp, 'amount');
    return { title: 'Profit & loss', subtitle: `${p.from} to ${p.to}${p.vehicleId ? ' · single bowzer' : ''}`, columns: [{ key: 'section', label: 'Section' }, { key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'amount', label: 'Amount (PKR)', type: 'money' }],
      rows: [...inc, { section: 'Income', code: '', name: 'Total income', amount: ti, bold: true }, ...exp, { section: 'Expenses', code: '', name: 'Total expenses', amount: te, bold: true }, { section: 'Result', code: '', name: ti - te >= 0 ? 'Net profit' : 'Net loss', amount: Math.round((ti - te) * 100) / 100, bold: true }] };
  } },
  'balance-sheet': { title: 'Balance sheet', run: async (p) => {
    const rows = await q(`SELECT a.code, a.name, a.type, COALESCE(sum(l.debit - l.credit), 0)::float AS bal FROM accounts a JOIN voucher_lines l ON l.account_id = a.id ${POSTED} WHERE v.voucher_date <= :asOf GROUP BY a.id ORDER BY a.code`, p);
    const pick = (t: string, sign: 1 | -1) => rows.filter((r: any) => r.type === t && Math.abs(r.bal) > 0.004).map((r: any) => ({ section: t === 'ASSET' ? 'Assets' : t === 'LIABILITY' ? 'Liabilities' : 'Equity', code: r.code, name: r.name, amount: Math.round(r.bal * sign * 100) / 100 }));
    const assets = pick('ASSET', 1); const liab = pick('LIABILITY', -1); const eq = pick('EQUITY', -1);
    const earnings = Math.round(-rows.filter((r: any) => r.type === 'INCOME' || r.type === 'EXPENSE').reduce((s: number, r: any) => s + r.bal, 0) * 100) / 100;
    const ta = sum(assets, 'amount'); const tl = sum(liab, 'amount'); const te = sum(eq, 'amount') + earnings;
    return { title: 'Balance sheet', subtitle: `As of ${p.asOf}`, columns: [{ key: 'section', label: 'Section' }, { key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'amount', label: 'Amount (PKR)', type: 'money' }],
      rows: [...assets, { section: 'Assets', code: '', name: 'Total assets', amount: ta, bold: true }, ...liab, { section: 'Liabilities', code: '', name: 'Total liabilities', amount: tl, bold: true }, ...eq, { section: 'Equity', code: '', name: 'Profit & loss to date', amount: earnings }, { section: 'Equity', code: '', name: 'Total equity', amount: te, bold: true }, { section: 'Check', code: '', name: 'Liabilities + equity − assets (must be 0)', amount: Math.round((tl + te - ta) * 100) / 100, bold: true }] };
  } },
  'expense-report': { title: 'Expense report', run: async (p) => {
    const rows = await q(`SELECT a.code, a.name, COALESCE(sum(l.debit - l.credit), 0)::float AS amount, count(DISTINCT v.id)::int AS vouchers FROM accounts a JOIN voucher_lines l ON l.account_id = a.id ${POSTED}
        WHERE a.type = 'EXPENSE' AND v.voucher_date BETWEEN :from AND :to ${p.vehicleId ? 'AND l.vehicle_id = :vehicleId' : ''} GROUP BY a.id HAVING sum(l.debit - l.credit) <> 0 ORDER BY amount DESC`, p);
    return { title: 'Expense report', subtitle: `${p.from} to ${p.to}`, columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Expense head' }, { key: 'vouchers', label: 'Vouchers', type: 'num' }, { key: 'amount', label: 'Amount', type: 'money' }], rows, totals: { amount: sum(rows, 'amount') } };
  } },
  'bowzer-pnl': { title: 'Bowzer profit & loss', run: async (p) => {
    const rows = await q(`SELECT ve.code, COALESCE(ve.owner_name, '—') AS owner,
        COALESCE(sum(l.credit - l.debit) FILTER (WHERE a.type = 'INCOME'), 0)::float AS income,
        COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.system_key = 'exp_FUEL'), 0)::float AS fuel,
        COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.type = 'EXPENSE' AND a.system_key <> 'exp_FUEL'), 0)::float AS other_exp,
        count(DISTINCT l.trip_id) FILTER (WHERE a.type = 'INCOME')::int AS trips
      FROM voucher_lines l ${POSTED} JOIN accounts a ON a.id = l.account_id AND a.type IN ('INCOME','EXPENSE') JOIN vehicles ve ON ve.id = l.vehicle_id
      WHERE v.voucher_date BETWEEN :from AND :to GROUP BY ve.id ORDER BY ve.code`, p);
    const out = rows.map((r: any) => { const profit = Math.round((r.income - r.fuel - r.other_exp) * 100) / 100; return { ...r, profit, margin: r.income > 0 ? Math.round((profit / r.income) * 1000) / 10 : null }; });
    return { title: 'Bowzer profit & loss', subtitle: `${p.from} to ${p.to} · every bowzer is its own account`, columns: [{ key: 'code', label: 'Bowzer' }, { key: 'owner', label: 'Owner' }, { key: 'trips', label: 'Billed trips', type: 'num' }, { key: 'income', label: 'Freight income', type: 'money' }, { key: 'fuel', label: 'Fuel', type: 'money' }, { key: 'other_exp', label: 'Other expenses', type: 'money' }, { key: 'profit', label: 'Profit', type: 'money' }, { key: 'margin', label: 'Margin %', type: 'pct' }],
      rows: out, totals: { income: sum(out, 'income'), fuel: sum(out, 'fuel'), other_exp: sum(out, 'other_exp'), profit: sum(out, 'profit'), trips: sum(out, 'trips') } };
  } },
  'receivable-aging': { title: 'Receivable aging', run: async (p) => {
    const rows = await q(`SELECT d.code, d.name, d.customer_type,
        COALESCE(sum(i.total - i.paid) FILTER (WHERE :asOf::date - i.due_date <= 0), 0)::float AS current,
        COALESCE(sum(i.total - i.paid) FILTER (WHERE :asOf::date - i.due_date BETWEEN 1 AND 30), 0)::float AS d1_30,
        COALESCE(sum(i.total - i.paid) FILTER (WHERE :asOf::date - i.due_date BETWEEN 31 AND 60), 0)::float AS d31_60,
        COALESCE(sum(i.total - i.paid) FILTER (WHERE :asOf::date - i.due_date > 60), 0)::float AS d60_plus,
        COALESCE(sum(i.total - i.paid), 0)::float AS total
      FROM sales_invoices i JOIN distributors d ON d.id = i.customer_id WHERE i.kind = 'INVOICE' AND i.status IN ('UNPAID','PARTIAL') AND i.invoice_date <= :asOf GROUP BY d.id ORDER BY total DESC`, p);
    return { title: 'Receivable aging', subtitle: `As of ${p.asOf} · by days past due`, columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Customer' }, { key: 'current', label: 'Not due', type: 'money' }, { key: 'd1_30', label: '1–30 days', type: 'money' }, { key: 'd31_60', label: '31–60 days', type: 'money' }, { key: 'd60_plus', label: '60+ days', type: 'money' }, { key: 'total', label: 'Total due', type: 'money' }],
      rows, totals: { current: sum(rows, 'current'), d1_30: sum(rows, 'd1_30'), d31_60: sum(rows, 'd31_60'), d60_plus: sum(rows, 'd60_plus'), total: sum(rows, 'total') } };
  } },
  'invoice-aging': { title: 'Invoice aging', run: async (p) => {
    const rows = await q(`SELECT i.invoice_no, i.invoice_date AS date, i.due_date, d.name AS customer, i.total::float AS total, i.paid::float AS paid, (i.total - i.paid)::float AS due, GREATEST(:asOf::date - i.due_date, 0)::int AS days_overdue
        FROM sales_invoices i JOIN distributors d ON d.id = i.customer_id WHERE i.kind = 'INVOICE' AND i.status IN ('UNPAID','PARTIAL') AND i.invoice_date <= :asOf ORDER BY i.due_date`, p);
    return { title: 'Invoice aging', subtitle: `As of ${p.asOf}`, columns: [{ key: 'invoice_no', label: 'Invoice' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'due_date', label: 'Due', type: 'date' }, { key: 'customer', label: 'Customer' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'paid', label: 'Paid', type: 'money' }, { key: 'due', label: 'Outstanding', type: 'money' }, { key: 'days_overdue', label: 'Days overdue', type: 'num' }], rows, totals: { total: sum(rows, 'total'), paid: sum(rows, 'paid'), due: sum(rows, 'due') } };
  } },
  'payables': { title: 'Payables by vendor', run: async (p) => {
    const rows = await q(`SELECT ve.code, ve.name, ve.category, COALESCE(sum(l.credit - l.debit), 0)::float AS balance FROM vendors ve JOIN voucher_lines l ON l.party_type = 'VENDOR' AND l.party_id = ve.id AND l.account_id = (SELECT id FROM accounts WHERE system_key = 'payable') ${POSTED}
        WHERE v.voucher_date <= :asOf GROUP BY ve.id HAVING abs(sum(l.credit - l.debit)) > 0.004 ORDER BY balance DESC`, p);
    return { title: 'Payables by vendor', subtitle: `As of ${p.asOf}`, columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Vendor' }, { key: 'category', label: 'Category' }, { key: 'balance', label: 'Payable', type: 'money' }], rows, totals: { balance: sum(rows, 'balance') } };
  } },
  'cash-flow': { title: 'Cash flow', run: async (p) => {
    const rows = await q(`WITH cb AS (SELECT id FROM accounts WHERE system_key = 'cash' UNION SELECT account_id FROM banks)
      SELECT a.code, a.name, COALESCE(sum(l.credit), 0)::float AS inflow, COALESCE(sum(l.debit), 0)::float AS outflow
        FROM voucher_lines l ${POSTED} JOIN accounts a ON a.id = l.account_id
       WHERE v.type <> 'OPENING' AND v.voucher_date BETWEEN :from AND :to AND l.account_id NOT IN (SELECT id FROM cb) AND EXISTS (SELECT 1 FROM voucher_lines c WHERE c.voucher_id = l.voucher_id AND c.account_id IN (SELECT id FROM cb))
       GROUP BY a.id ORDER BY a.code`, p);
    const out = rows.map((r: any) => ({ ...r, net: Math.round((r.inflow - r.outflow) * 100) / 100 }));
    return { title: 'Cash flow', subtitle: `${p.from} to ${p.to} · cash and bank movements by counter-account`, columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Counter account' }, { key: 'inflow', label: 'Cash in', type: 'money' }, { key: 'outflow', label: 'Cash out', type: 'money' }, { key: 'net', label: 'Net', type: 'money' }], rows: out, totals: { inflow: sum(out, 'inflow'), outflow: sum(out, 'outflow'), net: sum(out, 'net') } };
  } },
  'monthly-sales': { title: 'Monthly sales', run: async (p) => {
    const rows = await q(`SELECT to_char(date_trunc('month', invoice_date), 'YYYY-MM') AS month, count(*) FILTER (WHERE kind = 'INVOICE')::int AS invoices,
        COALESCE(sum(total) FILTER (WHERE kind = 'INVOICE'), 0)::float AS sales, COALESCE(sum(total) FILTER (WHERE kind = 'RETURN'), 0)::float AS returns
      FROM sales_invoices WHERE status <> 'VOID' AND invoice_date BETWEEN :from AND :to GROUP BY 1 ORDER BY 1`, p);
    const out = rows.map((r: any) => ({ ...r, net: Math.round((r.sales - r.returns) * 100) / 100 }));
    return { title: 'Monthly sales', subtitle: `${p.from} to ${p.to}`, columns: [{ key: 'month', label: 'Month' }, { key: 'invoices', label: 'Invoices', type: 'num' }, { key: 'sales', label: 'Sales', type: 'money' }, { key: 'returns', label: 'Returns', type: 'money' }, { key: 'net', label: 'Net sales', type: 'money' }], rows: out, totals: { invoices: sum(out, 'invoices'), sales: sum(out, 'sales'), returns: sum(out, 'returns'), net: sum(out, 'net') } };
  } },
  'chart-of-accounts': { title: 'Chart of accounts', run: async () => {
    const rows = await q(`SELECT a.code, repeat('   ', a.level - 1) || a.name AS name, a.type, a.level, CASE WHEN a.postable THEN 'Posting' ELSE 'Heading' END AS kind, CASE WHEN a.active THEN 'Active' ELSE 'Inactive' END AS status FROM accounts a ORDER BY a.code`);
    return { title: 'Chart of accounts', columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'type', label: 'Type' }, { key: 'level', label: 'Level', type: 'num' }, { key: 'kind', label: 'Kind' }, { key: 'status', label: 'Status' }], rows };
  } },
};

financeRouter.get('/reports', requirePerm('finance:view'), wrap(async (_req, res) => {
  res.json({ data: Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title })) });
}));
financeRouter.get('/reports/:key', requirePerm('finance:view'), wrap(async (req, res) => {
  const def = REPORTS[String(req.params.key)];
  if (!def) throw notFound('Report');
  const f = parse(z.object({ from: dateStr.optional(), to: dateStr.optional(), asOf: dateStr.optional(), accountId: z.coerce.number().optional(), vehicleId: z.coerce.number().optional(), partyType: z.string().optional(), partyId: z.coerce.number().optional() }), req.query);
  const to = f.to ?? f.asOf ?? today();
  const report = await def.run({ from: f.from ?? (await fyStart()), to, asOf: f.asOf ?? to, accountId: f.accountId, vehicleId: f.vehicleId, partyType: f.partyType, partyId: f.partyId });
  res.json(report);
}));
export { REPORTS };
void money;

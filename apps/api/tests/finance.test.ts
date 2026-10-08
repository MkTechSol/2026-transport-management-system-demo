import { describe, expect, it } from 'vitest';
import { as, USERS } from './helpers';
import { q1, exec } from '../src/db/sequelize';

const acct = async (key: string) => (await q1<any>('SELECT id FROM accounts WHERE system_key = :k', { k: key })).id as number;

describe('finance: ledger integrity', () => {
  it('seeded ledger balances: every voucher nets to zero and the balance sheet checks', async () => {
    const bad = await q1<any>('SELECT count(*)::int AS n FROM (SELECT voucher_id FROM voucher_lines GROUP BY 1 HAVING sum(debit) <> sum(credit)) x');
    expect(bad.n).toBe(0);
    const acc = await as(USERS.accountant);
    const bs = (await acc.get('/finance/reports/balance-sheet')).body;
    expect(bs.rows.find((r: any) => r.section === 'Check').amount).toBe(0);
    const tb = (await acc.get('/finance/reports/trial-balance')).body;
    expect(tb.totals.debit).toBe(tb.totals.credit);
  });

  it('receivable control account equals open invoices', async () => {
    const l = await q1<any>("SELECT sum(debit - credit)::float AS b FROM voucher_lines WHERE account_id = (SELECT id FROM accounts WHERE system_key = 'receivable')");
    const i = await q1<any>("SELECT sum(total - paid)::float AS b FROM sales_invoices WHERE kind = 'INVOICE' AND status IN ('UNPAID','PARTIAL')");
    expect(Math.round(l.b)).toBe(Math.round(i.b));
  });

  it('rejects an unbalanced voucher with a clear message', async () => {
    const acc = await as(USERS.accountant);
    const r = await acc.post('/finance/vouchers', { type: 'JOURNAL', narration: 'bad', lines: [{ accountId: await acct('cash'), debit: 100 }, { accountId: await acct('exp_office'), credit: 90 }] });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/does not balance/i);
  });

  it('database refuses an unbalanced voucher even when the API is bypassed', async () => {
    await expect(exec(`WITH v AS (INSERT INTO vouchers (voucher_no, type, voucher_date, fiscal_year_id, total) VALUES ('TEST-UNBAL', 'JOURNAL', CURRENT_DATE, (SELECT id FROM fiscal_years WHERE CURRENT_DATE BETWEEN starts_on AND ends_on), 10) RETURNING id)
      INSERT INTO voucher_lines (voucher_id, line_no, account_id, debit, credit) SELECT id, 1, (SELECT id FROM accounts WHERE system_key = 'cash'), 10, 0 FROM v`)).rejects.toThrow(/unbalanced/i);
  });

  it('cannot post to a heading account', async () => {
    const acc = await as(USERS.accountant);
    const head = await q1<any>("SELECT id FROM accounts WHERE code = '5100'");
    const r = await acc.post('/finance/vouchers', { type: 'CASH_PAYMENT', lines: [{ accountId: head.id, amount: 50 }] });
    expect(r.status).toBe(422);
  });

  it('posts a bowzer expense voucher against the vehicle and shows it in the bowzer ledger', async () => {
    const acc = await as(USERS.accountant);
    const v = await q1<any>('SELECT id FROM vehicles ORDER BY id LIMIT 1');
    const r = await acc.post('/finance/vouchers', { type: 'BOWZER_EXPENSE', vehicleId: v.id, narration: 'Test wiper replacement', lines: [{ accountId: await acct('exp_maintenance'), amount: 1234 }] });
    expect(r.status).toBe(201);
    const led = (await acc.get(`/finance/reports/ledger?vehicleId=${v.id}`)).body;
    expect(led.rows.some((x: any) => x.voucher_no === r.body.voucher.voucher_no)).toBe(true);
    // void keeps the record but removes it from the ledger
    expect((await acc.post(`/finance/vouchers/${r.body.voucher.id}/void`, { reason: 'test cleanup' })).status).toBe(200);
    const led2 = (await acc.get(`/finance/reports/ledger?vehicleId=${v.id}`)).body;
    expect(led2.rows.some((x: any) => x.voucher_no === r.body.voucher.voucher_no)).toBe(false);
  });
});

describe('finance: sales & receipts', () => {
  it('invoice → receipt allocation settles the invoice; over-allocation is refused', async () => {
    const acc = await as(USERS.accountant);
    const cust = await q1<any>("SELECT id FROM distributors WHERE customer_type = 'DISTRIBUTOR' AND credit_status = 'GOOD' ORDER BY id LIMIT 1");
    const inv = await acc.post('/sales/invoices', { customerId: cust.id, lines: [{ description: 'Test haulage', qty: 2, unit: 'MT', rate: 1000 }], taxPct: 0 });
    expect(inv.status).toBe(201);
    expect(Number(inv.body.invoice.total)).toBe(2000);
    const over = await acc.post('/sales/receipts', { customerId: cust.id, amount: 5000, mode: 'CASH', allocations: [{ invoiceId: inv.body.invoice.id, amount: 3000 }] });
    expect(over.status).toBe(422);
    const part = await acc.post('/sales/receipts', { customerId: cust.id, amount: 500, mode: 'CASH', allocations: [{ invoiceId: inv.body.invoice.id, amount: 500 }] });
    expect(part.status).toBe(201);
    expect((await acc.get(`/sales/invoices/${inv.body.invoice.id}`)).body.invoice.status).toBe('PARTIAL');
    const rest = await acc.post('/sales/receipts', { customerId: cust.id, amount: 1500, mode: 'CASH', allocations: [{ invoiceId: inv.body.invoice.id, amount: 1500 }] });
    expect(rest.status).toBe(201);
    expect((await acc.get(`/sales/invoices/${inv.body.invoice.id}`)).body.invoice.status).toBe('PAID');
    // a paid invoice cannot be voided without reversing the receipts
    expect((await acc.post(`/sales/invoices/${inv.body.invoice.id}/void`, { reason: 'should not work' })).status).toBe(422);
  });

  it('credit notes reduce what the customer owes', async () => {
    const acc = await as(USERS.accountant);
    const cust = await q1<any>("SELECT id FROM distributors WHERE customer_type = 'DISTRIBUTOR' ORDER BY id DESC LIMIT 1");
    const before = (await acc.get(`/sales/customers/${cust.id}/account`)).body.balance;
    const inv = (await acc.post('/sales/invoices', { customerId: cust.id, lines: [{ description: 'Return test', qty: 1, rate: 4000 }], taxPct: 0 })).body.invoice;
    const ret = await acc.post('/sales/invoices', { customerId: cust.id, kind: 'RETURN', refInvoiceId: inv.id, lines: [{ description: 'Short delivery credit', qty: 1, rate: 1500 }], taxPct: 0 });
    expect(ret.status).toBe(201);
    const after = (await acc.get(`/sales/customers/${cust.id}/account`)).body.balance;
    expect(after - before).toBe(2500);
  });

  it('completing a trip raises the freight invoice and expense approvals post vouchers automatically', async () => {
    const trip = await q1<any>("SELECT id, invoice_id FROM trips WHERE status = 'COMPLETED' AND invoice_id IS NOT NULL LIMIT 1");
    expect(trip.invoice_id).toBeGreaterThan(0);
    const unposted = await q1<any>("SELECT count(*)::int AS n FROM trip_expenses WHERE status IN ('APPROVED','REIMBURSED') AND voucher_id IS NULL");
    expect(unposted.n).toBe(0);
  });
});

describe('finance: access control', () => {
  it('only finance roles can see the ledger and sales', async () => {
    for (const who of [USERS.dispatcher, USERS.fleet, USERS.driver, USERS.store]) {
      const u = await as(who);
      expect((await u.get('/finance/vouchers')).status).toBe(403);
      expect((await u.get('/sales/invoices')).status).toBe(403);
      expect((await u.post('/finance/vouchers', { type: 'CASH_PAYMENT', lines: [] })).status).toBe(403);
    }
    expect((await (await as(USERS.viewer)).get('/finance/reports/profit-loss')).status).toBe(200);
    expect((await (await as(USERS.viewer)).post('/finance/vouchers', { type: 'CASH_PAYMENT', lines: [] })).status).toBe(403);
    expect((await (await as(USERS.viewer)).post('/sales/receipts', { customerId: 1, amount: 5, mode: 'CASH' })).status).toBe(403);
  });
});

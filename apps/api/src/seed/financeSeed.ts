import { q, q1, exec, sequelize } from '../db/sequelize';
import { createInvoice, createReceipt, postExpense } from '../services/sales';
import { accountId, postVoucher } from '../services/ledger';
import type { Rng } from './rng';

const DAY = 86400000;
export const FUEL_STATIONS = ['Demo Fuel Station — Kohat Rd', 'Demo Pump — GT Road Attock', 'Demo Fuel Plaza — Motorway M-1', 'Demo Petroleum — Nowshera', 'Demo Pump — Peshawar Ring Rd', 'Demo Fuel Station — Dhurnal'];

const VENDORS: [string, string, string, string][] = [
  ['Demo Workshop — Peshawar Heavy Motors', 'WORKSHOP', 'Peshawar', 'Heavy vehicle repair'],
  ['Demo Workshop — Kohat Truck Care', 'WORKSHOP', 'Kohat', 'Bowzer service'],
  ['Demo Tyre House — GT Road', 'SUPPLIER', 'Attock', 'Tyres & tubes'],
  ['Demo Auto Parts — Karkhano Market', 'SUPPLIER', 'Peshawar', 'Spare parts'],
  ['Demo Electronics — Cameras & Trackers', 'SUPPLIER', 'Islamabad', 'Cameras, GPS trackers'],
  ['Demo Lubricants Trading', 'SUPPLIER', 'Rawalpindi', 'Engine oil & lubricants'],
  ['Demo Insurance Brokers', 'SERVICE', 'Islamabad', 'Vehicle insurance'],
  ['Demo Transport Co. (sub-contract)', 'TRANSPORTER', 'Mardan', 'Hired bowzers'],
  ['Demo Refinery Liaison Office', 'REFINERY', 'Attock', 'Uplift coordination'],
];

/**
 * Finance backfill driven by the real services, so the seeded ledger is exactly what the app would have produced:
 * opening balances, trip expense vouchers, freight invoices for completed trips, receipts, vendor settlements, workshop bills and a few manual vouchers.
 */
export async function seedFinance(c: { rng: Rng; NOW: number; log?: (m: string) => void }) {
  const { rng, NOW } = c; const today = new Date(NOW).toISOString().slice(0, 10);
  const dayStr = (off: number) => new Date(NOW + off * DAY).toISOString().slice(0, 10);

  // fiscal years covering the data window (reopen for the backfill, close prior years afterwards)
  const first = await q1<any>(`SELECT least((SELECT min(incurred_on) FROM trip_expenses), (SELECT min(scheduled_departure)::date FROM trips), CURRENT_DATE - 75) AS d`);
  const startYear = (d: string) => (Number(d.slice(5, 7)) >= 7 ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) - 1);
  for (let y = startYear(String(first.d).slice(0, 10)); y <= startYear(today); y++) {
    await exec(`INSERT INTO fiscal_years (label, starts_on, ends_on) VALUES (:l, :s, :e) ON CONFLICT (label) DO NOTHING`, { l: `${y}-${String(y + 1).slice(2)}`, s: `${y}-07-01`, e: `${y + 1}-06-30` });
  }
  await exec(`UPDATE fiscal_years SET status = 'OPEN'`);
  const fyStart = (await q1<any>(`SELECT starts_on FROM fiscal_years WHERE :d BETWEEN starts_on AND ends_on`, { d: String(first.d).slice(0, 10) }))!.starts_on as string;
  const openDate = new Date(new Date(`${fyStart}T00:00:00Z`).getTime()).toISOString().slice(0, 10) < String(first.d).slice(0, 10) ? String(first.d).slice(0, 10) : fyStart;

  // vendors (fuel stations double as payable parties for fuel bought on credit)
  const vrows: any[] = []; let vn = 1;
  for (const s of FUEL_STATIONS) vrows.push({ code: `VND-${String(vn++).padStart(4, '0')}`, name: s, category: 'FUEL_STATION', city: s.split('— ')[1]?.split(' ')[0] ?? 'Peshawar', payment_terms_days: 15, phone: `0300-555${String(7000 + vn * 13).slice(-4)}` });
  for (const [name, category, city, about] of VENDORS) vrows.push({ code: `VND-${String(vn++).padStart(4, '0')}`, name, category, city, address: `${about} (synthetic)`, payment_terms_days: category === 'WORKSHOP' ? 15 : 30, phone: `0300-555${String(7000 + vn * 13).slice(-4)}` });
  await sequelize.getQueryInterface().bulkInsert('vendors', vrows.map((v) => ({ address: null, contact_name: null, email: null, ntn: null, phone: null, ...v })));
  const vendors = await q<any>('SELECT id, name, category FROM vendors ORDER BY id');
  const vendorBy = (cat: string, i = 0) => vendors.filter((v: any) => v.category === cat)[i];

  // banks
  const bankNames: [string, string, string][] = [['Demo Bank Ltd', 'Peshawar Main Branch', 'PK00DEMO0000112233440001'], ['Sample Commercial Bank', 'Islamabad Blue Area', 'PK00SAMP0000998877660002'], ['Test Islamic Bank', 'Kohat Cantt Branch', 'PK00TEST0000554433220003']];
  const banks: any[] = [];
  for (const [name, branch, no] of bankNames) {
    const parent = await q1<any>(`SELECT id, level FROM accounts WHERE system_key = 'bank_control'`);
    const n = await q1<any>(`SELECT count(*)::int + 1 AS n FROM accounts WHERE parent_id = :p`, { p: parent.id });
    const acc = await q1<any>(`INSERT INTO accounts (code, name, type, parent_id, level, postable) VALUES (:c, :n, 'ASSET', :p, :l, true) RETURNING id`, { c: `1120-${String(n.n).padStart(2, '0')}`, n: `Bank — ${name}`, p: parent.id, l: parent.level + 1 });
    banks.push(await q1<any>(`INSERT INTO banks (name, branch, account_no, account_id) VALUES (:n, :b, :no, :a) RETURNING *`, { n: name, b: branch, no, a: acc.id }));
  }

  // opening balances: cash, banks, fleet at cost against owner capital; customer opening dues as invoices
  const bowzers = await q<any>('SELECT id, code FROM vehicles WHERE archived_at IS NULL ORDER BY id');
  await postVoucher({
    type: 'OPENING', date: openDate, narration: 'Opening balances brought forward (demo)',
    lines: [
      { accountKey: 'cash', debit: 1_850_000 },
      { accountId: banks[0].account_id, debit: 38_400_000 }, { accountId: banks[1].account_id, debit: 21_250_000 }, { accountId: banks[2].account_id, debit: 9_600_000 },
      { accountKey: 'inventory', debit: 3_200_000 },
      ...bowzers.map((b: any) => ({ accountKey: 'vehicles_asset', debit: 18_000_000, vehicleId: b.id, memo: `Bowzer ${b.code} at cost` })),
      { accountKey: 'capital', credit: 1_850_000 + 38_400_000 + 21_250_000 + 9_600_000 + 3_200_000 + 18_000_000 * bowzers.length },
    ],
  });

  // 1) trip expense vouchers from the approved expenses
  const expenses = await q<any>(`SELECT * FROM trip_expenses WHERE status IN ('APPROVED','REIMBURSED') ORDER BY incurred_on, id`);
  for (const e of expenses) await sequelize.transaction((tx) => postExpense(e, tx));
  c.log?.(`posted ${expenses.length} trip expense vouchers`);

  // 2) freight invoices for completed trips
  const trips = await q<any>(`SELECT t.id, t.code, t.trip_type, t.vehicle_id, t.bill_to_id, t.freight_per_mt::float AS rate, COALESCE(t.delivered_mt, t.loaded_mt, t.planned_load_mt)::float AS mt, t.completed_at::date::text AS done,
      o.name AS origin, COALESCE(d.name, dl.name) AS dest FROM trips t JOIN locations o ON o.id = t.origin_location_id LEFT JOIN locations dl ON dl.id = t.destination_location_id LEFT JOIN distributors d ON d.id = t.distributor_id
    WHERE t.status = 'COMPLETED' AND t.freight_per_mt > 0 AND t.bill_to_id IS NOT NULL ORDER BY t.completed_at, t.id`);
  const invoices: any[] = [];
  for (const t of trips) {
    const date = t.done < openDate ? openDate : t.done;
    const inv = await createInvoice(null, undefined, { customerId: t.bill_to_id, tripId: t.id, date, lines: [{ description: `Freight ${t.code}: ${t.origin} → ${t.dest}`, qty: t.mt, rate: t.rate, vehicleId: t.vehicle_id }] });
    invoices.push({ ...inv, customer_id: t.bill_to_id });
  }
  // a few older invoices carried forward so the aging report has real 30/60/90+ buckets
  const custs = await q<any>(`SELECT id, name FROM distributors WHERE customer_type = 'DISTRIBUTOR' ORDER BY id LIMIT 12`);
  const oldDate = (n: number) => { const d = dayStr(-n); return d < openDate ? openDate : d; };
  for (const [i, cu] of custs.slice(0, 6).entries()) {
    const inv = await createInvoice(null, undefined, { customerId: cu.id, date: oldDate(70 + i * 3), notes: 'Balance brought forward (demo)', lines: [{ description: `Freight — previous period consignments (${cu.name})`, qty: 40 + i * 7, rate: 6200 + i * 150 }] });
    invoices.push({ ...inv, customer_id: cu.id, old: true });
  }

  // 3) receipts: most customers pay close to terms; two chronically slow payers keep the credit watch interesting
  const slow = new Set([custs[1]?.id, custs[4]?.id]);
  const byCust = new Map<number, any[]>();
  for (const i of invoices) { const l = byCust.get(i.customer_id) ?? []; l.push(i); byCust.set(i.customer_id, l); }
  let rc = 0;
  for (const [cid, list] of byCust) {
    const isSlow = slow.has(cid); const isMkt = cid > 100 || (await q1<any>('SELECT customer_type FROM distributors WHERE id = :id', { id: cid }))?.customer_type === 'MARKETER';
    list.sort((a, b) => String(a.invoice_date).localeCompare(String(b.invoice_date)));
    // settle invoices older than ~30 days in batches (one receipt covering several invoices, as in practice)
    const due = list.filter((i) => (NOW - new Date(i.invoice_date).getTime()) / DAY > (isSlow ? 75 : isMkt ? 28 : 21) && !(isSlow && rng.chance(0.7)));
    for (let k = 0; k < due.length; k += 3) {
      const batch = due.slice(k, k + 3); const amt = batch.reduce((s, i) => s + (i.total - i.paid), 0);
      const lastDate = batch.reduce((m, i) => (String(i.invoice_date) > m ? String(i.invoice_date) : m), '');
      const date = new Date(Math.min(NOW, new Date(lastDate).getTime() + rng.int(8, 24) * DAY)).toISOString().slice(0, 10);
      const partial = !isSlow && rng.chance(0.18);
      const pay = partial ? Math.round(amt * rng.float(0.5, 0.8) / 100) * 100 : amt;
      const bank = rng.chance(0.78);
      await createReceipt(null, undefined, { customerId: cid, amount: pay, mode: bank ? 'BANK' : 'CASH', bankId: bank ? rng.pick(banks).id : null, date, reference: bank ? `CHQ-${rng.int(100000, 999999)}` : undefined, autoAllocate: true });
      rc++;
    }
  }
  c.log?.(`posted ${invoices.length} invoices and ${rc} receipts`);

  // 4) vendor settlements for fuel on credit (about 70% settled), workshop bills from maintenance records
  const credit = await q<any>(`SELECT l.party_id AS vendor_id, sum(l.credit - l.debit)::float AS bal, min(v.voucher_date) AS first FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED'
      WHERE l.party_type = 'VENDOR' AND l.account_id = (SELECT id FROM accounts WHERE system_key = 'payable') GROUP BY 1`);
  for (const cr of credit) {
    const pay = Math.round(cr.bal * 0.7 / 100) * 100; if (pay < 1000) continue;
    const date = dayStr(-rng.int(3, 14));
    await postVoucher({ type: 'BANK_PAYMENT', date: date < openDate ? openDate : date, narration: 'Settlement of fuel credit account', lines: [{ accountKey: 'payable', debit: pay, partyType: 'VENDOR', partyId: cr.vendor_id }, { accountId: rng.pick(banks).account_id, credit: pay }], partyType: 'VENDOR', partyId: cr.vendor_id });
  }
  const maint = await q<any>(`SELECT id, vehicle_id, title, cost_pkr::float AS cost, COALESCE(completed_at::date, scheduled_on)::text AS d, vendor, type FROM maintenance_records WHERE cost_pkr > 0 AND status = 'COMPLETED' ORDER BY completed_at, id`);
  for (const m of maint) {
    if (m.d < openDate) continue; // earlier work predates the ledger
    const wk = vendors.find((v: any) => v.category === 'WORKSHOP' && (m.vendor ?? '').includes(v.name.split('— ')[1]?.split(' ')[0] ?? '#')) ?? vendorBy('WORKSHOP', m.id % 2);
    const d = m.d < openDate ? openDate : m.d > today ? today : m.d;
    const key = m.type === 'TYRE' ? 'exp_tyres' : 'exp_maintenance';
    const paid = rng.chance(0.55);
    if (paid) await postVoucher({ type: 'BOWZER_EXPENSE', date: d, narration: `${m.title}${wk ? ` — ${wk.name}` : ''}`, lines: [{ accountKey: key, debit: m.cost, vehicleId: m.vehicle_id }, { accountKey: rng.chance(0.5) ? 'cash' : 'cash', credit: m.cost, vehicleId: m.vehicle_id }], vehicleId: m.vehicle_id, sourceType: 'MAINT', sourceId: m.id });
    else await postVoucher({ type: 'PURCHASE', date: d, narration: `Workshop bill: ${m.title}${wk ? ` — ${wk.name}` : ''}`, lines: [{ accountKey: key, debit: m.cost, vehicleId: m.vehicle_id }, { accountKey: 'payable', credit: m.cost, partyType: 'VENDOR', partyId: wk?.id, vehicleId: m.vehicle_id }], vehicleId: m.vehicle_id, partyType: 'VENDOR', partyId: wk?.id, sourceType: 'MAINT', sourceId: m.id });
  }

  // 5) manual vouchers a clerk would key in: office costs, a journal, a bank charge, an owner top-up
  const bank0 = banks[0].account_id;
  const manual: any[] = [
    { type: 'CASH_PAYMENT', date: dayStr(-9), narration: 'Office stationery and printing', lines: [{ accountKey: 'exp_office', debit: 18_500 }, { accountKey: 'cash', credit: 18_500 }] },
    { type: 'BANK_PAYMENT', date: dayStr(-14), narration: 'Electricity and internet — head office', lines: [{ accountKey: 'exp_office', debit: 96_400 }, { accountId: bank0, credit: 96_400 }] },
    { type: 'BANK_PAYMENT', date: dayStr(-20), narration: 'Annual vehicle insurance instalment', lines: [{ accountKey: 'exp_insurance', debit: 640_000 }, { accountId: bank0, credit: 640_000 }], partyType: 'VENDOR', partyId: vendors.find((v: any) => v.name.includes('Insurance'))?.id },
    { type: 'JOURNAL', date: dayStr(-5), narration: 'Reclassify camera purchase from expenses to inventory', lines: [{ accountKey: 'inventory', debit: 210_000 }, { accountKey: 'exp_parts', credit: 210_000 }] },
    { type: 'BANK_PAYMENT', date: dayStr(-3), narration: 'Bank charges for the month', lines: [{ accountKey: 'exp_bank', debit: 7_850 }, { accountId: bank0, credit: 7_850 }] },
    { type: 'CASH_RECEIPT', date: dayStr(-2), narration: 'Scrap sale — old tyres', lines: [{ accountKey: 'other_income', credit: 42_000 }, { accountKey: 'cash', debit: 42_000 }] },
  ];
  for (const m of manual) await postVoucher(m);
  // 6) a cash deposit moving cash to bank
  await postVoucher({ type: 'JOURNAL', date: dayStr(-6), narration: 'Cash deposited to bank', lines: [{ accountId: bank0, debit: 300_000 }, { accountKey: 'cash', credit: 300_000 }] });

  // a couple of open sales orders for the order list / pending-orders view
  const so = await q<any>(`SELECT id FROM distributors WHERE customer_type = 'DISTRIBUTOR' ORDER BY id LIMIT 4`);
  for (const [i, d] of so.entries()) {
    const date = dayStr(-i - 1); const qty = 18 + i * 4; const rate = 6800 + i * 100;
    const o = await q1<any>(`INSERT INTO sales_orders (order_no, order_date, customer_id, delivery_date, status, notes, total, created_by) VALUES (:no, :d, :c, :dd, 'OPEN', :n, :t, 2) RETURNING id`,
      { no: `SO-${date.slice(2, 4)}-${String(i + 1).padStart(5, '0')}`, d: date, c: d.id, dd: dayStr(i + 2), n: 'Standing weekly requirement (demo)', t: qty * rate });
    await exec(`INSERT INTO sales_order_lines (order_id, line_no, description, qty, unit, rate, amount) VALUES (:o, 1, 'LPG haulage — bowzer load', :q, 'MT', :r, :a)`, { o: o.id, q: qty, r: rate, a: qty * rate });
  }
  await exec(`SELECT setval('sales_order_no_seq', ${so.length})`);

  // close previous fiscal years
  await exec(`UPDATE fiscal_years SET status = 'CLOSED' WHERE ends_on < :t`, { t: today });
  void accountId;
}

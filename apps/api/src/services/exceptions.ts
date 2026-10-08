import { can, type Permission, type Role } from '@gasman/shared';
import { q } from '../db/sequelize';

export interface ExceptionItem { key: string; rule: string; severity: 'CRITICAL' | 'WARNING' | 'INFO'; category: string; title: string; detail: string; link: string; since: string | null; amount?: number }
interface Rule { id: string; category: string; perm: Permission; run: () => Promise<Omit<ExceptionItem, 'rule' | 'category'>[]> }

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-US')}`;
const sev = (days: number) => (days > 14 ? 'CRITICAL' : 'WARNING') as 'CRITICAL' | 'WARNING';

/** Rule-based exceptions computed live from the data — nothing here is stored except acknowledgements. */
export const RULES: Rule[] = [
  { id: 'doc-expired', category: 'Compliance', perm: 'documents:view', run: async () => (await q(`SELECT d.id, d.doc_type, d.expires_on::text AS exp, (CURRENT_DATE - d.expires_on) AS days, COALESCE(v.code, dr.full_name) AS who, (d.vehicle_id IS NOT NULL) AS is_vehicle, COALESCE(d.vehicle_id, d.driver_id) AS owner_id
      FROM documents d LEFT JOIN vehicles v ON v.id = d.vehicle_id LEFT JOIN drivers dr ON dr.id = d.driver_id WHERE d.expires_on < CURRENT_DATE AND (v.id IS NULL OR v.archived_at IS NULL) ORDER BY d.expires_on LIMIT 60`)).map((r: any) => ({
    key: `doc-expired:${r.id}`, severity: 'CRITICAL' as const, title: `${r.who}: ${r.doc_type.replace(/_/g, ' ').toLowerCase()} expired`, detail: `Expired ${r.days} day(s) ago (${r.exp}). The vehicle/driver cannot be assigned until it is renewed.`, link: r.is_vehicle ? `/fleet/${r.owner_id}?tab=documents` : `/drivers/${r.owner_id}`, since: r.exp })) },
  { id: 'doc-expiring', category: 'Compliance', perm: 'documents:view', run: async () => (await q(`SELECT d.id, d.doc_type, d.expires_on::text AS exp, (d.expires_on - CURRENT_DATE) AS days, COALESCE(v.code, dr.full_name) AS who, (d.vehicle_id IS NOT NULL) AS is_vehicle, COALESCE(d.vehicle_id, d.driver_id) AS owner_id
      FROM documents d LEFT JOIN vehicles v ON v.id = d.vehicle_id LEFT JOIN drivers dr ON dr.id = d.driver_id WHERE d.expires_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 30 AND (v.id IS NULL OR v.archived_at IS NULL) ORDER BY d.expires_on LIMIT 60`)).map((r: any) => ({
    key: `doc-expiring:${r.id}`, severity: (r.days <= 7 ? 'WARNING' : 'INFO') as 'WARNING' | 'INFO', title: `${r.who}: ${r.doc_type.replace(/_/g, ' ').toLowerCase()} expires in ${r.days} day(s)`, detail: `Valid until ${r.exp}. Renew before it blocks dispatch.`, link: r.is_vehicle ? `/fleet/${r.owner_id}?tab=documents` : `/drivers/${r.owner_id}`, since: r.exp })) },
  { id: 'maintenance-overdue', category: 'Fleet', perm: 'maintenance:view', run: async () => (await q(`SELECT m.id, m.title, m.scheduled_on::text AS d, (CURRENT_DATE - m.scheduled_on) AS days, v.code FROM maintenance_records m JOIN vehicles v ON v.id = m.vehicle_id WHERE m.status = 'SCHEDULED' AND m.scheduled_on < CURRENT_DATE ORDER BY m.scheduled_on LIMIT 40`)).map((r: any) => ({
    key: `maintenance-overdue:${r.id}`, severity: sev(r.days), title: `${r.code}: ${r.title} is overdue`, detail: `Scheduled for ${r.d} — ${r.days} day(s) late.`, link: '/maintenance', since: r.d })) },
  { id: 'trip-delayed', category: 'Operations', perm: 'trips:view', run: async () => (await q(`SELECT t.id, t.code, t.status, t.delay_minutes, t.hold_reason, v.code AS vehicle, COALESCE(d.name, dl.name) AS dest FROM trips t LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN distributors d ON d.id = t.distributor_id LEFT JOIN locations dl ON dl.id = t.destination_location_id WHERE t.status IN ('DELAYED','ON_HOLD') ORDER BY t.delay_minutes DESC`)).map((r: any) => ({
    key: `trip-delayed:${r.id}`, severity: (r.status === 'ON_HOLD' || r.delay_minutes > 90 ? 'CRITICAL' : 'WARNING') as 'CRITICAL' | 'WARNING', title: `${r.code} ${r.status === 'ON_HOLD' ? 'is on hold' : `is ${r.delay_minutes} min late`} (${r.vehicle ?? 'no vehicle'} → ${r.dest})`, detail: r.hold_reason ?? 'Projected arrival is behind plan.', link: `/trips/${r.id}`, since: null })) },
  { id: 'fuel-flagged', category: 'Fuel & expenses', perm: 'fuel:view', run: async () => (await q(`SELECT f.id, f.flag_reason, f.fueled_at::date::text AS d, f.amount::float AS amount, v.code FROM fuel_entries f JOIN vehicles v ON v.id = f.vehicle_id WHERE f.status = 'FLAGGED' ORDER BY f.fueled_at DESC LIMIT 40`)).map((r: any) => ({
    key: `fuel-flagged:${r.id}`, severity: 'WARNING' as const, title: `${r.code}: fuel fill needs review (${pkr(r.amount)})`, detail: r.flag_reason ?? 'Flagged by the km-per-litre check.', link: '/fuel?tab=exceptions', since: r.d, amount: r.amount })) },
  { id: 'expense-stale', category: 'Fuel & expenses', perm: 'expenses:view', run: async () => (await q(`SELECT x.id, x.amount::float AS amount, x.category, t.code, (CURRENT_DATE - x.incurred_on) AS days FROM trip_expenses x JOIN trips t ON t.id = x.trip_id WHERE x.status = 'SUBMITTED' AND x.created_at < now() - interval '2 days' ORDER BY x.created_at LIMIT 40`)).map((r: any) => ({
    key: `expense-stale:${r.id}`, severity: 'WARNING' as const, title: `${r.code}: ${r.category.replace(/_/g, ' ').toLowerCase()} expense waiting ${r.days} day(s)`, detail: `${pkr(r.amount)} is still awaiting approval.`, link: '/approvals', since: null, amount: r.amount })) },
  { id: 'credit-limit', category: 'Finance', perm: 'finance:view', run: async () => (await q(`SELECT d.id, d.name, d.credit_limit_pkr::float AS lim, (pb.debit - pb.credit)::float AS bal, round((pb.debit - pb.credit) / d.credit_limit_pkr * 100)::int AS pct FROM distributors d JOIN party_balances pb ON pb.party_type = 'CUSTOMER' AND pb.party_id = d.id AND pb.account_id = (SELECT id FROM accounts WHERE system_key = 'receivable') WHERE d.credit_limit_pkr > 0 AND (pb.debit - pb.credit) >= d.credit_limit_pkr * d.credit_alert_pct / 100.0 ORDER BY pct DESC`)).map((r: any) => ({
    key: `credit-limit:${r.id}`, severity: (r.pct >= 100 ? 'CRITICAL' : 'WARNING') as 'CRITICAL' | 'WARNING', title: `${r.name} is at ${r.pct}% of its credit limit`, detail: `Outstanding ${pkr(r.bal)} against a limit of ${pkr(r.lim)}.`, link: `/distributors/${r.id}`, since: null, amount: r.bal })) },
  { id: 'invoice-overdue', category: 'Finance', perm: 'finance:view', run: async () => (await q(`SELECT i.id, i.invoice_no, d.name, (i.total - i.paid)::float AS due, (CURRENT_DATE - i.due_date) AS days FROM sales_invoices i JOIN distributors d ON d.id = i.customer_id WHERE i.kind = 'INVOICE' AND i.status IN ('UNPAID','PARTIAL') AND i.due_date < CURRENT_DATE - 45 ORDER BY i.due_date LIMIT 30`)).map((r: any) => ({
    key: `invoice-overdue:${r.id}`, severity: 'WARNING' as const, title: `${r.invoice_no} (${r.name}) is ${r.days} days overdue`, detail: `${pkr(r.due)} outstanding.`, link: '/sales/invoices?overdue=1', since: null, amount: r.due })) },
  { id: 'trip-loss', category: 'Finance', perm: 'finance:view', run: async () => (await q(`SELECT t.id, t.code, v.code AS vehicle, ((COALESCE(t.delivered_mt, 0) * t.freight_per_mt) - COALESCE(e.amt, 0))::float AS profit FROM trips t LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN LATERAL (SELECT sum(amount) AS amt FROM trip_expenses WHERE trip_id = t.id AND status IN ('APPROVED','REIMBURSED')) e ON true
      WHERE t.status = 'COMPLETED' AND t.completed_at > now() - interval '14 days' AND t.freight_per_mt > 0 AND ((COALESCE(t.delivered_mt, 0) * t.freight_per_mt) - COALESCE(e.amt, 0)) < 0 ORDER BY profit LIMIT 20`)).map((r: any) => ({
    key: `trip-loss:${r.id}`, severity: 'WARNING' as const, title: `${r.code} (${r.vehicle ?? '—'}) lost ${pkr(-r.profit)}`, detail: 'Approved expenses exceeded the freight billed on this trip.', link: `/trips/${r.id}?tab=finance`, since: null, amount: -r.profit })) },
  { id: 'cash-negative', category: 'Finance', perm: 'finance:view', run: async () => (await q(`SELECT COALESCE(sum(debit - credit), 0)::float AS bal FROM account_balances WHERE account_id = (SELECT id FROM accounts WHERE system_key = 'cash')`)).filter((r: any) => r.bal < 0).map((r: any) => ({
    key: 'cash-negative', severity: 'CRITICAL' as const, title: 'Cash in hand is negative', detail: `Cash book shows ${pkr(r.bal)}. A withdrawal from the bank is probably missing.`, link: '/finance/reports/cash-book', since: null })) },
  { id: 'payroll-unpaid', category: 'People', perm: 'payroll:manage', run: async () => (await q(`SELECT id, period, net::float AS net FROM payroll_runs WHERE status = 'POSTED' ORDER BY period`)).map((r: any) => ({
    key: `payroll-unpaid:${r.id}`, severity: 'INFO' as const, title: `Payroll ${r.period} is approved but not paid`, detail: `${pkr(r.net)} is sitting in salaries payable.`, link: '/hr?tab=payroll', since: null, amount: r.net })) },
  { id: 'low-stock', category: 'Inventory', perm: 'inventory:view', run: async () => (await q(`SELECT i.id, i.code, i.name, COALESCE(sum(s.qty), 0)::float AS qty, i.min_level::float AS min FROM items i LEFT JOIN stock_balances s ON s.item_id = i.id AND s.holder_type = 'WAREHOUSE' WHERE i.active AND i.min_level > 0 GROUP BY i.id HAVING COALESCE(sum(s.qty), 0) <= i.min_level ORDER BY COALESCE(sum(s.qty), 0) / i.min_level`)).map((r: any) => ({
    key: `low-stock:${r.id}`, severity: (r.qty <= r.min / 2 ? 'CRITICAL' : 'WARNING') as 'CRITICAL' | 'WARNING', title: `${r.name} is low (${r.qty} left, minimum ${r.min})`, detail: 'Raise a purchase requisition to restock.', link: '/inventory?low=1', since: null })) },
  { id: 'tyre-wear', category: 'Inventory', perm: 'tyres:view', run: async () => (await q(`SELECT t.id, t.serial_no, t.position, v.code, (t.km_run + GREATEST(0, v.odometer_km - COALESCE(t.odometer_fit, v.odometer_km)))::int AS km, v.id AS vid FROM tyres t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.status = 'FITTED' AND (t.km_run + GREATEST(0, v.odometer_km - COALESCE(t.odometer_fit, v.odometer_km))) > 75000 ORDER BY km DESC LIMIT 25`)).map((r: any) => ({
    key: `tyre-wear:${r.id}`, severity: (r.km > 90000 ? 'WARNING' : 'INFO') as 'WARNING' | 'INFO', title: `${r.code} tyre ${r.serial_no} (${r.position}) has run ${r.km.toLocaleString('en-US')} km`, detail: 'Inspect for wear; plan a change or retread.', link: `/tyres?tab=map&vehicle=${r.vid}`, since: null })) },
];

export async function computeExceptions(role: Role, includeAcked = false) {
  const acks = new Map((await q<any>('SELECT a.key, a.note, a.acked_at, u.full_name AS by FROM exception_acks a LEFT JOIN users u ON u.id = a.acked_by')).map((a: any) => [a.key, a]));
  const all: (ExceptionItem & { acked?: any })[] = [];
  for (const r of RULES) {
    if (!can(role, r.perm)) continue;
    for (const x of await r.run()) {
      const ack = acks.get(x.key);
      if (ack && !includeAcked) continue;
      all.push({ ...x, rule: r.id, category: r.category, acked: ack ?? undefined });
    }
  }
  const order = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  all.sort((a, b) => order[a.severity] - order[b.severity]);
  return all;
}

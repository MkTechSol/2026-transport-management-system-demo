import { userCan } from './roles';
type Actor = { perms: ReadonlySet<string> };
import { q, q1 } from '../db/sequelize';
import { computeExceptions } from './exceptions';

export interface Answer { intent: string; answer: string; columns?: { key: string; label: string; type?: 'money' | 'num' | 'text' }[]; rows?: any[]; link?: { to: string; label: string }; suggestions?: string[] }
const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-US')}`;
const SUGGEST = ['Give me today’s briefing', 'Which trips are delayed?', 'Who owes us the most?', 'Show low-stock items', 'Which bowzers made the most profit this month?', 'What expires in the next 30 days?', 'Cameras fitted on GAS-BZ-001'];
const denied = (what: string): Answer => ({ intent: 'denied', answer: `Your role does not include access to ${what}, so I can’t answer that. Ask a manager or accountant.`, suggestions: SUGGEST.slice(0, 3) });

/**
 * A deliberately simple, transparent "assistant": it recognises what you ask with keyword rules and answers from live data with the same permissions as the rest of the app.
 * It is NOT a language model — the UI says so — and it never takes actions on its own.
 */
export async function ask(actor: Actor, text: string): Promise<Answer> {
  const t = text.toLowerCase().trim();
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  const trip = text.match(/TRP-\d{4}-\d{3,5}/i)?.[0].toUpperCase();
  const veh = text.match(/GAS-BZ-\d{2,4}/i)?.[0].toUpperCase();

  if (trip) {
    if (!userCan(actor, 'trips:view')) return denied('trips');
    const r = await q1<any>(`SELECT t.code, t.status, t.trip_type, t.planned_load_mt::float AS load_mt, t.progress_pct::float AS progress, t.eta_at, t.delay_minutes, v.code AS vehicle, dr.full_name AS driver, o.name AS origin, CASE WHEN t.stop_count > 1 THEN (SELECT string_agg(sl.name, ' › ' ORDER BY ss.seq) FROM trip_stops ss JOIN locations sl ON sl.id = ss.location_id WHERE ss.trip_id = t.id) ELSE COALESCE(d.name, dl.name) END AS dest, t.id
      FROM trips t JOIN locations o ON o.id = t.origin_location_id LEFT JOIN locations dl ON dl.id = t.destination_location_id LEFT JOIN distributors d ON d.id = t.distributor_id LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers dr ON dr.id = t.driver_id WHERE t.code = :c`, { c: trip });
    if (!r) return { intent: 'trip', answer: `I couldn’t find trip ${trip}.`, suggestions: SUGGEST.slice(0, 3) };
    const eta = r.eta_at ? ` ETA ${new Date(r.eta_at).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', hour12: false, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}.` : '';
    return { intent: 'trip', answer: `${r.code} (${r.trip_type.toLowerCase()}) is ${r.status.toLowerCase().replace('_', ' ')}: ${r.origin} → ${r.dest}, ${r.load_mt} MT on ${r.vehicle ?? 'no vehicle yet'} with ${r.driver ?? 'no driver yet'}.${r.status === 'IN_TRANSIT' || r.status === 'DELAYED' ? ` ${Math.round(r.progress)}% of the way${r.delay_minutes > 0 ? `, ${r.delay_minutes} min behind plan` : ''}.` : ''}${eta}`, link: { to: `/trips/${r.id}`, label: `Open ${r.code}` } };
  }

  if (veh && has('camera', 'tracker', 'fitted', 'items', 'extinguisher', 'tyre', 'tyres', 'inventory', 'spare', 'parts')) {
    if (!userCan(actor, 'inventory:view')) return denied('inventory');
    const v = await q1<any>('SELECT id, code FROM vehicles WHERE code = :c', { c: veh }); if (!v) return { intent: 'vehicle-inventory', answer: `I couldn’t find ${veh}.` };
    const rows = await q(`SELECT c.name AS category, i.name AS item, s.qty::float AS qty FROM stock_balances s JOIN items i ON i.id = s.item_id JOIN item_categories c ON c.id = i.category_id WHERE s.holder_type = 'VEHICLE' AND s.holder_id = :id AND s.qty > 0 ORDER BY c.name, i.name`, { id: v.id });
    const cams = rows.filter((r: any) => /camera/i.test(r.category)).reduce((s: number, r: any) => s + r.qty, 0);
    const tyres = rows.filter((r: any) => /tyre/i.test(r.item)).reduce((s: number, r: any) => s + r.qty, 0);
    return { intent: 'vehicle-inventory', answer: `${v.code} carries ${rows.reduce((s: number, r: any) => s + r.qty, 0)} fitted units, including ${cams} camera(s) and ${tyres} tyre(s).`, columns: [{ key: 'category', label: 'Category' }, { key: 'item', label: 'Item' }, { key: 'qty', label: 'Qty', type: 'num' }], rows, link: { to: `/fleet/${v.id}?tab=inventory`, label: `Open ${v.code} inventory` } };
  }
  if (veh) {
    if (!userCan(actor, 'vehicles:view')) return denied('vehicles');
    const v = await q1<any>(`SELECT v.id, v.code, v.status, v.capacity_mt::float AS cap, v.odometer_km, v.owner_name, t.code AS trip, t.status AS trip_status FROM vehicles v LEFT JOIN trips t ON t.vehicle_id = v.id AND t.status IN ('DISPATCHED','IN_TRANSIT','DELAYED','ON_HOLD','ARRIVED','DELIVERED','RETURNING') WHERE v.code = :c`, { c: veh });
    if (!v) return { intent: 'vehicle', answer: `I couldn’t find ${veh}.` };
    const fin = userCan(actor, 'finance:view') ? await q1<any>(`SELECT COALESCE(sum(CASE WHEN a.type = 'INCOME' THEN l.credit - l.debit ELSE -(l.debit - l.credit) END), 0)::float AS profit FROM voucher_lines l JOIN vouchers x ON x.id = l.voucher_id AND x.status = 'POSTED' JOIN accounts a ON a.id = l.account_id AND a.type IN ('INCOME','EXPENSE') WHERE l.vehicle_id = :id AND x.voucher_date >= date_trunc('month', CURRENT_DATE)`, { id: v.id }) : null;
    return { intent: 'vehicle', answer: `${v.code} (${v.cap} MT, owner ${v.owner_name ?? '—'}) is ${v.status.toLowerCase().replace('_', ' ')}${v.trip ? `, currently on ${v.trip} (${v.trip_status.toLowerCase().replace('_', ' ')})` : ''}. Odometer ${Number(v.odometer_km).toLocaleString('en-US')} km.${fin ? ` Profit this month: ${pkr(fin.profit)}.` : ''}`, link: { to: `/fleet/${v.id}`, label: `Open ${v.code}` } };
  }

  if (has('briefing', 'summary', 'overview', 'today', 'status report')) {
    const [s] = await q(`SELECT count(*) FILTER (WHERE status IN ('IN_TRANSIT','DELAYED','ON_HOLD','RETURNING','ARRIVED','DELIVERED'))::int AS active, count(*) FILTER (WHERE status = 'DELAYED')::int AS delayed, count(*) FILTER (WHERE status = 'COMPLETED' AND (completed_at AT TIME ZONE 'Asia/Karachi')::date = (now() AT TIME ZONE 'Asia/Karachi')::date)::int AS done_today,
      count(*) FILTER (WHERE status IN ('PLANNED','ASSIGNED'))::int AS waiting FROM trips`);
    const ex = await computeExceptions(actor);
    const lines = [`Trips: ${s.active} active (${s.delayed} delayed), ${s.done_today} completed today, ${s.waiting} waiting for dispatch.`, `Exceptions needing attention: ${ex.filter((e) => e.severity === 'CRITICAL').length} critical, ${ex.filter((e) => e.severity === 'WARNING').length} warnings.`];
    if (userCan(actor, 'approvals:view')) { const a = await q1<any>(`SELECT count(*)::int AS n, COALESCE(sum(amount), 0)::float AS amt FROM approvals WHERE status = 'PENDING'`); lines.push(`Approvals pending: ${a.n}${a.amt ? ` (${pkr(a.amt)})` : ''}.`); }
    if (userCan(actor, 'finance:view')) { const f = await q1<any>(`SELECT COALESCE(sum(ab.debit - ab.credit) FILTER (WHERE a.system_key = 'receivable'), 0)::float AS ar, COALESCE(sum(ab.debit - ab.credit) FILTER (WHERE a.system_key = 'cash' OR a.parent_id = (SELECT id FROM accounts WHERE system_key = 'bank_control')), 0)::float AS cash FROM account_balances ab JOIN accounts a ON a.id = ab.account_id`); lines.push(`Cash and bank: ${pkr(f.cash)}. Receivables: ${pkr(f.ar)}.`); }
    return { intent: 'briefing', answer: `Daily briefing\n${lines.map((l) => `• ${l}`).join('\n')}`, link: { to: '/exceptions', label: 'Open Exceptions Center' }, suggestions: ['Which trips are delayed?', 'Show exceptions', 'Show low-stock items'] };
  }

  if (has('delay', 'late', 'on hold')) {
    if (!userCan(actor, 'trips:view')) return denied('trips');
    const rows = await q(`SELECT t.code, t.status, t.delay_minutes AS delay_min, v.code AS vehicle, dr.full_name AS driver, COALESCE(d.name, dl.name) AS destination FROM trips t LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers dr ON dr.id = t.driver_id LEFT JOIN distributors d ON d.id = t.distributor_id LEFT JOIN locations dl ON dl.id = t.destination_location_id WHERE t.status IN ('DELAYED','ON_HOLD') ORDER BY t.delay_minutes DESC`);
    return { intent: 'delayed', answer: rows.length ? `${rows.length} trip(s) are delayed or on hold.` : 'No trips are delayed right now.', columns: [{ key: 'code', label: 'Trip' }, { key: 'status', label: 'Status' }, { key: 'delay_min', label: 'Delay (min)', type: 'num' }, { key: 'vehicle', label: 'Bowzer' }, { key: 'driver', label: 'Driver' }, { key: 'destination', label: 'To' }], rows, link: { to: '/trips?status=DELAYED,ON_HOLD', label: 'Open trips' } };
  }

  if (has('owe', 'outstanding', 'receivable', 'overdue', 'unpaid', 'collect')) {
    if (!userCan(actor, 'finance:view')) return denied('financial data');
    const rows = await q(`SELECT d.name AS customer, (pb.debit - pb.credit)::float AS balance FROM distributors d JOIN party_balances pb ON pb.party_type = 'CUSTOMER' AND pb.party_id = d.id AND pb.account_id = (SELECT id FROM accounts WHERE system_key = 'receivable') WHERE pb.debit - pb.credit > 0 ORDER BY balance DESC LIMIT 8`);
    const tot = await q1<any>(`SELECT COALESCE(sum(total - paid), 0)::float AS due, COALESCE(sum(total - paid) FILTER (WHERE due_date < CURRENT_DATE), 0)::float AS overdue FROM sales_invoices WHERE kind = 'INVOICE' AND status IN ('UNPAID','PARTIAL')`);
    return { intent: 'receivables', answer: `Customers owe ${pkr(tot.due)} in total, of which ${pkr(tot.overdue)} is overdue. Largest balances:`, columns: [{ key: 'customer', label: 'Customer' }, { key: 'balance', label: 'Balance', type: 'money' }], rows, link: { to: '/finance/reports/receivable-aging', label: 'Open receivable aging' } };
  }

  if (has('profit', 'margin', 'earn', 'most money') && has('bowzer', 'vehicle', 'truck', 'tanker', 'fleet')) {
    if (!userCan(actor, 'finance:view')) return denied('financial data');
    const rows = await q(`SELECT ve.code AS bowzer, COALESCE(ve.owner_name, '') AS owner, sum(CASE WHEN a.type = 'INCOME' THEN l.credit - l.debit ELSE -(l.debit - l.credit) END)::float AS profit FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED' JOIN accounts a ON a.id = l.account_id AND a.type IN ('INCOME','EXPENSE') JOIN vehicles ve ON ve.id = l.vehicle_id WHERE v.voucher_date >= date_trunc('month', CURRENT_DATE) GROUP BY ve.id ORDER BY profit DESC`);
    return { intent: 'bowzer-profit', answer: rows.length ? `This month ${rows[0].bowzer} leads with ${pkr(rows[0].profit)}; ${rows[rows.length - 1].bowzer} is lowest at ${pkr(rows[rows.length - 1].profit)}.` : 'No bowzer postings yet this month.', columns: [{ key: 'bowzer', label: 'Bowzer' }, { key: 'owner', label: 'Owner' }, { key: 'profit', label: 'Profit (month to date)', type: 'money' }], rows: [...rows.slice(0, 5), ...rows.slice(-3)], link: { to: '/finance/reports/bowzer-pnl', label: 'Open bowzer P&L' } };
  }

  if (has('cash', 'bank balance', 'bank')) {
    if (!userCan(actor, 'finance:view')) return denied('financial data');
    const rows = await q(`SELECT b.name AS bank, COALESCE(ab.debit - ab.credit, 0)::float AS balance FROM banks b LEFT JOIN account_balances ab ON ab.account_id = b.account_id ORDER BY balance DESC`);
    const cash = await q1<any>(`SELECT COALESCE(sum(debit - credit), 0)::float AS b FROM account_balances WHERE account_id = (SELECT id FROM accounts WHERE system_key = 'cash')`);
    return { intent: 'bank', answer: `Cash in hand is ${pkr(cash.b)}; banks hold ${pkr(rows.reduce((s: number, r: any) => s + r.balance, 0))}.`, columns: [{ key: 'bank', label: 'Bank' }, { key: 'balance', label: 'Balance', type: 'money' }], rows, link: { to: '/finance/reports/bank-balances', label: 'Open bank balances' } };
  }

  if (has('low stock', 'low-stock', 'running out', 'reorder', 'stock')) {
    if (!userCan(actor, 'inventory:view')) return denied('inventory');
    const rows = await q(`SELECT i.code, i.name, COALESCE(sum(s.qty), 0)::float AS in_store, i.min_level::float AS minimum FROM items i LEFT JOIN stock_balances s ON s.item_id = i.id AND s.holder_type = 'WAREHOUSE' WHERE i.active AND i.min_level > 0 GROUP BY i.id HAVING COALESCE(sum(s.qty), 0) <= i.min_level ORDER BY COALESCE(sum(s.qty), 0) / i.min_level`);
    return { intent: 'low-stock', answer: rows.length ? `${rows.length} item(s) are at or below their minimum level.` : 'Everything is above its minimum level.', columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Item' }, { key: 'in_store', label: 'In store', type: 'num' }, { key: 'minimum', label: 'Minimum', type: 'num' }], rows, link: { to: '/procurement', label: 'Raise a requisition' } };
  }

  if (has('expire', 'expiry', 'expiring', 'document', 'licence', 'license', 'fitness', 'insurance')) {
    if (!userCan(actor, 'documents:view')) return denied('documents');
    const rows = await q(`SELECT COALESCE(v.code, dr.full_name) AS holder, d.doc_type AS document, d.expires_on::text AS expires, (d.expires_on - CURRENT_DATE)::int AS days_left FROM documents d LEFT JOIN vehicles v ON v.id = d.vehicle_id LEFT JOIN drivers dr ON dr.id = d.driver_id WHERE d.expires_on <= CURRENT_DATE + 30 AND (v.id IS NULL OR v.archived_at IS NULL) ORDER BY d.expires_on LIMIT 25`);
    return { intent: 'documents', answer: `${rows.length} document(s) are expired or expire within 30 days (negative days = already expired).`, columns: [{ key: 'holder', label: 'Bowzer / driver' }, { key: 'document', label: 'Document' }, { key: 'expires', label: 'Expires' }, { key: 'days_left', label: 'Days left', type: 'num' }], rows, link: { to: '/documents', label: 'Open documents' } };
  }

  if (has('fuel', 'diesel', 'km per litre', 'kmpl')) {
    if (!userCan(actor, 'fuel:view')) return denied('fuel data');
    const rows = await q(`SELECT v.code AS bowzer, count(*)::int AS fills, avg(f.kmpl)::float AS avg_kmpl, v.fuel_norm_kmpl::float AS norm, count(*) FILTER (WHERE f.status = 'FLAGGED')::int AS flagged FROM fuel_entries f JOIN vehicles v ON v.id = f.vehicle_id WHERE f.fueled_at > now() - interval '30 days' GROUP BY v.id HAVING count(*) FILTER (WHERE f.status = 'FLAGGED') > 0 OR avg(f.kmpl) < v.fuel_norm_kmpl * 0.9 ORDER BY flagged DESC, avg(f.kmpl) LIMIT 10`);
    return { intent: 'fuel', answer: rows.length ? `${rows.length} bowzer(s) show flagged fills or run below their fuel norm over the last 30 days.` : 'No fuel exceptions in the last 30 days.', columns: [{ key: 'bowzer', label: 'Bowzer' }, { key: 'fills', label: 'Fills', type: 'num' }, { key: 'avg_kmpl', label: 'Avg km/L', type: 'num' }, { key: 'norm', label: 'Norm', type: 'num' }, { key: 'flagged', label: 'Flagged', type: 'num' }], rows: rows.map((r: any) => ({ ...r, avg_kmpl: r.avg_kmpl ? Math.round(r.avg_kmpl * 100) / 100 : null })), link: { to: '/fuel?tab=exceptions', label: 'Open fuel exceptions' } };
  }

  if (has('approval', 'pending', 'waiting for me', 'to approve')) {
    if (!userCan(actor, 'approvals:view')) return denied('approvals');
    const rows = await q(`SELECT title, entity_type AS type, COALESCE(amount, 0)::float AS amount, approver_role AS approver FROM approvals WHERE status = 'PENDING' ORDER BY requested_at LIMIT 15`);
    return { intent: 'approvals', answer: rows.length ? `${rows.length} request(s) are waiting for a decision.` : 'Nothing is waiting for approval.', columns: [{ key: 'title', label: 'Request' }, { key: 'type', label: 'Type' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'approver', label: 'Approver' }], rows, link: { to: '/approvals', label: 'Open approval center' } };
  }

  if (has('available', 'free', 'idle', 'who can')) {
    if (!userCan(actor, 'vehicles:view')) return denied('fleet data');
    const v = await q(`SELECT code, capacity_mt::float AS capacity_mt, owner_name AS owner FROM vehicles WHERE status = 'AVAILABLE' AND archived_at IS NULL ORDER BY code LIMIT 12`);
    const d = await q1<any>(`SELECT count(*)::int AS n FROM drivers WHERE status = 'AVAILABLE'`);
    return { intent: 'availability', answer: `${v.length} bowzer(s) and ${d.n} driver(s) are available right now.`, columns: [{ key: 'code', label: 'Bowzer' }, { key: 'capacity_mt', label: 'Capacity MT', type: 'num' }, { key: 'owner', label: 'Owner' }], rows: v, link: { to: '/dispatch', label: 'Open dispatch board' } };
  }

  if (has('exception', 'alert', 'problem', 'attention', 'issues')) {
    if (!userCan(actor, 'exceptions:view')) return denied('exceptions');
    const ex = await computeExceptions(actor);
    return { intent: 'exceptions', answer: `${ex.length} open exception(s): ${ex.filter((e) => e.severity === 'CRITICAL').length} critical, ${ex.filter((e) => e.severity === 'WARNING').length} warnings. The most urgent:`, columns: [{ key: 'severity', label: 'Severity' }, { key: 'category', label: 'Area' }, { key: 'title', label: 'Issue' }], rows: ex.slice(0, 8), link: { to: '/exceptions', label: 'Open Exceptions Center' } };
  }

  if (has('maintenance', 'service', 'workshop')) {
    if (!userCan(actor, 'maintenance:view')) return denied('maintenance');
    const rows = await q(`SELECT v.code AS bowzer, m.title, m.status, m.scheduled_on::text AS scheduled FROM maintenance_records m JOIN vehicles v ON v.id = m.vehicle_id WHERE m.status IN ('SCHEDULED','IN_PROGRESS') ORDER BY m.scheduled_on LIMIT 12`);
    return { intent: 'maintenance', answer: `${rows.length} maintenance job(s) are scheduled or in progress.`, columns: [{ key: 'bowzer', label: 'Bowzer' }, { key: 'title', label: 'Job' }, { key: 'status', label: 'Status' }, { key: 'scheduled', label: 'Scheduled' }], rows, link: { to: '/maintenance', label: 'Open maintenance' } };
  }

  return { intent: 'unknown', answer: 'I can answer questions about trips, bowzers, fuel, approvals, receivables, stock, documents and exceptions. Try one of these:', suggestions: SUGGEST };
}

import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { get, qs } from '../lib/api';
import { fmtDate, fmtDateTime, titleCase, fmtMt } from '../lib/format';
import { useAuth } from '../lib/auth';
import { useDetail } from '../lib/hooks';
import { Button } from '../ui/Button';
import { ErrorState, PageLoader } from '../ui/Feedback';
import { PageHeader } from '../ui/Page';
import { BowzerSelect, ReportTable, money } from '../features/finance';
import { useDriverOptions } from '../features/common';
import { SelectInput } from '../ui/Form';

export default function TripVouchers() {
  const { key = 'trip-start' } = useParams(); const nav = useNavigate(); const [sp, setSp] = useSearchParams(); const { user } = useAuth();
  const list = useQuery({ queryKey: ['/trip-vouchers/reports'], queryFn: () => get('/trip-vouchers/reports'), staleTime: 300_000 });
  const drivers = useDriverOptions();
  const p = (k: string) => sp.get(k) ?? '';
  const setP = (o: Record<string, string>) => setSp((cur) => { const n = new URLSearchParams(cur); for (const [k, v] of Object.entries(o)) v ? n.set(k, v) : n.delete(k); return n; }, { replace: true });
  const params = { from: p('from') || undefined, to: p('to') || undefined, vehicleId: p('vehicleId') || undefined, driverId: p('driverId') || undefined };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/trip-vouchers/reports', key, params], queryFn: () => get(`/trip-vouchers/reports/${key}${qs(params)}`) });
  const groups = [...new Set((list.data?.data ?? []).map((r: any) => r.group))] as string[];
  return <>
    <PageHeader title="Trip Vouchers" subtitle="Trip start, uplifting, expense, tour-stay and completion vouchers — registers you can filter, export and print" breadcrumbs={[{ label: 'Operations' }, { label: 'Trip vouchers' }]} />
    <div className="grid gap-5 lg:grid-cols-[230px_1fr]">
      <nav aria-label="Voucher list" className="space-y-4">{groups.map((g) => <div key={g}><p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</p>
        {(list.data?.data ?? []).filter((r: any) => r.group === g).map((r: any) => <button key={r.key} onClick={() => nav(`/trip-vouchers/${r.key}`)} className={clsx('block w-full rounded-lg px-3 py-2 text-left text-sm', r.key === key ? 'bg-brand-50 font-semibold text-brand-700' : 'hover:bg-slate-100')}>{r.title}</button>)}</div>)}</nav>
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-3 print:hidden">
          <label className="text-xs font-medium text-slate-600">From<input type="date" className="input mt-1" value={p('from')} onChange={(e) => setP({ from: e.target.value })} /></label><label className="text-xs font-medium text-slate-600">To<input type="date" className="input mt-1" value={p('to')} onChange={(e) => setP({ to: e.target.value })} /></label>
          <div className="w-44"><BowzerSelect value={p('vehicleId')} onChange={(v) => setP({ vehicleId: v })} /></div>
          {user?.role !== 'DRIVER' && <div className="w-56"><SelectInput label="Driver" value={p('driverId')} onChange={(e) => setP({ driverId: e.target.value })} placeholder="All drivers" options={(drivers.data?.data ?? []).map((d: any) => ({ value: d.id, label: d.full_name }))} /></div>}
        </div>
        {isLoading ? <PageLoader /> : error || !data ? <ErrorState error={error} onRetry={() => refetch()} /> : <ReportTable report={data} fileName={key} />}
      </div>
    </div>
  </>;
}

/** Printable single-trip voucher: start, uplift, expenses, fuel and completion on one sheet. */
export function TripVoucherPrint() {
  const { id } = useParams(); const { can } = useAuth();
  const { data, isLoading, error, refetch } = useDetail<any>(`/trips/${id}`);
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const { trip: t, expenses = [], fuel = [], economics } = data;
  const km = t.odometer_start != null && t.odometer_end != null ? t.odometer_end - t.odometer_start : null;
  const row = (k: string, v: any) => <div className="flex justify-between gap-4 border-b border-slate-200 py-1 text-sm"><span className="text-slate-500">{k}</span><span className="text-right font-medium">{v ?? '—'}</span></div>;
  const sec = (title: string, children: any) => <section className="mt-5"><h3 className="mb-1 border-b-2 border-slate-800 pb-1 text-sm font-bold uppercase tracking-wide">{title}</h3>{children}</section>;
  return <>
    <div className="mb-3 flex items-center justify-between print:hidden"><Link to={`/trips/${t.id}`} className="text-sm font-medium text-brand-700">← Back to trip</Link><Button variant="primary" onClick={() => window.print()}>Print voucher</Button></div>
    <div className="print-area mx-auto max-w-3xl rounded-xl border border-line bg-white p-6">
      <div className="flex items-start justify-between"><div><p className="text-xl font-bold">GasMan Private Limited</p><p className="text-xs text-slate-500">LPG bowzer transport · demo document, synthetic data</p></div><div className="text-right"><p className="text-sm font-semibold">TRIP VOUCHER</p><p className="text-lg font-bold">{t.code}</p><p className="text-xs text-slate-500">{titleCase(t.trip_type)} · {titleCase(t.status)}</p></div></div>
      {sec('Trip start', <div className="grid gap-x-8 sm:grid-cols-2"><div>{row('Bowzer', `${t.vehicle_code ?? '—'}${t.bowzer_no ? ` (${t.bowzer_no})` : ''}`)}{row('Registration', t.registration_no)}{row('Owner', t.owner_name)}{row('Driver', t.driver_name)}</div>
        <div>{row('Departed', fmtDateTime(t.departed_at))}{row('Meter at start', t.odometer_start?.toLocaleString('en-US'))}{row('Loaded', fmtMt(t.loaded_mt))}{t.trip_type === 'UPLIFTING' && row('Uplift voucher no.', t.uplift_voucher_no)}</div></div>)}
      {sec('Route', <div className="grid gap-x-8 sm:grid-cols-2"><div>{row('From', t.origin_name)}{row('To', t.destination_name)}</div><div>{row('Planned distance', t.distance_km ? `${t.distance_km} km` : '—')}{row('Delivery note', t.delivery_note_no)}</div></div>)}
      {sec('Expense vouchers', <table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Date</th><th>Category</th><th>Details</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
        <tbody>{expenses.map((e: any) => <tr key={e.id} className="border-t border-slate-200"><td className="py-1">{fmtDate(e.incurred_on)}</td><td>{titleCase(e.category)}{e.nights ? ` (${e.nights} nights)` : ''}</td><td className="text-slate-600">{e.description}</td><td className="text-right tabular-nums">{money(e.amount)}</td><td>{titleCase(e.status)}</td></tr>)}
          {!expenses.length && <tr><td colSpan={5} className="py-3 text-center text-slate-500">No expenses recorded.</td></tr>}</tbody>
        <tfoot><tr className="border-t-2 border-slate-800 font-semibold"><td colSpan={3} className="py-1">Total approved</td><td className="text-right tabular-nums">{money(economics?.expensesApproved)}</td><td /></tr></tfoot></table>)}
      {fuel.length > 0 && sec('Fuel', <table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Date</th><th>Station</th><th className="text-right">Litres</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr></thead><tbody>{fuel.map((f: any) => <tr key={f.id} className="border-t border-slate-200"><td className="py-1">{fmtDate(f.fueled_at)}</td><td>{f.station}</td><td className="text-right tabular-nums">{f.litres}</td><td className="text-right tabular-nums">{f.rate_per_l}</td><td className="text-right tabular-nums">{money(f.amount)}</td></tr>)}</tbody></table>)}
      {sec('Trip completion', <div className="grid gap-x-8 sm:grid-cols-2"><div>{row('Arrived', fmtDateTime(t.arrived_at))}{row('Delivered', fmtDateTime(t.delivered_at))}{row('Received by', t.received_by)}{row('Delivered MT', fmtMt(t.delivered_mt))}</div><div>{row('Meter at completion', t.odometer_end?.toLocaleString('en-US'))}{row('Distance run', km != null ? `${km.toLocaleString('en-US')} km` : '—')}{row('Completed', fmtDateTime(t.completed_at))}
        {can('finance:view') && economics && <>{row('Freight income', `PKR ${money(economics.income)}`)}{row('Profit', `PKR ${money(economics.profit)}`)}</>}</div></div>)}
      <div className="mt-10 grid grid-cols-3 gap-8 text-center text-xs text-slate-500"><div className="border-t border-slate-400 pt-1">Driver</div><div className="border-t border-slate-400 pt-1">Dispatcher / Transport manager</div><div className="border-t border-slate-400 pt-1">Accounts</div></div>
    </div>
  </>;
}

import { AlertTriangle, CalendarClock, CheckCircle2, Clock, FileWarning, Fuel, Plus, Route as RouteIcon, ShieldAlert, Truck, UserRound, Wrench } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { DOC_TYPE_LABELS } from '@gasman/shared';
import { useQuery } from '@tanstack/react-query';
import { get, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtEta, fmtNum, fmtPkr, regionLabel, timeAgo } from '../lib/format';
import { useQueryState } from '../lib/hooks';
import { Button } from '../ui/Button';
import { ErrorState, ProgressBar, Skeleton } from '../ui/Feedback';
import { FilterSelect } from '../ui/Form';
import { KpiCard, PageHeader, Section } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { COLORS, DonutChart, HBarChart, LpgLineChart, TripsBarChart } from '../ui/charts';

export default function ControlTower() {
  const { can, user } = useAuth(); const nav = useNavigate();
  const { state, set } = useQueryState({ plant: 'ALL' });
  const plants = useQuery({ queryKey: ['/locations', 'plants'], queryFn: () => get('/locations?type=PLANT&all=1'), staleTime: 300_000 });
  const { data, isLoading, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['/dashboard', state.plant], queryFn: () => get(`/dashboard${qs({ plantId: state.plant })}`), refetchInterval: 20_000, refetchIntervalInBackground: false,
  });
  const k = data?.kpis;
  const vsPrev = k && k.lpgDeliveredPrevMonthMt > 0 ? Math.round(((k.lpgDeliveredMtdMt / Math.max(1, new Date().getDate() / 30)) / k.lpgDeliveredPrevMonthMt - 1) * 100) : null;

  return (
    <>
      <PageHeader title="Operational Control Tower" subtitle={`Real-time command centre for LPG transportation · updated ${timeAgo(new Date(dataUpdatedAt || Date.now()))}`}
        breadcrumbs={[{ label: 'Operations' }, { label: 'Control Tower' }]}
        actions={<>
          <FilterSelect label="Plant" value={state.plant} onChange={(v) => set({ plant: v })} options={[{ value: 'ALL', label: 'All plants' }, ...(plants.data?.data ?? []).map((p: any) => ({ value: String(p.id), label: p.name }))]} />
          {can('trips:create') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => nav('/trips/new')}>Create Trip</Button>}
        </>} />
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard loading={isLoading} label="Active trips" value={k?.activeTrips} hint={`${k?.tripsInTransit ?? 0} moving · ${k?.delayedTrips ?? 0} delayed`} icon={<RouteIcon className="h-5 w-5" />} to="/trips?scope=active" />
            <KpiCard loading={isLoading} label="Pending dispatches" value={k?.pendingDispatches} hint="Planned / assigned" tone="amber" icon={<CalendarClock className="h-5 w-5" />} to={can('trips:assign') ? '/dispatch' : '/trips?scope=upcoming'} />
            <KpiCard loading={isLoading} label="Trips in transit" value={k?.tripsInTransit} hint="Outbound + returning" icon={<Truck className="h-5 w-5" />} to="/tracking" />
            <KpiCard loading={isLoading} label="Delayed trips" value={k?.delayedTrips} hint={`${k?.onHoldTrips ?? 0} on hold`} tone="red" icon={<AlertTriangle className="h-5 w-5" />} to="/trips?status=DELAYED,ON_HOLD" />
            <KpiCard loading={isLoading} label="Vehicles available" value={k?.availableVehicles} hint={`of ${k?.totalFleet ?? 0} fleet (${k?.ownedFleet ?? 0} owned, ${k?.hiredFleet ?? 0} hired)`} tone="green" icon={<Truck className="h-5 w-5" />} to="/fleet?status=AVAILABLE" />
            <KpiCard loading={isLoading} label="Drivers available" value={k?.availableDrivers} hint={`${k?.activeDrivers ?? 0} active · ${k?.driversOnTrip ?? 0} on trip`} tone="purple" icon={<UserRound className="h-5 w-5" />} to="/drivers?status=AVAILABLE" />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                        <KpiCard loading={isLoading} label="Completed today" value={k?.completedToday} hint={`${k?.completedMtd ?? 0} this month`} tone="green" icon={<CheckCircle2 className="h-5 w-5" />} to="/trips?status=COMPLETED" />
            <KpiCard loading={isLoading} label="LPG delivered (MTD)" value={k ? `${fmtNum(Math.round(k.lpgDeliveredMtdMt))} MT` : ''} hint={vsPrev === null ? 'Month to date' : `${vsPrev >= 0 ? '▲' : '▼'} ${Math.abs(vsPrev)}% pace vs last month`} icon={<Fuel className="h-5 w-5" />} to="/reports" />
            <KpiCard loading={isLoading} label="On-time delivery" value={k ? `${k.onTimePct}%` : ''} hint="Last 30 days" tone={k && k.onTimePct < 80 ? 'amber' : 'green'} icon={<Clock className="h-5 w-5" />} />
            <KpiCard loading={isLoading} label="Maintenance due" value={k?.maintenanceDue} hint={`${k?.maintenanceOverdue ?? 0} overdue · ${k?.inMaintenance ?? 0} in workshop`} tone="amber" icon={<Wrench className="h-5 w-5" />} to="/maintenance?due=true" />
            <KpiCard loading={isLoading} label="Documents expiring" value={k?.expiringDocuments} hint={`${k?.expiredDocuments ?? 0} already expired`} tone={k?.expiredDocuments ? 'red' : 'amber'} icon={<FileWarning className="h-5 w-5" />} to="/documents?status=EXPIRED,EXPIRING_SOON" />
            <KpiCard loading={isLoading} label="Open incidents" value={k?.openIncidents} hint={`${k?.seriousIncidents ?? 0} high / critical`} tone={k?.seriousIncidents ? 'red' : 'slate'} icon={<ShieldAlert className="h-5 w-5" />} to="/safety?tab=incidents" />
          </div>

          {data?.finance && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <KpiCard label="Trip income (MTD)" value={fmtPkr(data.finance.incomeMtd)} hint={data.finance.incomePrevMonth ? `Last month ${fmtPkr(data.finance.incomePrevMonth)}` : 'Freight on delivered MT'} tone="green" to="/reports?type=trip-profitability" />
              <KpiCard label="Trip expenses (MTD)" value={fmtPkr(data.finance.expensesMtd)} hint="Approved & reimbursed" tone="red" to="/expenses?status=APPROVED" />
              <KpiCard label="Trip profit (MTD)" value={fmtPkr(data.finance.profitMtd)} hint={data.finance.marginPct == null ? '' : `${data.finance.marginPct}% margin`} tone={data.finance.profitMtd < 0 ? 'red' : 'blue'} to="/reports?type=owner-pnl" />
              <KpiCard label="Expenses awaiting approval" value={data.finance.pendingExpenseCount} hint={fmtPkr(data.finance.pendingExpenseAmount)} tone="amber" to="/approvals" />
              <KpiCard label="Fuel exceptions" value={data.finance.fuelFlagged} hint="Flagged for review" tone={data.finance.fuelFlagged ? 'amber' : 'slate'} to="/fuel?tab=exceptions" />
            </div>
          )}
          {data?.finance?.treasury && (
            <div className="grid gap-3 lg:grid-cols-3">
              <Section title="Bank reserves" subtitle={`Cash in hand PKR ${Math.round(data.finance.treasury.cash).toLocaleString('en-US')}`} actions={<Link to="/finance/accounts?tab=banks" className="text-sm font-medium text-brand-700 hover:underline">Banks</Link>}>
                <ul className="space-y-1.5 text-sm">{data.finance.treasury.banks.map((b: any) => <li key={b.name} className="flex justify-between gap-3"><span className="truncate">{b.name}</span><span className="tabular-nums font-medium">{Math.round(b.balance).toLocaleString('en-US')}</span></li>)}
                  <li className="flex justify-between gap-3 border-t border-line pt-1.5 font-semibold"><span>Total in banks</span><span className="tabular-nums">{data.finance.treasury.bankTotal.toLocaleString('en-US')}</span></li></ul></Section>
              <Section title="Receivables & payables" actions={<Link to="/finance/reports/receivable-aging" className="text-sm font-medium text-brand-700 hover:underline">Aging</Link>}>
                <dl className="space-y-1.5 text-sm"><div className="flex justify-between"><dt>To collect</dt><dd className="tabular-nums font-semibold">PKR {Math.round(data.finance.treasury.receivable).toLocaleString('en-US')}</dd></div>
                  <div className="flex justify-between text-red-700"><dt>Overdue ({data.finance.treasury.overdueInvoices} invoices)</dt><dd className="tabular-nums font-semibold">PKR {Math.round(data.finance.treasury.overdue).toLocaleString('en-US')}</dd></div>
                  <div className="flex justify-between"><dt>To pay vendors</dt><dd className="tabular-nums font-semibold">PKR {Math.round(data.finance.treasury.payable).toLocaleString('en-US')}</dd></div></dl></Section>
              <Section title="Credit watch" subtitle="Customers near or over their limit" actions={<Link to="/customers?tab=parties" className="text-sm font-medium text-brand-700 hover:underline">Customers</Link>}>
                {data.finance.creditWatch.length ? <ul className="space-y-2 text-sm">{data.finance.creditWatch.map((c: any) => <li key={c.id}><Link to={`/distributors/${c.id}`} className="flex justify-between gap-3 hover:underline"><span className="truncate">{c.name}</span><span className={c.pct >= 100 ? 'font-semibold text-red-600' : 'font-semibold text-amber-600'}>{c.pct}%</span></Link></li>)}</ul> : <p className="text-sm text-slate-500">All customers are within their credit limits.</p>}</Section>
            </div>
          )}
          <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
            <Section title="Live trip operations" subtitle="Current movement and assignment status" padded={false} actions={<Link to="/trips?scope=active" className="text-sm font-medium text-brand-700 hover:underline">View all trips</Link>}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead className="bg-slate-50/70"><tr><th className="th">Trip</th><th className="th">Route</th><th className="th">Vehicle / driver</th><th className="th">Progress</th><th className="th">ETA</th><th className="th">Status</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {isLoading && Array.from({ length: 5 }).map((_, i) => <tr key={i}><td className="td" colSpan={6}><Skeleton className="h-5 w-full" /></td></tr>)}
                    {data?.liveTrips.map((t: any) => (
                      <tr key={t.id} className="cursor-pointer hover:bg-brand-50/50" onClick={() => nav(`/trips/${t.id}`)}>
                        <td className="td font-medium text-brand-700">{t.code}</td>
                        <td className="td"><p className="font-medium">{t.destination_name}</p><p className="text-xs text-slate-500">{t.origin_name} →</p></td>
                        <td className="td"><p>{t.vehicle_code}</p><p className="text-xs text-slate-500">{t.driver_name}</p></td>
                        <td className="td w-40"><div className="flex items-center gap-2"><ProgressBar value={Number(t.progress_pct)} tone={t.status === 'DELAYED' ? 'red' : 'blue'} /><span className="text-xs tabular-nums text-slate-600">{Math.round(t.progress_pct)}%</span></div></td>
                        <td className="td text-sm tabular-nums">{['ARRIVED', 'DELIVERED'].includes(t.status) ? '—' : fmtEta(t.eta_at)}</td>
                        <td className="td"><StatusPill status={t.status} /></td>
                      </tr>
                    ))}
                    {data && !data.liveTrips.length && <tr><td className="td py-10 text-center text-slate-500" colSpan={6}>No trips are currently on the road.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Operational alerts" subtitle="Items requiring attention" padded={false}>
              <ul className="divide-y divide-line">
                {data?.alerts.delayedTrips.map((t: any) => <AlertRow key={`d${t.id}`} to={`/trips/${t.id}`} tone="red" tag="Delay" title={`${t.code} to ${t.destination_name}`} sub={`${t.delay_minutes} min behind plan`} />)}
                {data?.alerts.pendingDispatch.map((t: any) => <AlertRow key={`p${t.id}`} to={`/trips/${t.id}`} tone="amber" tag="Dispatch" title={`${t.code} to ${t.destination_name}`} sub={`${t.status === 'ASSIGNED' ? 'Assigned — ready to dispatch' : 'Needs vehicle & driver'} · departs ${fmtDate(t.scheduled_departure)}`} />)}
                {data?.alerts.documents.map((d: any) => (
                  <AlertRow key={`doc${d.id}`} to={d.vehicle_id ? `/fleet/${d.vehicle_id}` : `/drivers/${d.driver_id}`} tone={d.days_left < 0 ? 'red' : 'amber'} tag="Document"
                    title={`${d.vehicle_code ?? d.driver_name}: ${DOC_TYPE_LABELS[d.doc_type] ?? d.doc_type}`} sub={d.days_left < 0 ? `Expired ${Math.abs(d.days_left)} days ago` : `Expires in ${d.days_left} day${d.days_left === 1 ? '' : 's'}`} />
                ))}
                {data?.alerts.maintenance.map((m: any) => <AlertRow key={`m${m.id}`} to={`/fleet/${m.vehicle_id}`} tone={m.days_left < 0 ? 'red' : 'amber'} tag="Maintenance" title={`${m.vehicle_code}: ${m.title}`} sub={m.days_left < 0 ? `Overdue by ${Math.abs(m.days_left)} days` : `Due in ${m.days_left} days`} />)}
                {k?.openIncidents ? <AlertRow to="/safety?tab=incidents" tone="red" tag="Safety" title={`${k.openIncidents} open safety incident${k.openIncidents > 1 ? 's' : ''}`} sub="Review and close out" /> : null}
                {data && !data.alerts.delayedTrips.length && !data.alerts.pendingDispatch.length && !data.alerts.documents.length && !data.alerts.maintenance.length && !k?.openIncidents && <li className="px-5 py-10 text-center text-sm text-slate-500">You’re all caught up.</li>}
                {isLoading && <li className="space-y-3 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></li>}
              </ul>
            </Section>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Trips completed — last 14 days" subtitle="Punctuality: late = arrived > 15 min after plan">{isLoading ? <Skeleton className="h-60" /> : <TripsBarChart data={data.charts.tripsByDay} />}</Section>
            <Section title="LPG delivered per day (MT)" subtitle="Completed trips, last 14 days">{isLoading ? <Skeleton className="h-60" /> : <LpgLineChart data={data.charts.tripsByDay} />}</Section>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <Section title="Fleet status">{isLoading ? <Skeleton className="h-52" /> : (
              <>
                <DonutChart data={data.fleetBreakdown} colors={[COLORS.blue, COLORS.green, COLORS.amber, COLORS.slate]} />
                <ul className="mt-2 grid grid-cols-2 gap-2 text-xs">{data.fleetBreakdown.map((d: any, i: number) => <li key={d.name} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: [COLORS.blue, COLORS.green, COLORS.amber, COLORS.slate][i] }} />{d.name} <b className="ml-auto tabular-nums">{d.value}</b></li>)}</ul>
              </>)}</Section>
            <Section title="Top destinations (30 days)" subtitle="LPG delivered, MT">{isLoading ? <Skeleton className="h-52" /> : <HBarChart data={data.charts.topDestinations.map((d: any) => ({ name: d.name.length > 22 ? d.name.slice(0, 21) + '…' : d.name, mt: d.mt }))} />}</Section>
            <Section title="Deliveries by region (30 days)" subtitle="Share of LPG delivered">{isLoading ? <Skeleton className="h-52" /> : (
              <ul className="space-y-3">{(() => { const tot = data.charts.byRegion.reduce((s: number, r: any) => s + r.mt, 0) || 1; return data.charts.byRegion.map((r: any) => (
                <li key={r.region}><div className="mb-1 flex justify-between text-sm"><span className="font-medium">{regionLabel(r.region)}</span><span className="tabular-nums text-slate-600">{r.mt.toFixed(0)} MT · {r.trips} trips</span></div><ProgressBar value={(r.mt / tot) * 100} /></li>)); })()}
                {!data.charts.byRegion.length && <li className="text-sm text-slate-500">No deliveries in the last 30 days.</li>}</ul>)}
              {data && <div className="mt-5 border-t border-line pt-3 text-xs text-slate-500"><p className="mb-1 font-semibold text-slate-700">By origin plant</p>{data.charts.plantShare.map((p: any) => <p key={p.name} className="flex justify-between"><span>{p.name}</span><span className="tabular-nums">{p.mt.toFixed(0)} MT · {p.trips} trips</span></p>)}</div>}
            </Section>
          </div>
        </div>
      )}
      <span className="sr-only" role="status">{user?.name}</span>
    </>
  );
}

function AlertRow({ to, tone, tag, title, sub }: { to: string; tone: 'red' | 'amber'; tag: string; title: string; sub: string }) {
  return (
    <li><Link to={to} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50">
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone === 'red' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}><AlertTriangle className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{title}</span><span className="block truncate text-xs text-slate-500">{sub}</span></span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{tag}</span>
    </Link></li>
  );
}

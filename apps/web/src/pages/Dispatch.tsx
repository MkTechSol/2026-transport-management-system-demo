import { AlertTriangle, FileWarning, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { allowedTransitions, TripStatus } from '@gasman/shared';
import { get, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtEta, fmtMt, fmtShortDateTime } from '../lib/format';
import { useQueryState } from '../lib/hooks';
import { Skeleton } from '../ui/Feedback';
import { FilterSelect } from '../ui/Form';
import { PageHeader } from '../ui/Page';
import { Pill, StatusPill } from '../ui/Pill';
import { SearchInput } from '../ui/Table';
import { ProgressBar } from '../ui/Feedback';
import { usePlants } from '../features/common';
import { TripActionBar } from '../features/trip';

const COLS = [
  { key: 'UNASSIGNED', title: 'Unassigned', hint: 'Draft & planned', tone: 'bg-amber-100 text-amber-800' },
  { key: 'READY', title: 'Ready to dispatch', hint: 'Assigned', tone: 'bg-violet-100 text-violet-800' },
  { key: 'DISPATCHED', title: 'Dispatched', hint: 'Awaiting departure', tone: 'bg-teal-100 text-teal-800' },
  { key: 'IN_TRANSIT', title: 'On the road', hint: 'In transit · delayed · on hold', tone: 'bg-blue-100 text-blue-800' },
  { key: 'ARRIVED', title: 'Arrived / returning', hint: 'Delivery & return', tone: 'bg-green-100 text-green-800' },
];

export default function Dispatch() {
  const { user, can } = useAuth(); const { state, set } = useQueryState(); const plants = usePlants();
  const { data, isLoading, refetch } = useQuery({ queryKey: ['/trips', 'board', state.plantId, state.q], queryFn: () => get(`/trips/board${qs({ plantId: state.plantId, q: state.q })}`), refetchInterval: 15_000, placeholderData: (p) => p });
  const dash = useQuery({ queryKey: ['/dashboard', 'ALL'], queryFn: () => get('/dashboard'), refetchInterval: 30_000 });
  const k = dash.data?.kpis;
  return (
    <>
      <PageHeader title="Dispatch Control Center" subtitle="Assign, dispatch and monitor trips from one board" breadcrumbs={[{ label: 'Operations' }, { label: 'Dispatch' }]}
        actions={<><SearchInput className="w-56" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search board…" />
          <FilterSelect label="Plant" value={state.plantId ?? 'ALL'} onChange={(v) => set({ plantId: v })} options={[{ value: 'ALL', label: 'All plants' }, ...(plants.data?.data ?? []).filter((p: any) => p.type === 'PLANT').map((p: any) => ({ value: String(p.id), label: p.name }))]} /></>} />
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Chip to="/trips?scope=upcoming" tone="amber" icon={<AlertTriangle className="h-4 w-4" />} label="Pending dispatches" value={k?.pendingDispatches} />
        <Chip to="/trips?status=DELAYED,ON_HOLD" tone="red" icon={<AlertTriangle className="h-4 w-4" />} label="Delayed / on hold" value={k ? k.delayedTrips + k.onHoldTrips : undefined} />
        <Chip to="/documents?status=EXPIRED,EXPIRING_SOON" tone="red" icon={<FileWarning className="h-4 w-4" />} label="Documents expired / expiring" value={k ? k.expiredDocuments + k.expiringDocuments : undefined} />
        <Chip to="/maintenance" tone="amber" icon={<Wrench className="h-4 w-4" />} label="Vehicles in maintenance" value={k?.vehiclesInMaintenance} />
      </div>
      <div className="flex gap-3 overflow-x-auto pb-3">
        {COLS.map((c) => {
          const col = data?.columns?.[c.key];
          return (
            <section key={c.key} className="flex min-h-[22rem] w-[19rem] shrink-0 flex-col rounded-xl border border-line bg-slate-100/60" aria-label={c.title}>
              <header className="flex items-center justify-between px-3 py-2.5"><div><h2 className="text-sm font-semibold">{c.title}</h2><p className="text-[11px] text-slate-500">{c.hint}</p></div><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${c.tone}`}>{col?.total ?? 0}</span></header>
              <div className="flex-1 space-y-2.5 overflow-y-auto px-2.5 pb-3">
                {isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
                {col?.items.map((t: any) => {
                  const fwd = allowedTransitions(t.status as TripStatus, user!.role).filter((x) => !['ON_HOLD', 'CANCELLED', 'ASSIGNED', 'PLANNED', 'DELAYED'].includes(x.to) && !(t.status === 'DELAYED' && x.to === 'IN_TRANSIT')).slice(0, 1).map((x) => ({ to: x.to, label: x.label }));
                  const actions = t.status === 'DRAFT' ? [{ to: 'PLANNED' as TripStatus, label: 'Confirm plan' }] : fwd;
                  return (
                    <article key={t.id} className="card p-3">
                      <div className="mb-1.5 flex items-start justify-between gap-2"><Link to={`/trips/${t.id}`} className="text-sm font-semibold text-brand-700 hover:underline">{t.code}</Link><StatusPill status={t.status} /></div>
                      <p className="text-sm font-medium">{t.stop_count > 1 ? t.stops_label : t.destination_name}{t.stop_count > 1 && <span className="ml-1 text-[11px] font-semibold text-brand-700">({t.stops_done ?? 0}/{t.stop_count})</span>}</p>
                      <p className="text-xs text-slate-500">{t.origin_name} · {fmtMt(t.planned_load_mt)}{t.priority !== 'NORMAL' && <Pill tone="red" dot={false} className="ml-1.5">{t.priority}</Pill>}</p>
                      {t.vehicle_code ? <p className="mt-1.5 text-xs text-slate-600">{t.vehicle_code} · {t.driver_name}</p> : <p className="mt-1.5 text-xs italic text-amber-700">No vehicle / driver</p>}
                      {['IN_TRANSIT', 'DELAYED', 'ON_HOLD', 'RETURNING'].includes(t.status)
                        ? <div className="mt-2"><div className="flex items-center gap-2"><ProgressBar value={Number(t.progress_pct)} tone={t.status === 'DELAYED' ? 'red' : 'blue'} /><span className="text-[11px] tabular-nums text-slate-500">{Math.round(t.progress_pct)}%</span></div><p className="mt-1 text-[11px] text-slate-500">ETA {fmtEta(t.eta_at)} · {t.cur_speed_kmh ?? 0} km/h</p></div>
                        : <p className="mt-1.5 text-[11px] text-slate-500">Departs {fmtShortDateTime(t.scheduled_departure)}</p>}
                      {(can('trips:assign', 'trips:dispatch', 'trips:progress')) && (
                        <div className="mt-2.5 border-t border-line pt-2.5"><TripActionBar size="sm" trip={t} actions={actions} hasPassedPretrip={undefined} onChanged={() => refetch()} /></div>
                      )}
                    </article>
                  );
                })}
                {col && !col.items.length && <p className="px-2 py-8 text-center text-xs text-slate-400">Nothing here</p>}
                {col && col.total > col.items.length && <Link to="/trips" className="block py-1 text-center text-xs font-medium text-brand-700">+{col.total - col.items.length} more — open trip list</Link>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function Chip({ to, tone, icon, label, value }: any) {
  const c = tone === 'red' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900';
  return <Link to={to} className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${c}`}>{icon}<span className="flex-1 text-sm font-medium">{label}</span><span className="text-lg font-bold tabular-nums">{value ?? '–'}</span></Link>;
}

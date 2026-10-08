import clsx from 'clsx';
import { Gauge, MapPin, Radio } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api';
import { fmtDuration, fmtEta, fmtShortDateTime, timeAgo } from '../lib/format';
import { EmptyState, ErrorState, PageLoader, ProgressBar } from '../ui/Feedback';
import { PageHeader, Section, KV, KVGrid } from '../ui/Page';
import { Pill, StatusPill } from '../ui/Pill';
import { SearchInput } from '../ui/Table';
import { MapView, MapMarker } from '../map/MapView';

const tone = (r: any) => (r.status === 'DELAYED' ? 'red' : r.status === 'ON_HOLD' ? 'amber' : r.status === 'RETURNING' ? 'purple' : (r.speed_kmh ?? 0) < 3 ? 'slate' : 'blue');

export default function Tracking() {
  const [sel, setSel] = useState<number | null>(null); const [q, setQ] = useState(''); const [filter, setFilter] = useState<'all' | 'moving' | 'delayed' | 'stopped'>('all');
  const live = useQuery({ queryKey: ['/tracking', 'live'], queryFn: () => get('/tracking/live'), refetchInterval: 5000 });
  const rows: any[] = live.data?.data ?? [];
  const list = useMemo(() => rows.filter((r) => {
    if (q && !`${r.vehicle_code} ${r.trip_code} ${r.driver_name} ${r.destination_name}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === 'moving') return (r.speed_kmh ?? 0) > 3; if (filter === 'delayed') return r.status === 'DELAYED'; if (filter === 'stopped') return (r.speed_kmh ?? 0) <= 3; return true;
  }), [rows, q, filter]);
  const selected = rows.find((r) => r.trip_id === sel) ?? null;
  const detail = useQuery({ queryKey: ['/tracking', 'trip', sel], queryFn: () => get(`/tracking/trips/${sel}`), enabled: !!sel, refetchInterval: 5000 });
  const markers: MapMarker[] = list.map((r) => ({ id: r.trip_id, lat: r.lat, lng: r.lng, tone: tone(r) as any, selected: r.trip_id === sel, label: r.vehicle_code, tooltip: `${r.vehicle_code} · ${r.speed_kmh ?? 0} km/h · ${r.destination_name}`, onClick: () => setSel(r.trip_id) }));
  const routes: any[] = [];
  if (selected) {
    markers.push({ id: 'o', lat: selected.origin_lat, lng: selected.origin_lng, kind: 'plant', tone: 'green', label: selected.origin_name }, { id: 'd', lat: selected.dest_lat, lng: selected.dest_lng, kind: 'pin', tone: 'red', label: selected.destination_name });
    if (detail.data?.path?.length) routes.push({ id: 'path', path: detail.data.path, color: '#94a3b8', dashed: true });
    if (detail.data?.trail?.length > 1) routes.push({ id: 'trail', path: detail.data.trail.map((p: any) => [p.lat, p.lng]), color: '#2563eb', weight: 5 });
  }
  const s = live.data?.summary;
  const remainingKm = selected && detail.data ? Math.round(Number(detail.data.trip ? 0 : 0)) : 0; void remainingKm;
  return (
    <>
      <PageHeader title="Live Tracking Control Center" subtitle="Vehicles currently dispatched or on the road" breadcrumbs={[{ label: 'Operations' }, { label: 'Live tracking' }]}
        actions={<span className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-xs font-medium text-slate-600"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" /></span>Simulated GPS · refreshed {timeAgo(live.dataUpdatedAt ? new Date(live.dataUpdatedAt) : null)}</span>} />
      {live.isLoading && <PageLoader />}
      {live.error && <ErrorState error={live.error} onRetry={() => live.refetch()} />}
      {live.data && (
        <>
          <div className="mb-4 flex flex-wrap gap-2 text-sm">
            <Chip active={filter === 'all'} onClick={() => setFilter('all')}>All <b>{s.total}</b></Chip><Chip active={filter === 'moving'} onClick={() => setFilter('moving')}>Moving <b>{s.moving}</b></Chip>
            <Chip active={filter === 'stopped'} onClick={() => setFilter('stopped')}>Stopped <b>{s.stopped}</b></Chip><Chip active={filter === 'delayed'} tone="red" onClick={() => setFilter('delayed')}>Delayed <b>{s.delayed}</b></Chip>
          </div>
          {!rows.length ? <EmptyState icon={<Radio className="h-6 w-6" />} title="No vehicles are on the road" description="Dispatch a trip to see its vehicle appear here." /> : (
            <div className="grid gap-4 xl:grid-cols-[320px_1fr_330px]">
              <Section title="Vehicles" padded={false} className="max-h-[640px] overflow-hidden xl:order-1">
                <div className="border-b border-line p-3"><SearchInput value={q} onChange={setQ} placeholder="Search vehicle, trip, driver…" /></div>
                <ul className="max-h-[560px] divide-y divide-line overflow-y-auto" role="listbox" aria-label="Vehicles">
                  {list.map((r) => (
                    <li key={r.trip_id}><button role="option" aria-selected={r.trip_id === sel} onClick={() => setSel(r.trip_id)} className={clsx('flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50', r.trip_id === sel && 'bg-brand-50')}>
                      <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white', { blue: 'bg-blue-600', red: 'bg-red-600', amber: 'bg-amber-600', purple: 'bg-violet-600', slate: 'bg-slate-500' }[tone(r) as 'blue'])}><Gauge className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1"><span className="flex items-center justify-between"><b className="text-sm">{r.vehicle_code}</b><span className="text-xs tabular-nums text-slate-500">{r.speed_kmh ?? 0} km/h</span></span><span className="block truncate text-xs text-slate-500">{r.driver_name} · {r.trip_code}</span><span className="block truncate text-xs text-slate-500">→ {r.destination_name}</span></span>
                    </button></li>
                  ))}
                  {!list.length && <li className="px-4 py-10 text-center text-sm text-slate-500">No vehicles match.</li>}
                </ul>
              </Section>
              <div className="xl:order-2"><MapView height={640} markers={markers} routes={routes} fitKey={sel ? `s${sel}` : `all${filter}${q}`} followId={sel ?? undefined} className="overflow-hidden rounded-xl border border-line shadow-card" /></div>
              <Section title="Selected vehicle" subtitle="Live operational position" className="xl:order-3 self-start">
                {!selected ? <p className="text-sm text-slate-500">Select a vehicle on the map or from the list to see speed, ETA and route status.</p> : (
                  <div className="space-y-4">
                    <div className="rounded-lg bg-brand-50 p-3"><div className="flex items-center justify-between"><b>{selected.vehicle_code}</b><StatusPill status={selected.status} /></div><p className="text-xs text-slate-600">{selected.driver_name} · <Link className="font-semibold text-brand-700" to={`/trips/${selected.trip_id}`}>{selected.trip_code}</Link></p></div>
                    <div><div className="mb-1 flex justify-between text-xs text-slate-500"><span>{selected.origin_name}</span><span>{selected.destination_name}</span></div><ProgressBar value={Number(selected.progress_pct)} tone={selected.status === 'DELAYED' ? 'red' : 'blue'} /><p className="mt-1 text-right text-xs font-medium tabular-nums">{Math.round(selected.progress_pct)}%</p></div>
                    <KVGrid cols={2}><KV label="Speed">{selected.speed_kmh ?? 0} km/h</KV><KV label="Last update">{timeAgo(selected.last_position_at)}</KV><KV label="ETA">{['ARRIVED', 'DELIVERED'].includes(selected.status) ? 'Arrived' : fmtEta(selected.eta_at)}</KV><KV label="Planned arrival">{fmtShortDateTime(selected.planned_arrival)}</KV></KVGrid>
                    {selected.delay_minutes > 0 && <Pill tone="red">{selected.delay_minutes} min delay</Pill>}
                    {selected.status === 'ON_HOLD' && <Pill tone="amber">On hold — vehicle halted</Pill>}
                    <p className="flex items-start gap-2 text-xs text-slate-500"><MapPin className="mt-0.5 h-3.5 w-3.5" />{selected.lat.toFixed(4)}, {selected.lng.toFixed(4)} · Positions are simulated in the demo; production uses the driver app / GPS devices.</p>
                    <p className="text-xs text-slate-400">Time to destination ≈ {fmtDuration(Math.max(0, (new Date(selected.eta_at).getTime() - Date.now()) / 60000))}</p>
                  </div>
                )}
              </Section>
            </div>
          )}
        </>
      )}
    </>
  );
}
const Chip = ({ active, onClick, children, tone }: any) => <button onClick={onClick} className={clsx('rounded-full border px-3.5 py-1.5', active ? (tone === 'red' ? 'border-red-600 bg-red-600 text-white' : 'border-brand-600 bg-brand-600 text-white') : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>{children}</button>;

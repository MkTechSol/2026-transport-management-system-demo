import { useQuery } from '@tanstack/react-query';
import { MapPin, Truck } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { get } from '../lib/api';
import { fmtEta, fmtShortDateTime, timeAgo } from '../lib/format';
import { EmptyState, PageLoader, ProgressBar } from '../ui/Feedback';
import { StatusPill } from '../ui/Pill';
import { MapView } from '../map/MapView';

/** Public, read-only customer tracking page (no sign-in). Shows only non-sensitive trip information. */
export default function Track() {
  const { token } = useParams();
  const { data, isLoading, error } = useQuery({ queryKey: ['/public/track', token], queryFn: () => get(`/public/track/${token}`), refetchInterval: 15_000, retry: false });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <div className="mx-auto max-w-md px-4 py-20"><EmptyState icon={<MapPin className="h-6 w-6" />} title="Tracking link not found" description="This link is invalid, expired, or the trip is not yet dispatched." /></div>;
  const t = data.trip; const live = t.cur_lat != null && ['DISPATCHED', 'IN_TRANSIT', 'DELAYED', 'ON_HOLD', 'ARRIVED', 'RETURNING'].includes(t.status);
  const markers: any[] = [{ id: 'o', lat: t.origin_lat, lng: t.origin_lng, kind: 'plant', tone: 'green', label: t.origin_name }, { id: 'd', lat: t.dest_lat, lng: t.dest_lng, kind: 'pin', tone: 'red', label: t.destination_name }];
  if (live) markers.push({ id: 'v', lat: t.cur_lat, lng: t.cur_lng, tone: t.status === 'DELAYED' ? 'red' : 'blue', selected: true, label: t.vehicle_code });
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-5 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-900 text-sm font-extrabold text-white">GM</div><div><p className="text-lg font-bold leading-tight">GASMAN</p><p className="text-xs uppercase tracking-widest text-slate-500">Shipment tracking</p></div></header>
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-xl font-semibold">{t.code}</h1><StatusPill status={t.status} /></div>
        <p className="mt-1 text-sm text-slate-600"><b>{t.origin_name}</b> → <b>{t.destination_name}</b></p>
        {['IN_TRANSIT', 'DELAYED', 'RETURNING'].includes(t.status) && <div className="mt-4"><ProgressBar value={Number(t.progress_pct)} tone={t.status === 'DELAYED' ? 'red' : 'blue'} /><div className="mt-2 flex flex-wrap justify-between gap-2 text-sm text-slate-600"><span>{Math.round(t.progress_pct)}% of the route</span><span>ETA <b>{fmtEta(t.eta_at)}</b></span><span>Updated {timeAgo(t.last_position_at)}</span></div></div>}
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4"><div><dt className="text-xs text-slate-500">Vehicle</dt><dd className="font-medium">{t.vehicle_code ?? '—'}</dd></div><div><dt className="text-xs text-slate-500">Planned load</dt><dd className="font-medium">{t.planned_load_mt} MT</dd></div><div><dt className="text-xs text-slate-500">Departure</dt><dd className="font-medium">{fmtShortDateTime(t.scheduled_departure)}</dd></div><div><dt className="text-xs text-slate-500">Planned arrival</dt><dd className="font-medium">{fmtShortDateTime(t.planned_arrival)}</dd></div></dl>
      </div>
      <div className="card mt-4 overflow-hidden p-2"><MapView height={340} markers={markers} routes={t.path ? [{ id: 'p', path: t.path, color: '#94a3b8', dashed: true }] : []} fitKey={token} /></div>
      <div className="card mt-4 p-5"><h2 className="mb-3 text-sm font-semibold">Progress</h2>
        <ol className="space-y-3 border-l border-line pl-5">{data.events.map((e: any, i: number) => <li key={i} className="relative"><span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-600" /><p className="text-sm font-medium">{e.text}</p><p className="text-xs text-slate-500">{fmtShortDateTime(e.at)}</p></li>)}{!data.events.length && <li className="text-sm text-slate-500">No updates yet.</li>}</ol></div>
      <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-slate-400"><Truck className="h-3.5 w-3.5" />Live position is simulated in this demonstration.</p>
    </div>
  );
}

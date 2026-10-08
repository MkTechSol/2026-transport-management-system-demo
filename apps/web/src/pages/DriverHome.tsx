import { AlertTriangle, ChevronRight, MapPin, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { allowedTransitions, DOC_TYPE_LABELS, TripStatus } from '@gasman/shared';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtEta, fmtMt, fmtShortDateTime } from '../lib/format';
import { Button } from '../ui/Button';
import { Alert, EmptyState, ErrorState, PageLoader, ProgressBar } from '../ui/Feedback';
import { StatusPill } from '../ui/Pill';
import { IncidentModal } from '../features/forms';
import { TripActionBar } from '../features/trip';
import { StopsPanel } from '../features/TripStops';

export default function DriverHome() {
  const { user } = useAuth(); const [inc, setInc] = useState<any>(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/me', 'home'], queryFn: () => get('/me/home'), refetchInterval: 15_000 });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const { driver, activeTrips, upcomingTrips, documents, recentTrips } = data;
  const docIssues = documents.filter((d: any) => d.status !== 'ACTIVE');
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div><h1 className="text-2xl font-semibold">Hello, {user?.name.split(' ')[0]}</h1><p className="text-sm text-slate-500">{driver ? `${driver.employee_id} · ${driver.home_plant_name ?? ''} · safety score ${driver.safety_score}` : 'No driver profile is linked to this account.'}</p></div>
      {docIssues.map((d: any) => <Alert key={d.id} tone={d.status === 'EXPIRED' ? 'danger' : 'warning'} title={`${DOC_TYPE_LABELS[d.doc_type]} ${d.status === 'EXPIRED' ? 'expired' : `expires in ${d.days_left} days`}`}>Renew before {fmtDate(d.expires_on)} to keep receiving trips.</Alert>)}
      <section aria-label="Active trip">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Active trip</h2>
        {!activeTrips.length && <EmptyState icon={<MapPin className="h-6 w-6" />} title="No active trip" description="Your next assigned trip will appear here once it is dispatched." />}
        {activeTrips.map((t: any) => {
          const actions = allowedTransitions(t.status as TripStatus, 'DRIVER').map((x) => ({ to: x.to, label: x.label }));
          return (
            <article key={t.id} className="card mb-3 overflow-hidden">
              <div className="border-b border-line bg-brand-50/60 px-4 py-3"><div className="flex items-center justify-between"><Link to={`/trips/${t.id}`} className="font-semibold text-brand-700">{t.code}</Link><StatusPill status={t.status} /></div></div>
              <div className="space-y-3 p-4">
                <div><p className="text-xs text-slate-500">From</p><p className="font-medium">{t.origin_name}</p><p className="my-1 text-slate-300">↓</p><p className="text-xs text-slate-500">{t.stop_count > 1 ? `${t.stop_count} delivery stops` : 'To'}</p><p className="text-lg font-semibold">{t.destination_name}</p><p className="text-sm text-slate-600">{t.distributor_name}</p></div>
                <div className="grid grid-cols-3 gap-2 text-center"><M label="Load" value={fmtMt(t.loaded_mt ?? t.planned_load_mt)} /><M label="Vehicle" value={t.vehicle_code} /><M label="ETA" value={['ARRIVED', 'DELIVERED'].includes(t.status) ? '—' : fmtEta(t.eta_at)} /></div>
                {['IN_TRANSIT', 'DELAYED', 'RETURNING'].includes(t.status) && <div><ProgressBar value={Number(t.progress_pct)} tone={t.status === 'DELAYED' ? 'red' : 'blue'} /><p className="mt-1 text-right text-xs text-slate-500">{Math.round(t.progress_pct)}% · {t.cur_speed_kmh ?? 0} km/h</p></div>}
                {t.stop_count > 1 && <StopsPanel trip={t} stops={t.stops} compact onChanged={() => refetch()} />}
                <TripActionBar trip={{ ...t }} actions={actions} onChanged={() => refetch()} />
                <Button variant="ghost" className="text-red-600" icon={<ShieldAlert className="h-4 w-4" />} onClick={() => setInc(t)}>Report incident on this trip</Button>
              </div>
            </article>
          );
        })}
      </section>
      <section aria-label="Upcoming trips"><h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Upcoming</h2>
        <div className="space-y-2">{upcomingTrips.map((t: any) => <Link key={t.id} to={`/trips/${t.id}`} className="card flex items-center justify-between p-4"><div><p className="font-semibold">{t.code} → {t.destination_name}</p><p className="text-xs text-slate-500">{t.vehicle_code} · {fmtMt(t.planned_load_mt)} · departs {fmtShortDateTime(t.scheduled_departure)}</p></div><ChevronRight className="h-5 w-5 text-slate-400" /></Link>)}
          {!upcomingTrips.length && <p className="text-sm text-slate-500">No upcoming assignments.</p>}</div></section>
      <section aria-label="Recent trips"><h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Recently completed</h2>
        <div className="space-y-2">{recentTrips.map((t: any) => <Link key={t.id} to={`/trips/${t.id}`} className="card flex items-center justify-between p-3 text-sm"><span>{t.code} → {t.destination_name}</span><span className="text-slate-500">{fmtMt(t.delivered_mt)}</span></Link>)}</div></section>
      <Button variant="danger" className="w-full py-3" icon={<AlertTriangle className="h-4 w-4" />} onClick={() => setInc({})}>Report a safety incident</Button>
      {inc && <IncidentModal tripId={inc.id} onClose={() => setInc(null)} />}
    </div>
  );
}
const M = ({ label, value }: any) => <div className="rounded-lg bg-slate-50 px-2 py-2"><p className="text-[11px] text-slate-500">{label}</p><p className="text-sm font-semibold">{value}</p></div>;

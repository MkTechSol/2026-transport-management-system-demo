import { AlertTriangle, ArrowLeft, Building2, Pencil, Phone, ShieldCheck, Truck, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MOVING_STATUSES, TRIP_STEPPER, TripStatus, TRIP_STATUS_LABELS } from '@gasman/shared';
import { get, patch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, fmtDuration, fmtEta, fmtMt, fmtShortDateTime, regionLabel, timeAgo, toLocalInput } from '../lib/format';
import { fieldErrors, useAction, useDetail } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert, ErrorState, PageLoader, ProgressBar, EmptyState } from '../ui/Feedback';
import { SelectInput, TextArea, TextInput } from '../ui/Form';
import { Modal } from '../ui/Overlay';
import { KV, KVGrid, Section, Stepper, Tabs, Breadcrumbs } from '../ui/Page';
import { Pill, StatusPill } from '../ui/Pill';
import { MapView } from '../map/MapView';
import { TripActionBar, TRIP_INVALIDATE } from '../features/trip';

const TABS = [{ key: 'overview', label: 'Overview' }, { key: 'tracking', label: 'Tracking' }, { key: 'resources', label: 'Vehicle & driver' }, { key: 'delivery', label: 'Load & delivery' }, { key: 'safety', label: 'Safety checks' }, { key: 'activity', label: 'Activity' }];

export default function TripDetail() {
  const { id } = useParams(); const nav = useNavigate(); const { can } = useAuth();
  const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') ?? 'overview';
  const [edit, setEdit] = useState(false);
  const { data, isLoading, error, refetch } = useDetail<any>(`/trips/${id}`, { refetchInterval: 8000 });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <><Link to="/trips" className="mb-3 inline-flex items-center gap-1 text-sm text-brand-700"><ArrowLeft className="h-4 w-4" />Back to trips</Link><ErrorState error={error} onRetry={() => refetch()} /></>;
  const { trip: t, events, checks, actions } = data;
  const status = t.status as TripStatus;
  const base: TripStatus = status === 'DELAYED' ? 'IN_TRANSIT' : status === 'ON_HOLD' ? (t.status_before_hold ?? 'PLANNED') : status;
  const idx = Math.max(0, TRIP_STEPPER.indexOf(base));
  const passed = checks.some((c: any) => c.kind === 'PRE_TRIP' && c.result === 'PASS');
  const moving = (MOVING_STATUSES as string[]).includes(status);
  const editable = can('trips:update') && ['DRAFT', 'PLANNED', 'ASSIGNED'].includes(status);
  return (
    <>
      <Breadcrumbs items={[{ label: 'Operations' }, { label: 'Trips', to: '/trips' }, { label: t.code }]} />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold">{t.code}</h1><StatusPill status={status} />{t.priority !== 'NORMAL' && <Pill tone={t.priority === 'LOW' ? 'slate' : 'red'} dot={false}>{t.priority} priority</Pill>}{t.lpg_source === 'IMPORTED' && <Pill tone="purple" dot={false}>Imported LPG</Pill>}</div>
          <p className="mt-1 text-sm text-slate-600">{t.distributor_name ?? t.destination_name} · <b>{t.origin_name}</b> → <b>{t.destination_name}</b> ({regionLabel(t.destination_region)})</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)}>Edit</Button>}
          <TripActionBar trip={t} actions={actions} hasPassedPretrip={passed} onChanged={() => refetch()} autoAssign={sp.get('assign') === '1'} />
        </div>
      </div>

      {status === 'CANCELLED' && <Alert tone="warning" title="This trip was cancelled" className="mb-4">{t.cancel_reason}</Alert>}
      {status === 'ON_HOLD' && <Alert tone="warning" title="Trip on hold" className="mb-4">{t.hold_reason}. Resume it from the actions above when cleared.</Alert>}
      {status === 'DELAYED' && <Alert tone="danger" title="Trip is delayed" className="mb-4">Projected arrival {fmtShortDateTime(t.eta_at)} versus planned {fmtShortDateTime(t.planned_arrival)}.</Alert>}
      {status === 'DISPATCHED' && !passed && <Alert tone="info" className="mb-4" title="Waiting for pre-trip safety check">The driver (or dispatcher) must record a passed pre-trip check before the trip can start.</Alert>}

      {status !== 'CANCELLED' && <div className="card mb-5 px-3 py-5"><Stepper steps={TRIP_STEPPER.map((k) => ({ key: k, label: TRIP_STATUS_LABELS[k] }))} current={status === 'COMPLETED' ? TRIP_STEPPER.length : idx} /></div>}

      {(moving || ['ARRIVED', 'DISPATCHED'].includes(status)) && t.last_position_at && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={status === 'RETURNING' ? 'Return progress' : 'Route progress'} value={`${Math.round(t.progress_pct)}%`}><ProgressBar value={Number(t.progress_pct)} tone={status === 'DELAYED' ? 'red' : 'blue'} className="mt-2" /></Stat>
          <Stat label="Speed" value={`${t.cur_speed_kmh ?? 0} km/h`} />
          <Stat label="ETA" value={t.eta_at ? fmtEta(t.eta_at) : '—'} sub={t.eta_at ? fmtShortDateTime(t.eta_at) : undefined} />
          <Stat label="Last update" value={timeAgo(t.last_position_at)} sub="Simulated GPS (demo)" />
        </div>
      )}

      <Tabs tabs={TABS.map((x) => (x.key === 'safety' ? { ...x, count: checks.length } : x))} value={tab} onChange={(k) => setSp((p) => { const n = new URLSearchParams(p); n.set('tab', k); n.delete('assign'); return n; }, { replace: true })} />
      {tab === 'overview' && <Overview t={t} />}
      {tab === 'tracking' && <TrackingTab t={t} moving={moving} />}
      {tab === 'resources' && <Resources t={t} nav={nav} />}
      {tab === 'delivery' && <Delivery t={t} />}
      {tab === 'safety' && <SafetyTab checks={checks} />}
      {tab === 'activity' && <Activity events={events} />}
      {edit && <EditTrip t={t} onClose={() => setEdit(false)} />}
    </>
  );
}

const Stat = ({ label, value, sub, children }: any) => <div className="card p-4"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>{sub && <p className="text-xs text-slate-500">{sub}</p>}{children}</div>;

function Overview({ t }: { t: any }) {
  const times: [string, any][] = [['Scheduled departure', t.scheduled_departure], ['Dispatched', t.dispatched_at], ['Departed', t.departed_at], ['Planned arrival', t.planned_arrival], ['Arrived', t.arrived_at], ['Delivered', t.delivered_at], ['Return started', t.return_started_at], ['Completed', t.completed_at]];
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Section title="Trip details">
        <KVGrid cols={2}>
          <KV label="Origin">{t.origin_name}<span className="block text-xs text-slate-500">{t.origin_city}</span></KV>
          <KV label="Destination">{t.destination_name}<span className="block text-xs text-slate-500">{t.destination_city} · {regionLabel(t.destination_region)}</span></KV>
          <KV label="Distributor">{t.distributor_id ? <Link className="text-brand-700 hover:underline" to={`/distributors/${t.distributor_id}`}>{t.distributor_name}</Link> : '—'}</KV>
          <KV label="Route">{t.distance_km ? `${t.distance_km} km · ~${fmtDuration(t.est_duration_min)}` : '—'}</KV>
          <KV label="LPG source">{t.lpg_source === 'LOCAL' ? 'Local' : 'Imported'}</KV><KV label="Planned load">{fmtMt(t.planned_load_mt)}</KV>
          <KV label="Loaded">{fmtMt(t.loaded_mt)}</KV><KV label="Delivered">{fmtMt(t.delivered_mt)}</KV>
          {t.delay_minutes > 0 && <KV label="Delay">{t.delay_minutes} min</KV>}
          {t.notes && <KV label="Dispatch notes" className="col-span-2">{t.notes}</KV>}
        </KVGrid>
      </Section>
      <Section title="Timeline">
        <ol className="space-y-3">{times.map(([l, v]) => <li key={l} className="flex items-center justify-between border-b border-line pb-2 text-sm last:border-0"><span className="text-slate-600">{l}</span><span className={v ? 'font-medium tabular-nums' : 'text-slate-400'}>{v ? fmtDateTime(v) : '—'}</span></li>)}</ol>
      </Section>
    </div>
  );
}

function TrackingTab({ t, moving }: { t: any; moving: boolean }) {
  const { data } = useQuery({ queryKey: ['/tracking', 'trip', t.id], queryFn: () => get(`/tracking/trips/${t.id}`), refetchInterval: moving ? 5000 : false });
  const origin: [number, number] = [t.origin_lat, t.origin_lng]; const dest: [number, number] = [t.destination_lat, t.destination_lng];
  const has = t.cur_lat != null && (moving || ['ARRIVED', 'DISPATCHED', 'DELIVERED', 'ON_HOLD'].includes(t.status));
  const markers: any[] = [{ id: 'o', lat: origin[0], lng: origin[1], tone: 'green', kind: 'plant', label: t.origin_name }, { id: 'd', lat: dest[0], lng: dest[1], tone: 'red', kind: 'pin', label: t.destination_name }];
  if (has) markers.push({ id: 'v', lat: t.cur_lat, lng: t.cur_lng, tone: t.status === 'DELAYED' ? 'red' : t.status === 'ON_HOLD' ? 'amber' : 'blue', selected: true, label: `${t.vehicle_code} · ${t.cur_speed_kmh ?? 0} km/h` });
  const routes: any[] = [];
  if (data?.path?.length) routes.push({ id: 'route', path: data.path, color: '#94a3b8', dashed: true, weight: 4 });
  if (data?.trail?.length > 1) routes.push({ id: 'trail', path: data.trail.map((p: any) => [p.lat, p.lng]), color: '#2563eb', weight: 5 });
  const frac = Number(t.progress_pct) / 100;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Section padded={false} title="Route map" subtitle={has ? 'Live position (simulated GPS)' : 'Origin → destination'}><div className="p-3"><MapView height={440} markers={markers} routes={routes} fitKey={`${t.id}`} followId={has ? 'v' : undefined} /></div></Section>
      <Section title="Checkpoints & status">
        <ul className="space-y-3 text-sm">
          <li className="flex items-center gap-3"><span className="h-2.5 w-2.5 rounded-full bg-green-500" /><span className="flex-1">{t.origin_name}</span><span className="text-xs text-slate-500">Origin</span></li>
          {(data?.checkpoints ?? []).map((c: any) => { const passed = ['IN_TRANSIT', 'DELAYED', 'ON_HOLD', 'ARRIVED', 'DELIVERED', 'RETURNING', 'COMPLETED'].includes(t.status) && (frac >= c.at || !moving || t.status === 'ARRIVED');
            return <li key={c.name} className="flex items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${passed ? 'bg-green-500' : 'bg-slate-300'}`} /><span className="flex-1">{c.name}</span><span className="text-xs text-slate-500">{passed ? 'Passed' : `${Math.round(c.at * 100)}% of route`}</span></li>; })}
          <li className="flex items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${['ARRIVED', 'DELIVERED', 'RETURNING', 'COMPLETED'].includes(t.status) ? 'bg-green-500' : 'bg-red-500'}`} /><span className="flex-1">{t.destination_name}</span><span className="text-xs text-slate-500">Destination</span></li>
        </ul>
        {!has && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Live position appears once the vehicle departs.</p>}
      </Section>
    </div>
  );
}

function Resources({ t, nav }: { t: any; nav: (p: string) => void }) {
  if (!t.vehicle_id) return <EmptyState icon={<Truck className="h-6 w-6" />} title="No vehicle or driver assigned yet" description="Use “Assign vehicle & driver” above — availability, capacity and documents are validated automatically." />;
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Section title="Vehicle" actions={<Button size="sm" variant="ghost" onClick={() => nav(`/fleet/${t.vehicle_id}`)}>Open vehicle</Button>}>
        <div className="mb-4 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Truck className="h-5 w-5" /></div><div><p className="font-semibold">{t.vehicle_code}</p><p className="text-sm text-slate-500">{t.registration_no}</p></div></div>
        <KVGrid cols={2}><KV label="Capacity">{fmtMt(t.vehicle_capacity_mt)}</KV><KV label="Fleet">{t.vehicle_fleet_type === 'HIRED' ? 'Hired' : 'Owned'}</KV></KVGrid>
      </Section>
      <Section title="Driver" actions={<Button size="sm" variant="ghost" onClick={() => nav(`/drivers/${t.driver_id}`)}>Open driver</Button>}>
        <div className="mb-4 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><UserRound className="h-5 w-5" /></div><div><p className="font-semibold">{t.driver_name}</p><p className="text-sm text-slate-500">{t.driver_employee_id}</p></div></div>
        <p className="flex items-center gap-2 text-sm"><Phone className="h-4 w-4 text-slate-400" />{t.driver_phone ?? '—'}</p>
      </Section>
      {t.distributor_id && <Section title="Receiving distributor" className="md:col-span-2"><KVGrid cols={3}><KV label="Name">{t.distributor_name}</KV><KV label="Contact">{t.distributor_contact}</KV><KV label="Phone">{t.distributor_phone}</KV></KVGrid></Section>}
    </div>
  );
}

function Delivery({ t }: { t: any }) {
  const done = !!t.delivered_at;
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Section title="Load"><KVGrid cols={2}><KV label="Planned">{fmtMt(t.planned_load_mt)}</KV><KV label="Loaded at plant">{fmtMt(t.loaded_mt)}</KV><KV label="Delivered">{fmtMt(t.delivered_mt)}</KV><KV label="Variance">{t.loaded_mt && t.delivered_mt ? `${(Number(t.delivered_mt) - Number(t.loaded_mt)).toFixed(2)} MT` : '—'}</KV></KVGrid></Section>
      <Section title="Proof of delivery">
        {done ? <KVGrid cols={2}><KV label="Delivered at">{fmtDateTime(t.delivered_at)}</KV><KV label="Received by">{t.received_by}</KV><KV label="Delivery note">{t.delivery_note_no ?? '—'}</KV><KV label="Notes" className="col-span-2">{t.pod_notes ?? '—'}</KV></KVGrid>
          : <p className="text-sm text-slate-500">Delivery has not been confirmed yet. The driver or dispatcher records the delivered quantity and receiver once unloading is complete.</p>}
      </Section>
    </div>
  );
}

function SafetyTab({ checks }: { checks: any[] }) {
  if (!checks.length) return <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="No safety checks recorded" description="A pre-trip checklist must pass before the trip can start." />;
  return (
    <div className="space-y-4">{checks.map((c) => (
      <Section key={c.id} title={<span className="flex items-center gap-2">{c.kind === 'PRE_TRIP' ? 'Pre-trip check' : 'Post-trip check'}<StatusPill status={c.result} /></span>} subtitle={`${fmtDateTime(c.completed_at)} · ${c.completed_by_name ?? 'System'}`}>
        <ul className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">{c.items.map((i: any) => <li key={i.key} className="flex items-center gap-2 text-sm"><span className={i.ok ? 'text-green-600' : 'text-red-600'}>{i.ok ? '✓' : '✗'}</span><span className={i.ok ? '' : 'font-medium text-red-700'}>{i.label}</span></li>)}</ul>
        {c.notes && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{c.notes}</p>}
      </Section>))}</div>
  );
}

function Activity({ events }: { events: any[] }) {
  const tone = (e: any) => (e.type === 'CHECKPOINT' ? 'bg-slate-400' : e.type === 'ALERT' || e.to_status === 'DELAYED' || e.to_status === 'CANCELLED' ? 'bg-red-500' : e.type === 'CHECK' ? 'bg-teal-500' : e.to_status === 'COMPLETED' || e.to_status === 'DELIVERED' ? 'bg-green-500' : 'bg-brand-600');
  return (
    <Section title="Activity log" subtitle={`${events.length} events`}>
      <ol className="relative space-y-5 border-l border-line pl-6">
        {events.map((e) => (
          <li key={e.id} className="relative"><span className={`absolute -left-[31px] top-1.5 h-3 w-3 rounded-full ring-4 ring-white ${tone(e)}`} />
            <p className="text-sm font-medium">{e.message}</p>
            <p className="text-xs text-slate-500">{fmtDateTime(e.occurred_at)} · {e.actor_name ?? 'System'}{e.type === 'CHECKPOINT' ? ' · GPS checkpoint' : ''}</p></li>
        ))}
      </ol>
    </Section>
  );
}

function EditTrip({ t, onClose }: { t: any; onClose: () => void }) {
  const [f, setF] = useState({ load: String(t.planned_load_mt), priority: t.priority, dep: toLocalInput(new Date(t.scheduled_departure)), arr: toLocalInput(new Date(t.planned_arrival)), notes: t.notes ?? '' });
  const m = useAction(() => patch(`/trips/${t.id}`, { plannedLoadMt: Number(f.load), priority: f.priority, scheduledDeparture: new Date(f.dep).toISOString(), plannedArrival: new Date(f.arr).toISOString(), notes: f.notes }), { invalidate: TRIP_INVALIDATE, success: 'Trip updated.', onSuccess: onClose });
  const fe = fieldErrors(m.error);
  return (
    <Modal open onClose={onClose} title={`Edit ${t.code}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Save changes</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {m.error && !m.error.fields && <div className="sm:col-span-2"><Alert tone="danger">{m.error.message}</Alert></div>}
        <TextInput label="Planned load (MT)" type="number" step="0.1" value={f.load} onChange={(e) => setF({ ...f, load: e.target.value })} error={fe.plannedLoadMt} />
        <SelectInput label="Priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((x) => ({ value: x, label: x[0] + x.slice(1).toLowerCase() }))} />
        <TextInput label="Scheduled departure" type="datetime-local" value={f.dep} onChange={(e) => setF({ ...f, dep: e.target.value })} error={fe.scheduledDeparture} />
        <TextInput label="Planned arrival" type="datetime-local" value={f.arr} onChange={(e) => setF({ ...f, arr: e.target.value })} error={fe.plannedArrival} />
        <div className="sm:col-span-2"><TextArea label="Dispatch notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={500} /></div>
        {t.vehicle_id && <p className="flex items-center gap-2 text-xs text-slate-500 sm:col-span-2"><AlertTriangle className="h-3.5 w-3.5" />Changing the schedule or load re-validates the assigned vehicle and driver.</p>}
      </div>
    </Modal>
  );
}
export const _x = { Building2 };

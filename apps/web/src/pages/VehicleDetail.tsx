import { Archive, FilePlus2, Pencil, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DOC_TYPE_LABELS } from '@gasman/shared';
import { del } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime, fmtMt, fmtNum, fmtPkr, timeAgo } from '../lib/format';
import { useAction, useDetail } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert, ErrorState, PageLoader, ProgressBar } from '../ui/Feedback';
import { ConfirmDialog } from '../ui/Overlay';
import { KV, KVGrid, PageHeader, Section, Tabs } from '../ui/Page';
import { Pill, StatusPill } from '../ui/Pill';
import { MapView } from '../map/MapView';
import { DocumentModal, MaintenanceModal, VehicleForm } from '../features/forms';

export default function VehicleDetail() {
  const { id } = useParams(); const nav = useNavigate(); const { can } = useAuth();
  const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') ?? 'overview';
  const [edit, setEdit] = useState(false); const [doc, setDoc] = useState<string | null | undefined>(undefined); const [maint, setMaint] = useState(false); const [archive, setArchive] = useState(false);
  const { data, isLoading, error, refetch } = useDetail<any>(`/vehicles/${id}`, { refetchInterval: 20_000 });
  const arch = useAction(() => del(`/vehicles/${id}`), { invalidate: ['/vehicles'], success: 'Vehicle archived.', onSuccess: () => nav('/fleet') });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const { vehicle: v, documents, maintenance, trips, safetyChecks, utilization: u, currentTrip: ct, incidents } = data;
  const issues = documents.filter((d: any) => d.status !== 'ACTIVE');
  return (
    <>
      <PageHeader title={v.code} badge={<><StatusPill status={v.status} /><Pill tone={v.fleet_type === 'HIRED' ? 'purple' : 'blue'} dot={false}>{v.fleet_type === 'HIRED' ? 'Hired' : 'Owned'}</Pill></>}
        subtitle={`${v.registration_no} · ${v.make ?? ''} ${v.model ?? ''} ${v.year ?? ''} · ${v.capacity_mt} MT bowzer`} breadcrumbs={[{ label: 'Resources' }, { label: 'Fleet', to: '/fleet' }, { label: v.code }]}
        actions={<>
          {can('maintenance:manage') && <Button icon={<Wrench className="h-4 w-4" />} onClick={() => setMaint(true)}>Schedule maintenance</Button>}
          {can('documents:manage') && <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setDoc(null)}>Add document</Button>}
          {can('vehicles:update') && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)}>Edit</Button>}
          {can('vehicles:archive') && <Button variant="ghost" icon={<Archive className="h-4 w-4" />} onClick={() => setArchive(true)}>Archive</Button>}
        </>} />
      {issues.length > 0 && <Alert tone={issues.some((d: any) => d.status === 'EXPIRED') ? 'danger' : 'warning'} className="mb-4" title="Compliance attention needed">{issues.map((d: any) => <p key={d.id}>{DOC_TYPE_LABELS[d.doc_type]}: {d.status === 'EXPIRED' ? `expired ${Math.abs(d.days_left)} days ago` : `expires in ${d.days_left} days`} ({fmtDate(d.expires_on)}) — vehicles with expired required documents cannot be assigned to trips.</p>)}</Alert>}
      {ct && <Alert tone="info" className="mb-4" title={`Currently on ${ct.code}`}>Heading to {ct.destination_name} · {Math.round(ct.progress_pct)}% · <Link className="font-semibold underline" to={`/trips/${ct.id}`}>Open trip</Link></Alert>}
      <Tabs value={tab} onChange={(k) => setSp({ tab: k }, { replace: true })} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'documents', label: 'Documents', count: documents.length }, { key: 'maintenance', label: 'Maintenance', count: maintenance.length }, { key: 'trips', label: 'Trip history' }, { key: 'safety', label: 'Safety' }]} />
      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Section title="Specification" className="lg:col-span-2"><KVGrid cols={3}>
            <KV label="Fleet code">{v.code}</KV><KV label="Registration">{v.registration_no}</KV><KV label="Category">Bowzer</KV>
            <KV label="Capacity">{fmtMt(v.capacity_mt)}</KV><KV label="Make / model">{v.make} {v.model}</KV><KV label="Year">{v.year}</KV>
            <KV label="Home plant">{v.home_plant_name ?? '—'}</KV><KV label="Regular driver">{v.default_driver_id ? <Link className="text-brand-700 hover:underline" to={`/drivers/${v.default_driver_id}`}>{v.default_driver_name}</Link> : '—'}</KV><KV label="Odometer">{fmtNum(v.odometer_km)} km</KV>
            {v.vendor_name && <KV label="Vendor">{v.vendor_name}</KV>}
            <KV label="Bowzer no.">{v.bowzer_no ?? '—'}</KV><KV label="Chassis no.">{v.chassis_no ?? '—'}</KV><KV label="Engine no.">{v.engine_no ?? '—'}</KV><KV label="Wheels">{v.wheels ?? '—'}</KV><KV label="Owner / partner">{v.owner_name ?? '—'}</KV><KV label="Fuel norm">{v.fuel_norm_kmpl} km/L</KV>
            <KV label="Current location">{v.last_location_name ?? (v.status === 'ON_TRIP' ? 'On the road' : '—')}</KV><KV label="Last position">{timeAgo(v.last_position_at)}</KV>
          </KVGrid></Section>
          <Section title="Utilization (30 days)"><div className="space-y-4">
            <div><div className="mb-1 flex justify-between text-sm"><span>Time on road</span><b>{u.utilizationPct}%</b></div><ProgressBar value={u.utilizationPct} /></div>
            <KVGrid cols={2}><KV label="Trips completed">{u.trips_30d}</KV><KV label="LPG moved">{fmtMt(u.lpg_mt_30d)}</KV><KV label="Hours on road">{u.busyHours30d} h</KV><KV label="Lifetime trips">{u.trips_total}</KV></KVGrid></div></Section>
          {v.last_lat != null && <Section title="Position" className="lg:col-span-3" padded={false}><div className="p-3"><MapView height={280} markers={[{ id: 'v', lat: v.last_lat, lng: v.last_lng, tone: v.status === 'ON_TRIP' ? 'blue' : 'slate', selected: true, label: v.code }]} fitKey={String(v.id)} /></div></Section>}
        </div>
      )}
      {tab === 'documents' && (
        <Section padded={false} title="Documents" subtitle="Newest document of each type is current" actions={can('documents:manage') && <Button size="sm" variant="primary" onClick={() => setDoc(null)}>Add / renew</Button>}>
          <table className="w-full"><thead className="bg-slate-50/70"><tr><th className="th">Document</th><th className="th">Number</th><th className="th">Issued</th><th className="th">Expires</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-line">{documents.map((d: any) => <tr key={d.id}><td className="td font-medium">{DOC_TYPE_LABELS[d.doc_type]}</td><td className="td text-slate-600">{d.doc_number ?? '—'}</td><td className="td">{fmtDate(d.issued_on)}</td><td className="td tabular-nums">{fmtDate(d.expires_on)} <span className="text-xs text-slate-500">({d.days_left < 0 ? `${Math.abs(d.days_left)}d ago` : `${d.days_left}d`})</span></td><td className="td"><StatusPill status={d.status} /></td>
              <td className="td text-right">{can('documents:manage') && <Button size="sm" variant="ghost" onClick={() => setDoc(d.doc_type)}>Renew</Button>}</td></tr>)}
              {!documents.length && <tr><td colSpan={6} className="td py-10 text-center text-slate-500">No documents on record. Required documents are Registration, Insurance, Fitness and Tank Pressure Test.</td></tr>}</tbody></table>
        </Section>
      )}
      {tab === 'maintenance' && (
        <Section padded={false} title="Maintenance history & schedule" actions={can('maintenance:manage') && <Button size="sm" variant="primary" onClick={() => setMaint(true)}>Schedule</Button>}>
          <table className="w-full"><thead className="bg-slate-50/70"><tr><th className="th">Job</th><th className="th">Type</th><th className="th">Scheduled</th><th className="th">Status</th><th className="th">Vendor</th><th className="th text-right">Cost</th></tr></thead>
            <tbody className="divide-y divide-line">{maintenance.map((m: any) => <tr key={m.id}><td className="td font-medium">{m.title}</td><td className="td capitalize">{m.type.toLowerCase()}</td><td className="td">{fmtDate(m.scheduled_on)}</td><td className="td"><StatusPill status={m.status} /></td><td className="td text-slate-600">{m.vendor ?? '—'}</td><td className="td text-right tabular-nums">{m.cost_pkr ? fmtPkr(m.cost_pkr) : '—'}</td></tr>)}
              {!maintenance.length && <tr><td colSpan={6} className="td py-10 text-center text-slate-500">No maintenance recorded.</td></tr>}</tbody></table>
        </Section>
      )}
      {tab === 'trips' && (
        <Section padded={false} title="Recent trips">
          <table className="w-full"><thead className="bg-slate-50/70"><tr><th className="th">Trip</th><th className="th">Destination</th><th className="th">Driver</th><th className="th">Departure</th><th className="th">Delivered</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-line">{trips.map((t: any) => <tr key={t.id} className="cursor-pointer hover:bg-brand-50/50" onClick={() => nav(`/trips/${t.id}`)}><td className="td font-medium text-brand-700">{t.code}</td><td className="td">{t.destination_name}</td><td className="td">{t.driver_name}</td><td className="td">{fmtDateTime(t.scheduled_departure)}</td><td className="td tabular-nums">{fmtMt(t.delivered_mt)}</td><td className="td"><StatusPill status={t.status} /></td></tr>)}
              {!trips.length && <tr><td colSpan={6} className="td py-10 text-center text-slate-500">No trips yet.</td></tr>}</tbody></table>
        </Section>
      )}
      {tab === 'safety' && (
        <div className="grid gap-5 md:grid-cols-2">
          <Section title="Recent safety checks" padded={false}><ul className="divide-y divide-line">{safetyChecks.map((c: any) => <li key={c.id} className="flex items-center justify-between px-5 py-3 text-sm"><span>{c.kind === 'PRE_TRIP' ? 'Pre-trip' : 'Post-trip'} · {fmtDateTime(c.completed_at)}</span><StatusPill status={c.result} /></li>)}{!safetyChecks.length && <li className="px-5 py-8 text-center text-sm text-slate-500">No checks recorded.</li>}</ul></Section>
          <Section title="Incidents"><p className="text-3xl font-semibold tabular-nums">{incidents.n}</p><p className="text-sm text-slate-500">{incidents.open} open · <Link className="text-brand-700 hover:underline" to="/safety?tab=incidents">View incident log</Link></p></Section>
        </div>
      )}
      {edit && <VehicleForm vehicle={v} onClose={() => { setEdit(false); refetch(); }} />}
      {doc !== undefined && <DocumentModal owner={{ kind: 'VEHICLE', id: v.id, label: `${v.code} · ${v.registration_no}` }} defaultType={doc ?? undefined} onClose={() => { setDoc(undefined); refetch(); }} />}
      {maint && <MaintenanceModal vehicleId={v.id} onClose={() => { setMaint(false); refetch(); }} />}
      <ConfirmDialog open={archive} onClose={() => setArchive(false)} danger title={`Archive ${v.code}?`} message="The vehicle is removed from the active fleet and can no longer be assigned. Its trip history is kept." confirmLabel="Archive vehicle" loading={arch.isPending} onConfirm={() => arch.mutate(undefined as never)} />
      {arch.error && <Alert tone="danger" className="mt-4">{arch.error.message}</Alert>}
    </>
  );
}

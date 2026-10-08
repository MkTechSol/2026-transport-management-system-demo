import { Archive, FilePlus2, Pencil, Phone } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DOC_TYPE_LABELS } from '@gasman/shared';
import { del } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime, fmtMt } from '../lib/format';
import { useAction, useDetail } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert, ErrorState, PageLoader, ProgressBar } from '../ui/Feedback';
import { ConfirmDialog } from '../ui/Overlay';
import { KV, KVGrid, KpiCard, PageHeader, Section, Tabs } from '../ui/Page';
import { Pill, StatusPill } from '../ui/Pill';
import { DocumentModal, DriverForm } from '../features/forms';

export default function DriverDetail() {
  const { id } = useParams(); const nav = useNavigate(); const { can } = useAuth();
  const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') ?? 'overview';
  const [edit, setEdit] = useState(false); const [doc, setDoc] = useState<string | null | undefined>(undefined); const [archive, setArchive] = useState(false);
  const { data, isLoading, error, refetch } = useDetail<any>(`/drivers/${id}`, { refetchInterval: 20_000 });
  const arch = useAction(() => del(`/drivers/${id}`), { invalidate: ['/drivers'], success: 'Driver archived.', onSuccess: () => nav('/drivers') });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const { driver: d, documents, trips, incidents, stats, assignedVehicle, currentTrip: ct, safetyChecks } = data;
  const issues = documents.filter((x: any) => x.status !== 'ACTIVE');
  return (
    <>
      <PageHeader title={d.full_name} badge={<StatusPill status={d.status} />} subtitle={`${d.employee_id} · ${d.license_class} licence · ${d.home_plant_name ?? 'No home plant'}`} breadcrumbs={[{ label: 'Resources' }, { label: 'Drivers', to: '/drivers' }, { label: d.full_name }]}
        actions={<>
          {can('documents:manage') && <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setDoc(null)}>Add document</Button>}
          {can('drivers:update') && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)}>Edit</Button>}
          {can('drivers:archive') && <Button variant="ghost" icon={<Archive className="h-4 w-4" />} onClick={() => setArchive(true)}>Archive</Button>}
        </>} />
      {issues.length > 0 && <Alert tone={issues.some((x: any) => x.status === 'EXPIRED') ? 'danger' : 'warning'} className="mb-4" title="Compliance attention needed">{issues.map((x: any) => <p key={x.id}>{DOC_TYPE_LABELS[x.doc_type]}: {x.status === 'EXPIRED' ? `expired ${Math.abs(x.days_left)} days ago` : `expires in ${x.days_left} days`} ({fmtDate(x.expires_on)})</p>)}</Alert>}
      {ct && <Alert tone="info" className="mb-4" title={`On ${ct.code}`}>Heading to {ct.destination_name} · <Link className="font-semibold underline" to={`/trips/${ct.id}`}>Open trip</Link></Alert>}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Trips completed" value={stats.trips_total} hint={`${stats.trips_30d} in last 30 days`} /><KpiCard label="LPG delivered" value={fmtMt(stats.lpg_mt_total, 0)} tone="green" />
        <KpiCard label="On-time rate" value={`${stats.on_time_pct}%`} tone={stats.on_time_pct >= 85 ? 'green' : 'amber'} /><KpiCard label="Safety score" value={d.safety_score} tone={d.safety_score >= 90 ? 'green' : d.safety_score >= 75 ? 'amber' : 'red'} hint={`${incidents.length} incident(s) on record`} />
      </div>
      <Tabs value={tab} onChange={(k) => setSp({ tab: k }, { replace: true })} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'documents', label: 'Documents', count: documents.length }, { key: 'trips', label: 'Trip history' }, { key: 'safety', label: 'Safety & incidents' }]} />
      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Identity & licence"><KVGrid cols={2}><KV label="Employee ID">{d.employee_id}</KV><KV label="Phone"><span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5 text-slate-400" />{d.phone ?? '—'}</span></KV><KV label="National ID (demo)">{d.national_id_demo}</KV><KV label="Licence no.">{d.license_no}</KV><KV label="Licence class">{d.license_class}</KV><KV label="Experience">{d.experience_years} years</KV><KV label="Joined">{fmtDate(d.joined_on)}</KV><KV label="Home plant">{d.home_plant_name ?? '—'}</KV></KVGrid></Section>
          <Section title="Assignment"><KVGrid cols={2}><KV label="Regular vehicle">{assignedVehicle ? <Link className="text-brand-700 hover:underline" to={`/fleet/${assignedVehicle.id}`}>{assignedVehicle.code}</Link> : '—'}</KV><KV label="Current trip">{ct ? <Link className="text-brand-700 hover:underline" to={`/trips/${ct.id}`}>{ct.code}</Link> : 'None'}</KV></KVGrid>
            {ct && <div className="mt-4"><p className="mb-1 text-xs text-slate-500">Progress to {ct.destination_name}</p><ProgressBar value={Number(ct.progress_pct)} /></div>}</Section>
        </div>
      )}
      {tab === 'documents' && (
        <Section padded={false} title="Documents" actions={can('documents:manage') && <Button size="sm" variant="primary" onClick={() => setDoc(null)}>Add / renew</Button>}>
          <table className="w-full"><thead className="bg-slate-50/70"><tr><th className="th">Document</th><th className="th">Number</th><th className="th">Expires</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-line">{documents.map((x: any) => <tr key={x.id}><td className="td font-medium">{DOC_TYPE_LABELS[x.doc_type]}</td><td className="td text-slate-600">{x.doc_number ?? '—'}</td><td className="td tabular-nums">{fmtDate(x.expires_on)} <span className="text-xs text-slate-500">({x.days_left < 0 ? `${Math.abs(x.days_left)}d ago` : `${x.days_left}d`})</span></td><td className="td"><StatusPill status={x.status} /></td><td className="td text-right">{can('documents:manage') && <Button size="sm" variant="ghost" onClick={() => setDoc(x.doc_type)}>Renew</Button>}</td></tr>)}</tbody></table>
        </Section>
      )}
      {tab === 'trips' && (
        <Section padded={false} title="Recent trips"><table className="w-full"><thead className="bg-slate-50/70"><tr><th className="th">Trip</th><th className="th">Destination</th><th className="th">Vehicle</th><th className="th">Departure</th><th className="th">Delay</th><th className="th">Status</th></tr></thead>
          <tbody className="divide-y divide-line">{trips.map((t: any) => <tr key={t.id} className="cursor-pointer hover:bg-brand-50/50" onClick={() => nav(`/trips/${t.id}`)}><td className="td font-medium text-brand-700">{t.code}</td><td className="td">{t.destination_name}</td><td className="td">{t.vehicle_code}</td><td className="td">{fmtDateTime(t.scheduled_departure)}</td><td className="td">{t.delay_minutes > 15 ? <Pill tone="amber">{t.delay_minutes} min</Pill> : '—'}</td><td className="td"><StatusPill status={t.status} /></td></tr>)}
            {!trips.length && <tr><td colSpan={6} className="td py-10 text-center text-slate-500">No trips yet.</td></tr>}</tbody></table></Section>
      )}
      {tab === 'safety' && (
        <div className="grid gap-5 md:grid-cols-2">
          <Section title="Incidents" padded={false}><ul className="divide-y divide-line">{incidents.map((i: any) => <li key={i.id} className="px-5 py-3 text-sm"><div className="flex items-center justify-between"><b>{i.code}</b><span className="flex gap-1.5"><StatusPill status={i.severity} /><StatusPill status={i.status} /></span></div><p className="mt-1 text-slate-600">{i.description}</p><p className="mt-1 text-xs text-slate-400">{fmtDateTime(i.reported_at)}</p></li>)}{!incidents.length && <li className="px-5 py-8 text-center text-sm text-slate-500">No incidents on record.</li>}</ul></Section>
          <Section title="Recent safety checks" padded={false}><ul className="divide-y divide-line">{safetyChecks.map((c: any) => <li key={c.id} className="flex items-center justify-between px-5 py-3 text-sm"><span>{c.kind === 'PRE_TRIP' ? 'Pre-trip' : 'Post-trip'} · {fmtDateTime(c.completed_at)}</span><StatusPill status={c.result} /></li>)}{!safetyChecks.length && <li className="px-5 py-8 text-center text-sm text-slate-500">No checks recorded.</li>}</ul></Section>
        </div>
      )}
      {edit && <DriverForm driver={d} onClose={() => { setEdit(false); refetch(); }} />}
      {doc !== undefined && <DocumentModal owner={{ kind: 'DRIVER', id: d.id, label: d.full_name }} defaultType={doc ?? undefined} onClose={() => { setDoc(undefined); refetch(); }} />}
      <ConfirmDialog open={archive} onClose={() => setArchive(false)} danger title={`Archive ${d.full_name}?`} message="The driver is removed from the active roster and can no longer be assigned. Trip history is kept." confirmLabel="Archive driver" loading={arch.isPending} onConfirm={() => arch.mutate(undefined as never)} />
      {arch.error && <Alert tone="danger" className="mt-4">{arch.error.message}</Alert>}
    </>
  );
}

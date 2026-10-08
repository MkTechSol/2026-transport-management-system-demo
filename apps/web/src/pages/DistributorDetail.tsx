import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtMt, regionLabel } from '../lib/format';
import { useDetail } from '../lib/hooks';
import { Button } from '../ui/Button';
import { ErrorState, PageLoader } from '../ui/Feedback';
import { KV, KVGrid, KpiCard, PageHeader, Section } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { DistributorForm } from './Distributors';
import { COLORS } from '../ui/charts';

export default function DistributorDetail() {
  const { id } = useParams(); const nav = useNavigate(); const { can } = useAuth(); const [edit, setEdit] = useState(false);
  const { data, isLoading, error, refetch } = useDetail<any>(`/distributors/${id}`);
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const { distributor: d, trips, stats, monthly } = data;
  return (
    <>
      <PageHeader title={d.name} badge={<><StatusPill status={d.status} /><StatusPill status={d.credit_status} label={`Credit: ${d.credit_status.toLowerCase()}`} /></>} subtitle={`${d.code} · ${d.city}, ${regionLabel(d.region)}`} breadcrumbs={[{ label: 'Resources' }, { label: 'Distributors', to: '/distributors' }, { label: d.name }]}
        actions={<>{can('trips:create') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => nav('/trips/new')}>Create trip</Button>}{can('distributors:manage') && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)}>Edit</Button>}</>} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4"><KpiCard label="Completed deliveries" value={stats.completed} tone="green" /><KpiCard label="Open trips" value={stats.open} /><KpiCard label="LPG received" value={fmtMt(stats.mt_total, 0)} /><KpiCard label="Avg. delay" value={`${stats.avg_delay_min} min`} tone={stats.avg_delay_min > 20 ? 'amber' : 'slate'} /></div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Contact" ><KVGrid cols={2}><KV label="Contact person">{d.contact_name}</KV><KV label="Phone">{d.phone}</KV><KV label="Address" className="col-span-2">{d.address}</KV><KV label="Coordinates">{Number(d.lat).toFixed(3)}, {Number(d.lng).toFixed(3)}</KV></KVGrid></Section>
        <Section title="Monthly volume (MT)" className="lg:col-span-2">{monthly.length ? <ResponsiveContainer width="100%" height={180}><BarChart data={monthly}><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} /><Tooltip /><Bar dataKey="mt" fill={COLORS.blue} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <p className="py-10 text-center text-sm text-slate-500">No deliveries in the last 6 months.</p>}</Section>
      </div>
      <Section className="mt-5" title="Delivery history" padded={false}><table className="w-full"><thead className="bg-slate-50/70"><tr><th className="th">Trip</th><th className="th">From</th><th className="th">Vehicle</th><th className="th">Departure</th><th className="th">Delivered</th><th className="th">Status</th></tr></thead>
        <tbody className="divide-y divide-line">{trips.map((t: any) => <tr key={t.id} className="cursor-pointer hover:bg-brand-50/50" onClick={() => nav(`/trips/${t.id}`)}><td className="td font-medium text-brand-700">{t.code}</td><td className="td">{t.origin_name}</td><td className="td">{t.vehicle_code ?? '—'}</td><td className="td">{fmtDate(t.scheduled_departure)}</td><td className="td tabular-nums">{fmtMt(t.delivered_mt)}</td><td className="td"><StatusPill status={t.status} /></td></tr>)}
          {!trips.length && <tr><td colSpan={6} className="td py-10 text-center text-slate-500">No deliveries yet.</td></tr>}</tbody></table></Section>
      {edit && <DistributorForm dist={d} onClose={() => { setEdit(false); refetch(); }} />}
    </>
  );
}

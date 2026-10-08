import { Fuel as FuelIcon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtNum, fmtPkr, fmtShortDateTime } from '../lib/format';
import { fieldErrors, useAction, useList, useQueryState, useSort } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert, EmptyState, Skeleton } from '../ui/Feedback';
import { FilterSelect, TextArea } from '../ui/Form';
import { Modal } from '../ui/Overlay';
import { KpiCard, PageHeader, Section, Tabs } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';
import { COLORS } from '../ui/charts';
import { useVehicleOptions } from '../features/common';
import { FuelModal } from '../features/forms';

export default function Fuel() {
  const { can } = useAuth(); const { state, set, clear, page } = useQueryState(); const tab = state.tab ?? 'transactions'; const [add, setAdd] = useState(false); const [review, setReview] = useState<any>(null);
  const vehicles = useVehicleOptions(); const { sort, dir, onSort } = useSort(state, set as any, 'date');
  const params = { page, pageSize: 15, q: state.q, vehicleId: state.vehicleId, status: tab === 'exceptions' ? 'FLAGGED' : state.status, from: state.from, to: state.to, sort: state.sort, dir: state.sort ? dir : undefined };
  const { data, isLoading, error, refetch } = useList('/fuel', params, { refetchInterval: 30_000 });
  const an = useQuery({ queryKey: ['/fuel', 'analytics'], queryFn: () => get('/fuel/analytics'), enabled: tab === 'intelligence' });
  const s = data?.summary;
  const cols: Column<any>[] = [
    { key: 'date', header: 'When', sortKey: 'date', render: (f) => <span className="whitespace-nowrap tabular-nums">{fmtShortDateTime(f.fueled_at)}</span> },
    { key: 'v', header: 'Vehicle', sortKey: 'vehicle', render: (f) => <div><Link to={`/fleet/${f.vehicle_id}`} className="font-semibold text-brand-700 hover:underline">{f.vehicle_code}</Link><p className="text-xs text-slate-500">{f.driver_name ?? ''}</p></div> },
    { key: 't', header: 'Trip', hideBelow: 'md', render: (f) => (f.trip_id ? <Link to={`/trips/${f.trip_id}?tab=fuel`} className="text-brand-700 hover:underline">{f.trip_code}</Link> : '—') },
    { key: 'l', header: 'Litres', sortKey: 'litres', render: (f) => <span className="tabular-nums">{f.litres}</span> },
    { key: 'r', header: 'Rate', hideBelow: 'lg', render: (f) => <span className="tabular-nums">{f.rate_per_l}</span> },
    { key: 'a', header: 'Amount', sortKey: 'amount', render: (f) => <span className="tabular-nums">{fmtPkr(f.amount)}</span> },
    { key: 'k', header: 'km/L', sortKey: 'kmpl', hideBelow: 'md', render: (f) => <span className="tabular-nums">{f.kmpl ?? '—'}</span> },
    { key: 's', header: 'Validation', render: (f) => <div><StatusPill status={f.status} />{f.flag_reason && <p className="mt-1 max-w-xs text-xs text-red-600">{f.flag_reason}</p>}{f.review_note && <p className="mt-1 max-w-xs text-xs text-slate-500">{f.review_note}</p>}</div> },
    { key: 'act', header: '', render: (f) => f.status === 'FLAGGED' && can('fuel:manage') && <Button size="sm" onClick={() => setReview(f)}>Review</Button> },
  ];
  return (
    <>
      <PageHeader title="Fuel Intelligence" subtitle="Fuel entries, validation against each bowzer's norm, and exception review" breadcrumbs={[{ label: 'Fuel & Expenses' }, { label: 'Fuel' }]} actions={can('fuel:record') && <Button variant="primary" icon={<FuelIcon className="h-4 w-4" />} onClick={() => setAdd(true)}>Record fuel</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Litres (filtered)" value={s ? fmtNum(Math.round(s.litres)) + ' L' : '–'} /><KpiCard label="Fuel cost" value={s ? fmtPkr(s.amount) : '–'} tone="slate" />
        <KpiCard label="Average km / litre" value={s ? s.avg_kmpl : '–'} tone="green" hint={`avg rate PKR ${s?.avg_rate ?? '–'} / L`} /><KpiCard label="Flagged entries" value={s?.flagged ?? '–'} tone={s?.flagged ? 'red' : 'slate'} to="/fuel?tab=exceptions" />
      </div>
      <Tabs value={tab} onChange={(k) => set({ tab: k === 'transactions' ? undefined : k })} tabs={[{ key: 'transactions', label: 'Transactions' }, { key: 'intelligence', label: 'Intelligence' }, { key: 'exceptions', label: 'Exception center', count: s?.flagged }]} />
      {tab !== 'intelligence' && <>
        {tab === 'exceptions' && <Alert tone="warning" className="mb-3" title="Entries flagged by the validation rules">Consumption above the vehicle norm, odometer regressions, impossible tank volumes or abnormal prices. Review each one and accept or dispute it.</Alert>}
        <FilterBar active={['q', 'vehicleId', 'status', 'from', 'to'].some((k) => state[k])} onClear={() => clear(['tab'])}>
          <SearchInput className="w-full sm:w-64" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search vehicle, trip, station, receipt…" />
          <FilterSelect label="Vehicle" value={state.vehicleId ?? 'ALL'} onChange={(v) => set({ vehicleId: v })} options={[{ value: 'ALL', label: 'All vehicles' }, ...(vehicles.data?.data ?? []).map((v: any) => ({ value: String(v.id), label: v.code }))]} />
          {tab !== 'exceptions' && <FilterSelect label="Status" value={state.status ?? 'ALL'} onChange={(v) => set({ status: v })} options={[{ value: 'ALL', label: 'All' }, { value: 'VALIDATED', label: 'Validated' }, { value: 'FLAGGED', label: 'Flagged' }, { value: 'REVIEWED', label: 'Reviewed' }]} />}
          <div className="flex items-center gap-1.5 text-sm text-slate-500"><input type="date" aria-label="From" className="input w-auto py-2" value={state.from ?? ''} onChange={(e) => set({ from: e.target.value })} />–<input type="date" aria-label="To" className="input w-auto py-2" value={state.to ?? ''} onChange={(e) => set({ to: e.target.value })} /></div>
        </FilterBar>
        <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(f) => f.id} sort={sort} dir={dir} onSort={onSort} page={page} pageSize={15} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: tab === 'exceptions' ? 'No open fuel exceptions' : 'No fuel entries match' }} />
      </>}
      {tab === 'intelligence' && (an.isLoading || !an.data ? <Skeleton className="h-80" /> : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Efficiency by vehicle (km/L, last 90 days)" subtitle="Lowest first — compare with the vehicle's norm">
            {an.data.vehicles.length ? <ResponsiveContainer width="100%" height={Math.max(220, an.data.vehicles.length * 30)}><BarChart data={an.data.vehicles} layout="vertical" margin={{ left: 10, right: 16 }}><CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} /><YAxis type="category" dataKey="code" width={90} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} /><Tooltip /><Bar dataKey="kmpl" name="km/L" fill={COLORS.blue} radius={[0, 4, 4, 0]} barSize={14} /><Bar dataKey="norm" name="Norm" fill="#cbd5e1" radius={[0, 4, 4, 0]} barSize={6} /></BarChart></ResponsiveContainer> : <EmptyState title="No data yet" />}
          </Section>
          <Section title="Average price per litre (weekly)"><ResponsiveContainer width="100%" height={260}><LineChart data={an.data.trend} margin={{ left: -10, right: 10 }}><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} /><YAxis domain={['dataMin - 2', 'dataMax + 2']} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} /><Tooltip /><Line type="monotone" dataKey="rate" stroke={COLORS.amber} strokeWidth={2.5} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></Section>
          <Section title="Fuel spend by month (PKR)"><ResponsiveContainer width="100%" height={240}><BarChart data={an.data.monthly} margin={{ left: 0 }}><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} /><Tooltip formatter={(v: number) => fmtPkr(v)} /><Bar dataKey="amount" fill={COLORS.teal} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></Section>
          <Section title="Cost per km" padded={false}><table className="w-full"><thead className="bg-slate-50/70"><tr><th className="th">Vehicle</th><th className="th text-right">Fills</th><th className="th text-right">Litres</th><th className="th text-right">PKR / km</th><th className="th text-right">Flagged</th></tr></thead>
            <tbody className="divide-y divide-line">{an.data.vehicles.map((v: any) => <tr key={v.code}><td className="td font-medium">{v.code}</td><td className="td text-right tabular-nums">{v.fills}</td><td className="td text-right tabular-nums">{fmtNum(Math.round(v.litres))}</td><td className="td text-right tabular-nums">{v.cost_per_km ?? '—'}</td><td className="td text-right tabular-nums">{v.flagged || '—'}</td></tr>)}</tbody></table></Section>
        </div>
      ))}
      {add && <FuelModal onClose={() => { setAdd(false); refetch(); }} />}
      {review && <ReviewModal f={review} onClose={() => { setReview(null); refetch(); }} />}
    </>
  );
}

function ReviewModal({ f, onClose }: { f: any; onClose: () => void }) {
  const [note, setNote] = useState('');
  const m = useAction((accept: boolean) => post(`/fuel/${f.id}/review`, { note, accept }), { invalidate: ['/fuel', '/expenses', '/approvals'], success: 'Review recorded.', onSuccess: onClose });
  const fe = fieldErrors(m.error);
  return (
    <Modal open onClose={onClose} title={`Review fuel entry — ${f.vehicle_code}`} description={`${f.litres} L · ${fmtPkr(f.amount)}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" loading={m.isPending} disabled={note.trim().length < 3} onClick={() => m.mutate(false)}>Dispute</Button><Button variant="success" loading={m.isPending} disabled={note.trim().length < 3} onClick={() => m.mutate(true)}>Accept</Button></>}>
      <div className="space-y-3"><Alert tone="warning">{f.flag_reason}</Alert>{m.error && !m.error.fields && <Alert tone="danger">{m.error.message}</Alert>}<TextArea label="Review note" required value={note} onChange={(e) => setNote(e.target.value)} error={fe.note} /><p className="text-xs text-slate-500">Disputing rejects the linked trip expense.</p></div>
    </Modal>
  );
}

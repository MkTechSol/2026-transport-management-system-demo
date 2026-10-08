import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MAINTENANCE_STATUSES, MAINTENANCE_TYPES } from '@gasman/shared';
import { patch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtPkr, titleCase } from '../lib/format';
import { fieldErrors, useAction, useList, useQueryState, useSort } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Feedback';
import { FilterSelect, TextInput } from '../ui/Form';
import { Modal } from '../ui/Overlay';
import { KpiCard, PageHeader } from '../ui/Page';
import { Pill, StatusPill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';
import { MaintenanceModal } from '../features/forms';

export default function Maintenance() {
  const { can } = useAuth(); const [adding, setAdding] = useState(false); const [complete, setComplete] = useState<any>(null);
  const { state, set, clear, page } = useQueryState(); const { sort, dir, onSort } = useSort(state, set as any, 'scheduled');
  const { data, isLoading, error, refetch } = useList('/maintenance', { page, pageSize: 15, q: state.q, status: state.status, type: state.type, due: state.due, sort: state.sort, dir: state.sort ? dir : undefined });
  const act = useAction((v: { id: number; status: string }) => patch(`/maintenance/${v.id}`, { status: v.status }), { invalidate: ['/maintenance', '/vehicles'], success: 'Maintenance updated.' });
  const s = data?.summary;
  const cols: Column<any>[] = [
    { key: 'v', header: 'Vehicle', sortKey: 'vehicle', render: (m) => <Link to={`/fleet/${m.vehicle_id}`} className="font-semibold text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>{m.vehicle_code}</Link> },
    { key: 'title', header: 'Job', render: (m) => <div><p className="font-medium">{m.title}</p><p className="text-xs text-slate-500">{titleCase(m.type)}{m.vendor ? ` · ${m.vendor}` : ''}</p></div> },
    { key: 'on', header: 'Scheduled', sortKey: 'scheduled', render: (m) => <div><p className="tabular-nums">{fmtDate(m.scheduled_on)}</p>{['SCHEDULED'].includes(m.status) && <p className={`text-xs ${m.days_left < 0 ? 'font-medium text-red-600' : 'text-slate-500'}`}>{m.days_left < 0 ? `${Math.abs(m.days_left)}d overdue` : m.days_left === 0 ? 'Today' : `in ${m.days_left}d`}</p>}</div> },
    { key: 'status', header: 'Status', sortKey: 'status', render: (m) => <StatusPill status={m.status} /> },
    { key: 'cost', header: 'Cost', sortKey: 'cost', hideBelow: 'md', render: (m) => <span className="tabular-nums">{m.cost_pkr ? fmtPkr(m.cost_pkr) : '—'}</span> },
    { key: 'act', header: '', render: (m) => can('maintenance:manage') && (
      <div className="flex justify-end gap-1.5">
        {m.status === 'SCHEDULED' && <Button size="sm" loading={act.isPending && act.variables?.id === m.id} onClick={() => act.mutate({ id: m.id, status: 'IN_PROGRESS' })}>Start</Button>}
        {m.status === 'IN_PROGRESS' && <Button size="sm" variant="success" onClick={() => setComplete(m)}>Complete</Button>}
        {['SCHEDULED', 'IN_PROGRESS'].includes(m.status) && <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: m.id, status: 'CANCELLED' })}>Cancel</Button>}
      </div>) },
  ];
  return (
    <>
      <PageHeader title="Maintenance" subtitle="Preventive, corrective and inspection work on the fleet" breadcrumbs={[{ label: 'Compliance & Safety' }, { label: 'Maintenance' }]} actions={can('maintenance:manage') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Schedule maintenance</Button>} />
      <div className="mb-4 grid grid-cols-3 gap-3"><KpiCard label="Due within 7 days" value={s?.due ?? '–'} tone="amber" to="/maintenance?due=true" /><KpiCard label="Overdue" value={s?.overdue ?? '–'} tone="red" /><KpiCard label="In workshop" value={s?.inProgress ?? '–'} to="/maintenance?status=IN_PROGRESS" /></div>
      {act.error && <Alert tone="danger" className="mb-3">{act.error.message}</Alert>}
      <FilterBar active={['q', 'status', 'type', 'due'].some((k) => state[k])} onClear={() => clear()}>
        <SearchInput className="w-full sm:w-72" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search vehicle, job, workshop…" />
        <FilterSelect label="Status" value={state.status ?? 'ALL'} onChange={(v) => set({ status: v, due: undefined })} options={[{ value: 'ALL', label: 'All statuses' }, ...MAINTENANCE_STATUSES.map((x) => ({ value: x, label: titleCase(x) }))]} />
        <FilterSelect label="Type" value={state.type ?? 'ALL'} onChange={(v) => set({ type: v })} options={[{ value: 'ALL', label: 'All types' }, ...MAINTENANCE_TYPES.map((x) => ({ value: x, label: titleCase(x) }))]} />
        {state.due && <Pill tone="amber">Due ≤ 7 days</Pill>}
      </FilterBar>
      <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(m) => m.id} sort={sort} dir={dir} onSort={onSort} page={page} pageSize={15} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No maintenance records' }} />
      {adding && <MaintenanceModal onClose={() => setAdding(false)} />}
      {complete && <CompleteModal m={complete} onClose={() => setComplete(null)} />}
    </>
  );
}

function CompleteModal({ m, onClose }: { m: any; onClose: () => void }) {
  const [cost, setCost] = useState(''); const [odo, setOdo] = useState('');
  const mut = useAction(() => patch(`/maintenance/${m.id}`, { status: 'COMPLETED', costPkr: cost ? Number(cost) : null, odometerKm: odo ? Number(odo) : null }), { invalidate: ['/maintenance', '/vehicles'], success: `${m.vehicle_code} is back in service.`, onSuccess: onClose });
  const fe = fieldErrors(mut.error);
  return (
    <Modal open onClose={onClose} size="sm" title={`Complete: ${m.title}`} description={m.vehicle_code} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="success" loading={mut.isPending} onClick={() => mut.mutate(undefined as never)}>Mark complete</Button></>}>
      <div className="space-y-3">{mut.error && !mut.error.fields && <Alert tone="danger">{mut.error.message}</Alert>}
        <TextInput label="Total cost (PKR)" type="number" value={cost} onChange={(e) => setCost(e.target.value)} error={fe.costPkr} /><TextInput label="Odometer at completion (km)" type="number" value={odo} onChange={(e) => setOdo(e.target.value)} error={fe.odometerKm} />
        <p className="text-xs text-slate-500">The vehicle returns to Available unless other maintenance is still in progress.</p></div>
    </Modal>
  );
}

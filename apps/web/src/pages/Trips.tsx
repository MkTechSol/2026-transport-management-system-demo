import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { TRIP_STATUSES, TRIP_STATUS_LABELS } from '@gasman/shared';
import { useAuth } from '../lib/auth';
import { fmtMt, fmtShortDateTime, regionLabel } from '../lib/format';
import { useList, useQueryState, useSort } from '../lib/hooks';
import { Button } from '../ui/Button';
import { FilterSelect } from '../ui/Form';
import { PageHeader, Tabs } from '../ui/Page';
import { StatusPill, Pill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';
import { usePlants } from '../features/common';

export default function Trips() {
  const nav = useNavigate(); const { can } = useAuth();
  const { state, set, clear, page } = useQueryState(); const { sort, dir, onSort } = useSort(state, set as any, 'departure');
  const plants = usePlants();
  const params = { page, pageSize: 20, q: state.q, status: state.status, scope: state.scope, plantId: state.plantId, region: state.region, priority: state.priority, from: state.from, to: state.to, sort, dir: state.sort ? dir : undefined };
  const { data, isLoading, isFetching, error, refetch } = useList('/trips', params, { refetchInterval: 30_000 });
  const filtered = ['q', 'status', 'plantId', 'region', 'priority', 'from', 'to'].some((k) => state[k]);
  const cols: Column<any>[] = [
    { key: 'code', header: 'Trip', sortKey: 'code', render: (t) => <div><p className="font-semibold text-brand-700">{t.code}</p><p className="text-xs text-slate-500">{t.lpg_source === 'IMPORTED' ? 'Imported LPG' : 'Local LPG'}</p></div> },
    { key: 'route', header: 'Route', render: (t) => <div><p className="font-medium">{t.origin_name} <span className="text-slate-400">→</span> {t.destination_name}</p><p className="text-xs text-slate-500">{t.distributor_name ?? '—'} · {regionLabel(t.destination_region)}</p></div> },
    { key: 'assign', header: 'Vehicle / driver', hideBelow: 'md', render: (t) => t.vehicle_code ? <div><p>{t.vehicle_code}</p><p className="text-xs text-slate-500">{t.driver_name}</p></div> : <span className="text-xs italic text-slate-400">Unassigned</span> },
    { key: 'dep', header: 'Departure', sortKey: 'departure', hideBelow: 'lg', render: (t) => <span className="text-sm tabular-nums">{fmtShortDateTime(t.scheduled_departure)}</span> },
    { key: 'load', header: 'Load', sortKey: 'load', hideBelow: 'md', render: (t) => <span className="tabular-nums">{fmtMt(t.delivered_mt ?? t.planned_load_mt)}</span> },
    { key: 'prio', header: 'Priority', hideBelow: 'lg', render: (t) => t.priority === 'NORMAL' ? <span className="text-slate-400">—</span> : <Pill tone={t.priority === 'LOW' ? 'slate' : 'red'} dot={false}>{t.priority}</Pill> },
    { key: 'status', header: 'Status', sortKey: 'status', render: (t) => <StatusPill status={t.status} /> },
  ];
  return (
    <>
      <PageHeader title="Trip Management" subtitle="Plan, track and review every LPG trip" breadcrumbs={[{ label: 'Operations' }, { label: 'Trips' }]}
        actions={can('trips:create') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => nav('/trips/new')}>Create Trip</Button>} />
      <Tabs value={state.scope ?? 'all'} onChange={(k) => set({ scope: k === 'all' ? undefined : k, status: undefined })}
        tabs={[{ key: 'all', label: 'All trips' }, { key: 'active', label: 'Active' }, { key: 'upcoming', label: 'Upcoming' }, { key: 'history', label: 'History' }]} />
      <FilterBar active={filtered} onClear={() => clear(['scope'])}>
        <SearchInput className="w-full sm:w-72" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search trip, vehicle, driver, destination…" />
        <FilterSelect label="Status" value={state.status ?? 'ALL'} onChange={(v) => set({ status: v })} options={[{ value: 'ALL', label: 'All statuses' }, ...TRIP_STATUSES.map((s) => ({ value: s, label: TRIP_STATUS_LABELS[s] })), { value: 'DELAYED,ON_HOLD', label: 'Delayed + On hold' }]} />
        <FilterSelect label="Plant" value={state.plantId ?? 'ALL'} onChange={(v) => set({ plantId: v })} options={[{ value: 'ALL', label: 'All origins' }, ...(plants.data?.data ?? []).map((p: any) => ({ value: String(p.id), label: p.name }))]} />
        <FilterSelect label="Region" value={state.region ?? 'ALL'} onChange={(v) => set({ region: v })} options={[{ value: 'ALL', label: 'All regions' }, ...['KPK', 'PUNJAB', 'ISLAMABAD', 'AJK', 'GILGIT_BALTISTAN'].map((r) => ({ value: r, label: regionLabel(r) }))]} />
        <FilterSelect label="Priority" value={state.priority ?? 'ALL'} onChange={(v) => set({ priority: v })} options={[{ value: 'ALL', label: 'Any priority' }, { value: 'HIGH', label: 'High' }, { value: 'URGENT', label: 'Urgent' }, { value: 'LOW', label: 'Low' }]} />
        <div className="flex items-center gap-1.5 text-sm text-slate-500"><input type="date" aria-label="From date" className="input w-auto py-2" value={state.from ?? ''} onChange={(e) => set({ from: e.target.value })} />–<input type="date" aria-label="To date" className="input w-auto py-2" value={state.to ?? ''} onChange={(e) => set({ to: e.target.value })} /></div>
      </FilterBar>
      <DataTable columns={cols} rows={data?.data} loading={isLoading || (isFetching && !data)} error={error} onRetry={() => refetch()} rowKey={(t) => t.id} onRowClick={(t) => nav(`/trips/${t.id}`)}
        sort={sort} dir={dir} onSort={onSort} page={page} pageSize={20} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)}
        empty={{ title: 'No trips match your filters', description: 'Try a different status, date range or search term.', action: can('trips:create') ? <Button variant="primary" onClick={() => nav('/trips/new')}>Create a trip</Button> : undefined }} />
    </>
  );
}

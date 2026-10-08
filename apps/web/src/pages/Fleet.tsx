import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { VEHICLE_STATUSES } from '@gasman/shared';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtNum, timeAgo, titleCase } from '../lib/format';
import { useList, useQueryState, useSort } from '../lib/hooks';
import { Button } from '../ui/Button';
import { FilterSelect } from '../ui/Form';
import { KpiCard, PageHeader } from '../ui/Page';
import { Pill, StatusPill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';
import { usePlants } from '../features/common';
import { VehicleForm } from '../features/forms';

export default function Fleet() {
  const nav = useNavigate(); const { can } = useAuth(); const [adding, setAdding] = useState(false);
  const { state, set, clear, page } = useQueryState(); const { sort, dir, onSort } = useSort(state, set as any, 'code');
  const plants = usePlants();
  const summary = useQuery({ queryKey: ['/vehicles', 'summary'], queryFn: () => get('/vehicles/summary'), refetchInterval: 30_000 });
  const params = { page, pageSize: 15, q: state.q, status: state.status, fleetType: state.fleetType, plantId: state.plantId, docIssue: state.docIssue, sort, dir: state.sort ? dir : 'asc' };
  const { data, isLoading, error, refetch } = useList('/vehicles', params, { refetchInterval: 30_000 });
  const sum = (f: (r: any) => boolean) => (summary.data?.data ?? []).filter(f).reduce((s: number, r: any) => s + r.n, 0);
  const cols: Column<any>[] = [
    { key: 'code', header: 'Vehicle', sortKey: 'code', render: (v) => <div><p className="font-semibold text-brand-700">{v.code}</p><p className="text-xs text-slate-500">{v.registration_no}</p></div> },
    { key: 'type', header: 'Type', hideBelow: 'md', render: (v) => <div><p>{v.make} {v.model}</p><p className="text-xs text-slate-500">{v.year}</p></div> },
    { key: 'fleet', header: 'Fleet / owner', sortKey: 'fleet', hideBelow: 'md', render: (v) => <div><Pill tone={v.fleet_type === 'HIRED' ? 'purple' : 'blue'} dot={false}>{v.fleet_type === 'HIRED' ? 'Hired' : 'Owned'}</Pill><p className="mt-1 max-w-[10rem] truncate text-xs text-slate-500">{v.owner_name ?? ''}</p></div> },
    { key: 'bz', header: 'Bowzer no.', hideBelow: 'lg', render: (v) => v.bowzer_no ?? '—' },
    { key: 'cap', header: 'Capacity', sortKey: 'capacity', render: (v) => <span className="tabular-nums">{v.capacity_mt} MT</span> },
    { key: 'status', header: 'Status', sortKey: 'status', render: (v) => <div><StatusPill status={v.status} />{v.current_trip_code && <p className="mt-1 text-xs text-slate-500">{v.current_trip_code}</p>}</div> },
    { key: 'driver', header: 'Driver', hideBelow: 'lg', render: (v) => v.default_driver_name ?? <span className="text-slate-400">—</span> },
    { key: 'loc', header: 'Location', hideBelow: 'lg', render: (v) => <div><p>{v.last_location_name ?? (v.status === 'ON_TRIP' ? 'On the road' : '—')}</p><p className="text-xs text-slate-500">{v.last_position_at ? timeAgo(v.last_position_at) : ''}</p></div> },
    { key: 'docs', header: 'Compliance', render: (v) => v.docs_expired ? <Pill tone="red">{v.docs_expired} expired</Pill> : v.docs_expiring ? <Pill tone="amber">{v.docs_expiring} expiring</Pill> : <Pill tone="green">Valid</Pill> },
    { key: 'mt', header: 'Next service', hideBelow: 'lg', render: (v) => <span className="text-sm">{v.next_maintenance_on ? fmtDate(v.next_maintenance_on) : '—'}</span> },
  ];
  const filtered = ['q', 'status', 'fleetType', 'plantId', 'docIssue'].some((k) => state[k]);
  return (
    <>
      <PageHeader title="Fleet" subtitle="LPG bowzers — owned and hired" breadcrumbs={[{ label: 'Resources' }, { label: 'Fleet' }]} actions={can('vehicles:create') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add vehicle</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard label="Total fleet" value={sum(() => true) || '—'} hint={`${sum((r) => r.fleet_type === 'OWNED')} owned · ${sum((r) => r.fleet_type === 'HIRED')} hired`} tone="slate" to="/fleet" />
        <KpiCard label="Available" value={sum((r) => r.status === 'AVAILABLE')} tone="green" to="/fleet?status=AVAILABLE" />
        <KpiCard label="On trip" value={sum((r) => r.status === 'ON_TRIP')} to="/fleet?status=ON_TRIP" />
        <KpiCard label="In maintenance" value={sum((r) => r.status === 'MAINTENANCE')} tone="amber" to="/fleet?status=MAINTENANCE" />
        <KpiCard label="Inactive" value={sum((r) => r.status === 'INACTIVE')} tone="slate" to="/fleet?status=INACTIVE" />
      </div>
      <FilterBar active={filtered} onClear={() => clear()}>
        <SearchInput className="w-full sm:w-72" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search code, registration, make, vendor…" />
        <FilterSelect label="Status" value={state.status ?? 'ALL'} onChange={(v) => set({ status: v })} options={[{ value: 'ALL', label: 'All statuses' }, ...VEHICLE_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))]} />
        <FilterSelect label="Fleet type" value={state.fleetType ?? 'ALL'} onChange={(v) => set({ fleetType: v })} options={[{ value: 'ALL', label: 'Owned & hired' }, { value: 'OWNED', label: 'Owned' }, { value: 'HIRED', label: 'Hired' }]} />
        <FilterSelect label="Home plant" value={state.plantId ?? 'ALL'} onChange={(v) => set({ plantId: v })} options={[{ value: 'ALL', label: 'All plants' }, ...(plants.data?.data ?? []).filter((p: any) => p.type === 'PLANT').map((p: any) => ({ value: String(p.id), label: p.name }))]} />
        <FilterSelect label="Compliance" value={state.docIssue ?? 'ALL'} onChange={(v) => set({ docIssue: v })} options={[{ value: 'ALL', label: 'Any compliance' }, { value: 'true', label: 'Documents expiring / expired' }]} />
      </FilterBar>
      <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(v) => v.id} onRowClick={(v) => nav(`/fleet/${v.id}`)} sort={sort} dir={state.sort ? dir : 'asc'} onSort={onSort}
        page={page} pageSize={15} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No vehicles found', description: 'Adjust the filters or add a vehicle to the fleet.' }} />
      {adding && <VehicleForm onClose={() => setAdding(false)} onSaved={(v) => nav(`/fleet/${v.id}`)} />}
      <span className="hidden">{fmtNum(0)}</span>
    </>
  );
}

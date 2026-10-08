import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DRIVER_STATUSES } from '@gasman/shared';
import { useAuth } from '../lib/auth';
import { fmtDate, titleCase } from '../lib/format';
import { useList, useQueryState, useSort } from '../lib/hooks';
import { Button } from '../ui/Button';
import { FilterSelect } from '../ui/Form';
import { PageHeader } from '../ui/Page';
import { Pill, StatusPill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';
import { usePlants } from '../features/common';
import { DriverForm } from '../features/forms';

export default function Drivers() {
  const nav = useNavigate(); const { can } = useAuth(); const [adding, setAdding] = useState(false);
  const { state, set, clear, page } = useQueryState(); const { sort, dir, onSort } = useSort(state, set as any, 'name'); const plants = usePlants();
  const { data, isLoading, error, refetch } = useList('/drivers', { page, pageSize: 15, q: state.q, status: state.status, plantId: state.plantId, docIssue: state.docIssue, sort, dir: state.sort ? dir : 'asc' }, { refetchInterval: 30_000 });
  const cols: Column<any>[] = [
    { key: 'name', header: 'Driver', sortKey: 'name', render: (d) => <div><p className="font-semibold text-brand-700">{d.full_name}</p><p className="text-xs text-slate-500">{d.employee_id}</p></div> },
    { key: 'phone', header: 'Phone', hideBelow: 'md', render: (d) => d.phone ?? '—' },
    { key: 'lic', header: 'Licence expiry', hideBelow: 'md', render: (d) => <span className="tabular-nums">{fmtDate(d.license_expiry)}</span> },
    { key: 'exp', header: 'Experience', sortKey: 'experience', hideBelow: 'lg', render: (d) => `${d.experience_years} yrs` },
    { key: 'veh', header: 'Assigned vehicle', hideBelow: 'lg', render: (d) => d.current_trip_code ? <span>{d.assigned_vehicle_code ?? '—'}<span className="block text-xs text-slate-500">{d.current_trip_code}</span></span> : d.assigned_vehicle_code ?? <span className="text-slate-400">—</span> },
    { key: 'safety', header: 'Safety', sortKey: 'safety', hideBelow: 'lg', render: (d) => <Pill tone={d.safety_score >= 90 ? 'green' : d.safety_score >= 75 ? 'amber' : 'red'} dot={false}>{d.safety_score}</Pill> },
    { key: 'docs', header: 'Compliance', render: (d) => d.docs_expired ? <Pill tone="red">{d.docs_expired} expired</Pill> : d.docs_expiring ? <Pill tone="amber">{d.docs_expiring} expiring</Pill> : <Pill tone="green">Valid</Pill> },
    { key: 'status', header: 'Status', sortKey: 'status', render: (d) => <StatusPill status={d.status} /> },
  ];
  return (
    <>
      <PageHeader title="Drivers" subtitle="Driver roster, licences and availability" breadcrumbs={[{ label: 'Resources' }, { label: 'Drivers' }]} actions={can('drivers:create') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add driver</Button>} />
      <FilterBar active={['q', 'status', 'plantId', 'docIssue'].some((k) => state[k])} onClear={() => clear()}>
        <SearchInput className="w-full sm:w-72" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search name, employee ID, phone, licence…" />
        <FilterSelect label="Status" value={state.status ?? 'ALL'} onChange={(v) => set({ status: v })} options={[{ value: 'ALL', label: 'All statuses' }, ...DRIVER_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))]} />
        <FilterSelect label="Home plant" value={state.plantId ?? 'ALL'} onChange={(v) => set({ plantId: v })} options={[{ value: 'ALL', label: 'All plants' }, ...(plants.data?.data ?? []).filter((p: any) => p.type === 'PLANT').map((p: any) => ({ value: String(p.id), label: p.name }))]} />
        <FilterSelect label="Compliance" value={state.docIssue ?? 'ALL'} onChange={(v) => set({ docIssue: v })} options={[{ value: 'ALL', label: 'Any compliance' }, { value: 'true', label: 'Documents expiring / expired' }]} />
      </FilterBar>
      <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(d) => d.id} onRowClick={(d) => nav(`/drivers/${d.id}`)} sort={sort} dir={state.sort ? dir : 'asc'} onSort={onSort}
        page={page} pageSize={15} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No drivers found' }} />
      {adding && <DriverForm onClose={() => setAdding(false)} onSaved={(d) => nav(`/drivers/${d.id}`)} />}
    </>
  );
}

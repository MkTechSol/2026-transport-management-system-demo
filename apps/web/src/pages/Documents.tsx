import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DOC_TYPE_LABELS, DOC_TYPES } from '@gasman/shared';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import { useList, useQueryState, useSort } from '../lib/hooks';
import { Button } from '../ui/Button';
import { FilterSelect } from '../ui/Form';
import { KpiCard, PageHeader } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';
import { DocumentModal } from '../features/forms';

export default function Documents() {
  const { can } = useAuth(); const { state, set, clear, page } = useQueryState({ status: 'EXPIRED,EXPIRING_SOON' }); const { sort, dir, onSort } = useSort(state, set as any, 'expiry');
  const [renew, setRenew] = useState<any>(null);
  const { data, isLoading, error, refetch } = useList('/documents', { page, pageSize: 20, q: state.q, status: state.status, owner: state.owner, docType: state.docType, sort: state.sort ?? 'expiry', dir: state.sort ? dir : 'asc' });
  const s = data?.summary;
  const cols: Column<any>[] = [
    { key: 'owner', header: 'Vehicle / driver', render: (d) => d.vehicle_id ? <Link to={`/fleet/${d.vehicle_id}?tab=documents`} className="font-semibold text-brand-700 hover:underline">{d.vehicle_code}</Link> : <Link to={`/drivers/${d.driver_id}?tab=documents`} className="font-semibold text-brand-700 hover:underline">{d.driver_name}</Link> },
    { key: 'kind', header: 'Owner', hideBelow: 'md', render: (d) => (d.vehicle_id ? 'Vehicle' : 'Driver') },
    { key: 'type', header: 'Document', sortKey: 'type', render: (d) => DOC_TYPE_LABELS[d.doc_type] },
    { key: 'num', header: 'Number', hideBelow: 'lg', render: (d) => d.doc_number ?? '—' },
    { key: 'exp', header: 'Expires', sortKey: 'expiry', render: (d) => <span className="tabular-nums">{fmtDate(d.expires_on)}</span> },
    { key: 'left', header: 'Days left', hideBelow: 'md', render: (d) => <span className={`tabular-nums ${d.days_left < 0 ? 'font-semibold text-red-600' : d.days_left <= 30 ? 'font-semibold text-amber-700' : ''}`}>{d.days_left}</span> },
    { key: 'status', header: 'Status', render: (d) => <StatusPill status={d.status} /> },
    { key: 'act', header: '', render: (d) => can('documents:manage') && <div className="text-right"><Button size="sm" onClick={() => setRenew(d)}>Renew</Button></div> },
  ];
  return (
    <>
      <PageHeader title="Document Compliance" subtitle="Registration, insurance, fitness, permits, licences and certificates — current documents only" breadcrumbs={[{ label: 'Compliance & Safety' }, { label: 'Documents' }]} />
      <div className="mb-4 grid grid-cols-3 gap-3"><KpiCard label="Expired" value={s?.expired ?? '–'} tone="red" to="/documents?status=EXPIRED" /><KpiCard label="Expiring ≤ 30 days" value={s?.expiring ?? '–'} tone="amber" to="/documents?status=EXPIRING_SOON" /><KpiCard label="Active" value={s?.active ?? '–'} tone="green" to="/documents?status=ACTIVE" /></div>
      <FilterBar active={!!(state.q || state.owner || state.docType || state.status !== 'EXPIRED,EXPIRING_SOON')} onClear={() => clear()}>
        <SearchInput className="w-full sm:w-72" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search vehicle, driver, number…" />
        <FilterSelect label="Status" value={state.status ?? 'ALL'} onChange={(v) => set({ status: v === 'ALL' ? 'ACTIVE,EXPIRING_SOON,EXPIRED' : v })} options={[{ value: 'EXPIRED,EXPIRING_SOON', label: 'Needs attention' }, { value: 'EXPIRED', label: 'Expired' }, { value: 'EXPIRING_SOON', label: 'Expiring soon' }, { value: 'ACTIVE', label: 'Active' }, { value: 'ALL', label: 'All' }]} />
        <FilterSelect label="Owner" value={state.owner ?? 'ALL'} onChange={(v) => set({ owner: v })} options={[{ value: 'ALL', label: 'Vehicles & drivers' }, { value: 'VEHICLE', label: 'Vehicles' }, { value: 'DRIVER', label: 'Drivers' }]} />
        <FilterSelect label="Type" value={state.docType ?? 'ALL'} onChange={(v) => set({ docType: v })} options={[{ value: 'ALL', label: 'All document types' }, ...[...DOC_TYPES.VEHICLE, ...DOC_TYPES.DRIVER].map((t) => ({ value: t, label: DOC_TYPE_LABELS[t] }))]} />
      </FilterBar>
      <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(d) => d.id} sort={sort} dir={state.sort ? dir : 'asc'} onSort={onSort} page={page} pageSize={20} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No documents match', description: 'Nothing is expired or expiring with these filters.' }} />
      {renew && <DocumentModal owner={renew.vehicle_id ? { kind: 'VEHICLE', id: renew.vehicle_id, label: renew.vehicle_code } : { kind: 'DRIVER', id: renew.driver_id, label: renew.driver_name }} defaultType={renew.doc_type} onClose={() => { setRenew(null); refetch(); }} />}
    </>
  );
}

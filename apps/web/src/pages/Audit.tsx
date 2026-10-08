import { fmtDateTime, titleCase } from '../lib/format';
import { useList, useQueryState } from '../lib/hooks';
import { FilterSelect } from '../ui/Form';
import { PageHeader } from '../ui/Page';
import { Pill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';

const ENTITIES = ['TRIP', 'VEHICLE', 'DRIVER', 'USER', 'DISTRIBUTOR', 'LOCATION', 'MAINTENANCE', 'INCIDENT', 'DOCUMENT', 'REPORT', 'SYSTEM'];
const ACTIONS = ['LOGIN', 'LOGIN_FAILED', 'CREATE', 'UPDATE', 'ARCHIVE', 'ASSIGN', 'DISPATCH', 'STATUS_CHANGE', 'CANCEL', 'COMPLETE', 'SAFETY_CHECK', 'DOCUMENT_ADDED', 'INCIDENT_REPORTED', 'REPORT_EXPORT', 'USER_DISABLED', 'PASSWORD_RESET', 'DEMO_RESET'];
const tone = (a: string) => (a.includes('FAILED') || a === 'CANCEL' || a === 'ARCHIVE' || a === 'USER_DISABLED' ? 'red' : a === 'DISPATCH' || a === 'COMPLETE' ? 'green' : a === 'LOGIN' ? 'slate' : 'blue');

export default function Audit() {
  const { state, set, clear, page } = useQueryState();
  const { data, isLoading, error, refetch } = useList('/audit-logs', { page, pageSize: 25, q: state.q, action: state.action, entityType: state.entityType, from: state.from, to: state.to });
  const cols: Column<any>[] = [
    { key: 'when', header: 'Time', render: (a) => <span className="whitespace-nowrap tabular-nums">{fmtDateTime(a.created_at)}</span> },
    { key: 'user', header: 'User', render: (a) => a.user_email ?? 'system' },
    { key: 'action', header: 'Action', render: (a) => <Pill tone={tone(a.action) as any} dot={false}>{titleCase(a.action)}</Pill> },
    { key: 'entity', header: 'Entity', render: (a) => <div><p className="font-medium">{a.entity_label ?? '—'}</p><p className="text-xs text-slate-500">{titleCase(a.entity_type)}{a.entity_id ? ` #${a.entity_id}` : ''}</p></div> },
    { key: 'meta', header: 'Details', hideBelow: 'lg', render: (a) => (a.meta ? <code className="block max-w-xs truncate rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{JSON.stringify(a.meta)}</code> : <span className="text-slate-400">—</span>) },
    { key: 'ip', header: 'IP', hideBelow: 'lg', render: (a) => <span className="text-xs text-slate-500">{a.ip}</span> },
  ];
  return (
    <>
      <PageHeader title="Audit Log" subtitle="Who did what, and when — logins, changes, dispatches and status updates" breadcrumbs={[{ label: 'Administration' }, { label: 'Audit log' }]} />
      <FilterBar active={['q', 'action', 'entityType', 'from', 'to'].some((k) => state[k])} onClear={() => clear()}>
        <SearchInput className="w-full sm:w-72" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search user, entity, action…" />
        <FilterSelect label="Action" value={state.action ?? 'ALL'} onChange={(v) => set({ action: v })} options={[{ value: 'ALL', label: 'All actions' }, ...ACTIONS.map((a) => ({ value: a, label: titleCase(a) }))]} />
        <FilterSelect label="Entity" value={state.entityType ?? 'ALL'} onChange={(v) => set({ entityType: v })} options={[{ value: 'ALL', label: 'All entities' }, ...ENTITIES.map((a) => ({ value: a, label: titleCase(a) }))]} />
        <div className="flex items-center gap-1.5 text-sm text-slate-500"><input type="date" aria-label="From" className="input w-auto py-2" value={state.from ?? ''} onChange={(e) => set({ from: e.target.value })} />–<input type="date" aria-label="To" className="input w-auto py-2" value={state.to ?? ''} onChange={(e) => set({ to: e.target.value })} /></div>
      </FilterBar>
      <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(a) => a.id} dense page={page} pageSize={25} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No audit entries match' }} />
    </>
  );
}

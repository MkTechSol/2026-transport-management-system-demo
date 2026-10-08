import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, EXPENSE_STATUSES } from '@gasman/shared';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtPkr, titleCase } from '../lib/format';
import { useList, useQueryState, useSort } from '../lib/hooks';
import { Button } from '../ui/Button';
import { FilterSelect } from '../ui/Form';
import { KpiCard, PageHeader, Section } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';
import { HBarChart } from '../ui/charts';
import { ExpenseModal } from '../features/forms';

export default function Expenses() {
  const { can } = useAuth(); const [add, setAdd] = useState(false);
  const { state, set, clear, page } = useQueryState(); const { sort, dir, onSort } = useSort(state, set as any, 'date');
  const { data, isLoading, error, refetch } = useList('/expenses', { page, pageSize: 15, q: state.q, status: state.status, category: state.category, from: state.from, to: state.to, sort: state.sort, dir: state.sort ? dir : undefined }, { refetchInterval: 30_000 });
  const s = data?.summary;
  const cols: Column<any>[] = [
    { key: 'date', header: 'Date', sortKey: 'date', render: (e) => <span className="whitespace-nowrap tabular-nums">{fmtDate(e.incurred_on)}</span> },
    { key: 'trip', header: 'Trip', sortKey: 'trip', render: (e) => <Link to={`/trips/${e.trip_id}?tab=expenses`} className="font-semibold text-brand-700 hover:underline">{e.trip_code}</Link> },
    { key: 'who', header: 'Vehicle / driver', hideBelow: 'md', render: (e) => <div><p>{e.vehicle_code ?? '—'}</p><p className="text-xs text-slate-500">{e.driver_name}</p></div> },
    { key: 'cat', header: 'Category', render: (e) => <div><p className="font-medium">{EXPENSE_CATEGORY_LABELS[e.category] ?? e.category}</p><p className="max-w-xs truncate text-xs text-slate-500">{e.description}</p></div> },
    { key: 'amt', header: 'Amount', sortKey: 'amount', render: (e) => <span className="tabular-nums">{fmtPkr(e.amount)}</span> },
    { key: 'by', header: 'Submitted by', hideBelow: 'lg', render: (e) => e.submitted_by_name ?? 'System' },
    { key: 'status', header: 'Status', sortKey: 'status', render: (e) => <div><StatusPill status={e.status} />{e.decision_note && e.status === 'REJECTED' && <p className="mt-1 max-w-[12rem] text-xs text-red-600">{e.decision_note}</p>}</div> },
  ];
  return (
    <>
      <PageHeader title="Expense Control Center" subtitle="Trip expense vouchers: fuel, tolls, driver allowance, tour stay and more" breadcrumbs={[{ label: 'Fuel & Expenses' }, { label: 'Expenses' }]}
        actions={<>{can('approvals:view') && <Link to="/approvals" className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium hover:bg-slate-50">Approval Center</Link>}{can('expenses:record') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdd(true)}>Record expense</Button>}</>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Pending approval" value={s ? fmtPkr(s.pending_amount) : '–'} hint={`${s?.pending_count ?? 0} voucher(s)`} tone="amber" to="/expenses?status=SUBMITTED" />
        <KpiCard label="Approved" value={s ? fmtPkr(s.approved_amount) : '–'} tone="green" to="/expenses?status=APPROVED" />
        <KpiCard label="Rejected" value={s ? fmtPkr(s.rejected_amount) : '–'} tone="red" to="/expenses?status=REJECTED" />
        <KpiCard label="Auto-approved limit" value="Settings" hint="Change in Settings → Transportation" tone="slate" to="/settings" />
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_380px]">
        <div>
          <FilterBar active={['q', 'status', 'category', 'from', 'to'].some((k) => state[k])} onClear={() => clear()}>
            <SearchInput className="w-full sm:w-64" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search trip, vehicle, driver…" />
            <FilterSelect label="Status" value={state.status ?? 'ALL'} onChange={(v) => set({ status: v })} options={[{ value: 'ALL', label: 'All statuses' }, ...EXPENSE_STATUSES.map((x) => ({ value: x, label: titleCase(x) }))]} />
            <FilterSelect label="Category" value={state.category ?? 'ALL'} onChange={(v) => set({ category: v })} options={[{ value: 'ALL', label: 'All categories' }, ...EXPENSE_CATEGORIES.map((x) => ({ value: x, label: EXPENSE_CATEGORY_LABELS[x] }))]} />
            <div className="flex items-center gap-1.5 text-sm text-slate-500"><input type="date" aria-label="From" className="input w-auto py-2" value={state.from ?? ''} onChange={(e) => set({ from: e.target.value })} />–<input type="date" aria-label="To" className="input w-auto py-2" value={state.to ?? ''} onChange={(e) => set({ to: e.target.value })} /></div>
          </FilterBar>
          <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(e) => e.id} sort={sort} dir={dir} onSort={onSort} page={page} pageSize={15} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No expenses match' }} />
        </div>
        <Section title="Spend by category" subtitle="Current filters, PKR">{data?.byCategory?.length ? <HBarChart unit="PKR" data={data.byCategory.map((c: any) => ({ name: EXPENSE_CATEGORY_LABELS[c.category] ?? c.category, mt: c.amount }))} /> : <p className="py-10 text-center text-sm text-slate-500">No data</p>}</Section>
      </div>
      {add && <ExpenseModal onClose={() => { setAdd(false); refetch(); }} />}
    </>
  );
}

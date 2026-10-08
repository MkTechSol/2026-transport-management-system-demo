import { Download } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import clsx from 'clsx';
import { download, get, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime, fmtNum, regionLabel, titleCase } from '../lib/format';
import { useList, useQueryState } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Feedback';
import { FilterSelect } from '../ui/Form';
import { PageHeader } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { DataTable, FilterBar } from '../ui/Table';
import { useDriverOptions, usePlants, useVehicleOptions } from '../features/common';
import { useToast } from '../ui/Toast';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const PRESETS = [['7 days', 7], ['30 days', 30], ['90 days', 90], ['This year', 365]] as const;

export default function Reports() {
  const { can } = useAuth(); const { toast } = useToast();
  const list = useQuery({ queryKey: ['/reports', 'list'], queryFn: () => get('/reports'), staleTime: Infinity });
  const { state, set, page } = useQueryState({ type: 'trips', from: iso(new Date(Date.now() - 29 * 86400000)), to: iso(new Date()) });
  const plants = usePlants(); const vehicles = useVehicleOptions(); const drivers = useDriverOptions(); const [busy, setBusy] = useState(false);
  const params = { page, pageSize: 20, from: state.from, to: state.to, plantId: state.plantId, vehicleId: state.vehicleId, driverId: state.driverId, region: state.region, status: state.status };
  const { data, isLoading, error, refetch } = useList(`/reports/${state.type}`, params);
  const rep = data?.report;
  const dateless = state.type === 'document-expiry';
  const cell = (c: any, row: any) => {
    const v = row[c.key];
    if (v == null || v === '') return <span className="text-slate-400">—</span>;
    if (c.type === 'status') return <StatusPill status={v} />;
    if (c.type === 'datetime') return <span className="tabular-nums">{fmtDateTime(v)}</span>;
    if (c.type === 'date') return <span className="tabular-nums">{fmtDate(v)}</span>;
    if (c.type === 'percent') return <span className="tabular-nums">{v}%</span>;
    if (c.type === 'number') return <span className="tabular-nums">{typeof v === 'number' && !Number.isInteger(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : fmtNum(v)}</span>;
    if (c.key === 'region') return regionLabel(v);
    if (['type', 'doc_type'].includes(c.key)) return titleCase(v);
    return v;
  };
  const exportCsv = async () => { setBusy(true); try { await download(`/reports/${state.type}${qs({ ...params, page: undefined, pageSize: undefined, format: 'csv' })}`, `gasman-${state.type}-${state.from}_${state.to}.csv`); toast('success', 'Report exported.'); } catch (e: any) { toast('error', e.message); } finally { setBusy(false); } };
  const cols = (rep?.columns ?? []).map((c: any) => ({ key: c.key, header: c.label, className: c.type === 'number' || c.type === 'percent' ? 'text-right' : undefined, render: (r: any) => cell(c, r) }));
  const showFilter = (k: string) => ({ 'trip-profitability': ['plant', 'vehicle', 'driver', 'region'], 'owner-pnl': ['vehicle'], 'fuel-efficiency': ['vehicle'], 'expense-summary': ['vehicle'], trips: ['plant', 'vehicle', 'driver', 'region', 'status'], 'completed-trips': ['plant', 'vehicle', 'driver', 'region'], 'delayed-trips': ['plant', 'vehicle', 'driver', 'region'], 'fleet-utilization': ['plant', 'vehicle'], 'driver-activity': ['plant', 'driver'], maintenance: ['vehicle', 'status'], 'document-expiry': ['vehicle', 'driver'], 'dispatch-summary': ['plant', 'region'] } as Record<string, string[]>)[state.type]?.includes(k);
  return (
    <>
      <PageHeader title="Reports & Analytics" subtitle="Live reports straight from operational data" breadcrumbs={[{ label: 'Insights' }, { label: 'Reports' }]} actions={can('reports:export') && <Button variant="primary" icon={<Download className="h-4 w-4" />} loading={busy} onClick={exportCsv}>Export CSV</Button>} />
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {(list.data?.reports ?? []).map((r: any) => <button key={r.key} onClick={() => set({ type: r.key, status: undefined })} title={r.description} className={clsx('rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors', state.type === r.key ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white hover:border-brand-500')}>{r.title}</button>)}
      </div>
      {rep && <Alert tone="info" className="mb-4">{rep.description}</Alert>}
      <FilterBar>
        {!dateless && <><div className="flex items-center gap-1.5 text-sm text-slate-500"><input type="date" aria-label="From" className="input w-auto py-2" value={state.from} onChange={(e) => set({ from: e.target.value })} />–<input type="date" aria-label="To" className="input w-auto py-2" value={state.to} onChange={(e) => set({ to: e.target.value })} /></div>
          {PRESETS.map(([l, d]) => <button key={l} onClick={() => set({ from: iso(new Date(Date.now() - (d - 1) * 86400000)), to: iso(new Date()) })} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50">{l}</button>)}</>}
        {showFilter('plant') && <FilterSelect label="Plant" value={state.plantId ?? 'ALL'} onChange={(v) => set({ plantId: v })} options={[{ value: 'ALL', label: 'All plants' }, ...(plants.data?.data ?? []).map((p: any) => ({ value: String(p.id), label: p.name }))]} />}
        {showFilter('vehicle') && <FilterSelect label="Vehicle" value={state.vehicleId ?? 'ALL'} onChange={(v) => set({ vehicleId: v })} options={[{ value: 'ALL', label: 'All vehicles' }, ...(vehicles.data?.data ?? []).map((v: any) => ({ value: String(v.id), label: v.code }))]} />}
        {showFilter('driver') && <FilterSelect label="Driver" value={state.driverId ?? 'ALL'} onChange={(v) => set({ driverId: v })} options={[{ value: 'ALL', label: 'All drivers' }, ...(drivers.data?.data ?? []).map((d: any) => ({ value: String(d.id), label: d.full_name }))]} />}
        {showFilter('region') && <FilterSelect label="Destination region" value={state.region ?? 'ALL'} onChange={(v) => set({ region: v })} options={[{ value: 'ALL', label: 'All regions' }, ...['KPK', 'PUNJAB', 'ISLAMABAD', 'AJK', 'GILGIT_BALTISTAN'].map((r) => ({ value: r, label: regionLabel(r) }))]} />}
        {showFilter('status') && state.type === 'trips' && <FilterSelect label="Status" value={state.status ?? 'ALL'} onChange={(v) => set({ status: v })} options={[{ value: 'ALL', label: 'All statuses' }, ...['COMPLETED', 'CANCELLED', 'DELAYED', 'IN_TRANSIT', 'ASSIGNED', 'PLANNED'].map((s) => ({ value: s, label: titleCase(s) }))]} />}
        {showFilter('status') && state.type === 'maintenance' && <FilterSelect label="Status" value={state.status ?? 'ALL'} onChange={(v) => set({ status: v })} options={[{ value: 'ALL', label: 'All statuses' }, ...['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'].map((s) => ({ value: s, label: titleCase(s) }))]} />}
      </FilterBar>
      {data && Object.keys(data.totals ?? {}).length > 0 && (
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-line bg-white px-4 py-3 text-sm">
          <span className="font-semibold text-slate-700">Totals for current filters:</span>{Object.entries(data.totals as Record<string, number>).map(([k, v]) => <span key={k} className="text-slate-600">{rep?.columns.find((c: any) => c.key === k)?.label}: <b className="tabular-nums text-ink">{v.toLocaleString('en-US', { maximumFractionDigits: 1 })}</b></span>)}
        </div>
      )}
      <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(r: any) => JSON.stringify(r).slice(0, 80) + Math.random()} page={page} pageSize={20} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No data for these filters', description: 'Widen the date range or clear a filter.' }} />
    </>
  );
}

import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { get, qs } from '../lib/api';
import { ErrorState, PageLoader } from '../ui/Feedback';
import { SelectInput } from '../ui/Form';
import { PageHeader } from '../ui/Page';
import { BowzerSelect, ReportTable, useVendors } from '../features/finance';
import { useItems, useWarehouses } from '../features/stock';

const NEEDS: Record<string, ('item' | 'bowzer' | 'warehouse' | 'category' | 'vendor' | 'range')[]> = {
  'inventory-summary': ['category'], 'stock-value': [], 'low-stock': [], 'item-ledger': ['item', 'warehouse', 'range'], 'check-item-stock': ['item'], 'stock-navigation': ['category'], 'vouchers-register': ['range'],
  'vehicle-inventory': ['bowzer', 'category'], 'vehicle-fitment-matrix': ['bowzer'], 'parts-replaced': ['bowzer', 'range'], 'tyre-changes': ['bowzer', 'range'], 'fuel-changes': ['bowzer', 'range'],
  'purchase-register': ['vendor', 'range'], 'purchase-return-register': ['range'], 'vendor-purchases': ['range'],
};

export default function InventoryReports() {
  const { key = 'inventory-summary' } = useParams(); const nav = useNavigate(); const [sp, setSp] = useSearchParams();
  const list = useQuery({ queryKey: ['/inventory/reports'], queryFn: () => get('/inventory/reports'), staleTime: 300_000 });
  const items = useItems(); const wh = useWarehouses(); const vendors = useVendors(); const cats = useQuery({ queryKey: ['/inventory/categories'], queryFn: () => get('/inventory/categories'), staleTime: 60_000 });
  const needs = NEEDS[key] ?? [];
  const p = (k: string) => sp.get(k) ?? '';
  const setP = (o: Record<string, string>) => setSp((cur) => { const n = new URLSearchParams(cur); for (const [k, v] of Object.entries(o)) v ? n.set(k, v) : n.delete(k); return n; }, { replace: true });
  const blocked = (key === 'item-ledger' || key === 'check-item-stock') && !p('itemId');
  const params = { from: p('from') || undefined, to: p('to') || undefined, itemId: p('itemId') || undefined, vehicleId: p('vehicleId') || undefined, warehouseId: p('warehouseId') || undefined, categoryId: p('categoryId') || undefined, vendorId: p('vendorId') || undefined };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/inventory/reports', key, params], queryFn: () => get(`/inventory/reports/${key}${qs(params)}`), enabled: !blocked });
  const groups = [...new Set((list.data?.data ?? []).map((r: any) => r.group))] as string[];
  return <>
    <PageHeader title="Inventory Reports" subtitle="Stock, purchases and everything fitted to, replaced on or consumed by each bowzer" breadcrumbs={[{ label: 'Inventory' }, { label: 'Reports' }]} />
    <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
      <nav aria-label="Report list" className="space-y-4">{groups.map((g) => <div key={g}><p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</p>
        {(list.data?.data ?? []).filter((r: any) => r.group === g).map((r: any) => <button key={r.key} onClick={() => nav(`/inventory/reports/${r.key}`)} className={clsx('block w-full rounded-lg px-3 py-2 text-left text-sm', r.key === key ? 'bg-brand-50 font-semibold text-brand-700' : 'hover:bg-slate-100')}>{r.title}</button>)}</div>)}</nav>
      <div className="min-w-0">
        {needs.length > 0 && <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-3 print:hidden">
          {needs.includes('range') && <><label className="text-xs font-medium text-slate-600">From<input type="date" className="input mt-1" value={p('from')} onChange={(e) => setP({ from: e.target.value })} /></label><label className="text-xs font-medium text-slate-600">To<input type="date" className="input mt-1" value={p('to')} onChange={(e) => setP({ to: e.target.value })} /></label></>}
          {needs.includes('item') && <div className="w-72"><SelectInput label="Item" value={p('itemId')} onChange={(e) => setP({ itemId: e.target.value })} placeholder="Select item" options={(items.data?.data ?? []).map((i: any) => ({ value: i.id, label: `${i.code} · ${i.name}` }))} /></div>}
          {needs.includes('warehouse') && <div className="w-56"><SelectInput label="Store" value={p('warehouseId')} onChange={(e) => setP({ warehouseId: e.target.value })} placeholder="All stores" options={(wh.data?.data ?? []).map((w: any) => ({ value: w.id, label: w.name }))} /></div>}
          {needs.includes('bowzer') && <div className="w-48"><BowzerSelect value={p('vehicleId')} onChange={(v) => setP({ vehicleId: v })} label="Bowzer" /></div>}
          {needs.includes('category') && <div className="w-56"><SelectInput label="Category" value={p('categoryId')} onChange={(e) => setP({ categoryId: e.target.value })} placeholder="All categories" options={(cats.data?.data ?? []).map((c: any) => ({ value: c.id, label: c.name }))} /></div>}
          {needs.includes('vendor') && <div className="w-56"><SelectInput label="Vendor" value={p('vendorId')} onChange={(e) => setP({ vendorId: e.target.value })} placeholder="All vendors" options={(vendors.data?.data ?? []).map((v: any) => ({ value: v.id, label: v.name }))} /></div>}
        </div>}
        {blocked ? <p className="rounded-xl border border-dashed border-line bg-white p-10 text-center text-sm text-slate-500">Choose an item above to run this report.</p>
          : isLoading ? <PageLoader /> : error || !data ? <ErrorState error={error} onRetry={() => refetch()} /> : <ReportTable report={data} fileName={key} />}
      </div>
    </div>
  </>;
}

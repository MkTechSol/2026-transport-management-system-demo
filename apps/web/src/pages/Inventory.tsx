import { ChevronDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, titleCase } from '../lib/format';
import { fieldErrors, useAction, useList, useQueryState } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert, ErrorState, PageLoader } from '../ui/Feedback';
import { FilterSelect, SelectInput, TextInput } from '../ui/Form';
import { Drawer, Modal } from '../ui/Overlay';
import { KV, KVGrid, KpiCard, PageHeader, Section, Tabs } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';
import { NEW_STOCK_TYPES, STOCK_LABELS, StockDocDrawer, StockVoucherModal, useWarehouses } from '../features/stock';
import { money } from '../features/finance';

const useCats = () => useQuery({ queryKey: ['/inventory/categories'], queryFn: () => get('/inventory/categories'), staleTime: 30_000 });
const useBrands = () => useQuery({ queryKey: ['/inventory/brands'], queryFn: () => get('/inventory/brands'), staleTime: 30_000 });
const KINDS = ['SPARE', 'TYRE', 'CAMERA', 'ACCESSORY', 'LUBRICANT', 'SAFETY', 'TOOL', 'OTHER'];

function ItemModal({ item, onClose }: { item?: any; onClose: () => void }) {
  const cats = useCats(); const brands = useBrands();
  const [f, setF] = useState({ code: item?.code ?? '', name: item?.name ?? '', categoryId: String(item?.category_id ?? ''), subcategoryId: String(item?.subcategory_id ?? ''), brandId: String(item?.brand_id ?? ''), madeIn: item?.made_in ?? '', unit: item?.unit ?? 'PCS', minLevel: String(item?.min_level ?? 0), reorderQty: String(item?.reorder_qty ?? 0), serialized: !!item?.serialized, notes: item?.notes ?? '' });
  const set = (k: string) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  const subs: any[] = (cats.data?.data ?? []).find((c: any) => String(c.id) === f.categoryId)?.subcategories ?? [];
  const body = () => ({ code: f.code, name: f.name, categoryId: Number(f.categoryId), subcategoryId: f.subcategoryId ? Number(f.subcategoryId) : null, brandId: f.brandId ? Number(f.brandId) : null, madeIn: f.madeIn || null, unit: f.unit, minLevel: Number(f.minLevel || 0), reorderQty: Number(f.reorderQty || 0), serialized: f.serialized, notes: f.notes || null });
  const m = useAction(() => (item ? patch(`/inventory/items/${item.id}`, body()) : post('/inventory/items', body())), { invalidate: ['/inventory'], success: 'Item saved.', onSuccess: onClose }); const fe = fieldErrors(m.error);
  return <Modal open onClose={onClose} size="lg" title={item ? `Edit ${item.code}` : 'New item'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Save (F10)</Button></>}>
    <div className="grid gap-4 sm:grid-cols-2">{m.error && !m.error.fields && <div className="sm:col-span-2"><Alert tone="danger">{m.error.message}</Alert></div>}
      <TextInput label="Item code" required value={f.code} onChange={set('code')} error={fe.code} disabled={!!item} placeholder="e.g. FLT-CABIN" /><TextInput label="Item name" required value={f.name} onChange={set('name')} error={fe.name} />
      <SelectInput label="Category" required value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value, subcategoryId: '' })} placeholder="Select category" error={fe.categoryId} options={(cats.data?.data ?? []).map((c: any) => ({ value: c.id, label: c.name }))} />
      <SelectInput label="Sub-category" value={f.subcategoryId} onChange={set('subcategoryId')} placeholder="—" options={subs.map((s: any) => ({ value: s.id, label: s.name }))} />
      <SelectInput label="Brand" value={f.brandId} onChange={set('brandId')} placeholder="—" options={(brands.data?.data ?? []).map((b: any) => ({ value: b.id, label: b.name }))} /><TextInput label="Made in" value={f.madeIn} onChange={set('madeIn')} />
      <TextInput label="Unit" value={f.unit} onChange={set('unit')} /><div />
      <TextInput label="Minimum level" type="number" min="0" value={f.minLevel} onChange={set('minLevel')} hint="Low-stock alert at or below this" error={fe.minLevel} /><TextInput label="Reorder quantity" type="number" min="0" value={f.reorderQty} onChange={set('reorderQty')} />
      {!item && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.serialized} onChange={(e) => setF({ ...f, serialized: e.target.checked })} /> Track each unit by serial number (tyres, batteries with warranty…)</label>}
    </div></Modal>;
}

function ItemDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { can } = useAuth(); const [edit, setEdit] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/inventory/items', id], queryFn: () => get(`/inventory/items/${id}`) });
  const it = data?.item;
  return <Drawer open onClose={onClose} width="max-w-2xl" title={it ? `${it.code} · ${it.name}` : 'Item'} description={it ? `${it.category_name}${it.subcategory_name ? ` › ${it.subcategory_name}` : ''}` : undefined} footer={it && can('inventory:manage') ? <Button onClick={() => setEdit(true)}>Edit item</Button> : undefined}>
    {isLoading ? <PageLoader /> : error || !it ? <ErrorState error={error} onRetry={() => refetch()} /> : <div className="space-y-5">
      <KVGrid cols={3}><KV label="Brand">{it.brand_name ?? '—'}</KV><KV label="Made in">{it.made_in ?? '—'}</KV><KV label="Unit">{it.unit}</KV><KV label="Average cost">PKR {money(it.avg_cost)}</KV><KV label="Minimum level">{Number(it.min_level)}</KV><KV label="Tracking">{it.serialized ? 'By serial number' : 'By quantity'}</KV></KVGrid>
      <Section title="Where it is now" padded={false}><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Held in</th><th className="th">Store / bowzer</th><th className="th text-right">Qty</th><th className="th text-right">Value</th></tr></thead>
        <tbody className="divide-y divide-line">{data.holders.map((h: any) => <tr key={h.holder_type + h.holder_id}><td className="td">{h.holder_type === 'WAREHOUSE' ? 'Store' : 'Bowzer'}</td><td className="td font-medium">{h.holder_name}</td><td className="td text-right tabular-nums">{h.qty}</td><td className="td text-right tabular-nums">{money(h.value)}</td></tr>)}{!data.holders.length && <tr><td colSpan={4} className="td py-6 text-center text-slate-500">No stock anywhere.</td></tr>}</tbody></table></Section>
      <Section title="Recent movements" padded={false}><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Date</th><th className="th">Document</th><th className="th">Holder</th><th className="th text-right">Qty</th></tr></thead>
        <tbody className="divide-y divide-line">{data.movements.map((m: any, i: number) => <tr key={i}><td className="td whitespace-nowrap">{fmtDate(m.movement_date)}</td><td className="td"><p>{m.doc_no}</p><p className="text-xs text-slate-500">{STOCK_LABELS[m.type]}</p></td><td className="td">{m.holder_name}</td><td className={`td text-right tabular-nums ${m.qty < 0 ? 'text-red-600' : 'text-green-700'}`}>{m.qty > 0 ? '+' : ''}{m.qty}</td></tr>)}</tbody></table></Section>
    </div>}
    {edit && it && <ItemModal item={it} onClose={() => { setEdit(false); refetch(); }} />}
  </Drawer>;
}

function ItemsTab() {
  const { can } = useAuth(); const cats = useCats(); const { state, set, clear, page } = useQueryState(); const [open, setOpen] = useState<number | null>(null); const [adding, setAdding] = useState(false);
  const { data, isLoading, error, refetch } = useList('/inventory/items', { page, pageSize: 15, q: state.q, categoryId: state.cat, low: state.low, sort: state.sort, dir: state.dir });
  const cols: Column<any>[] = [
    { key: 'code', header: 'Item', sortKey: 'name', render: (i) => <div><p className="font-semibold text-brand-700">{i.name}</p><p className="text-xs text-slate-500">{i.code}{i.serialized ? ' · serial tracked' : ''}</p></div> },
    { key: 'cat', header: 'Category', sortKey: 'category', hideBelow: 'md', render: (i) => <div><p>{i.category_name}</p><p className="text-xs text-slate-500">{i.subcategory_name}</p></div> },
    { key: 'brand', header: 'Brand', hideBelow: 'lg', render: (i) => <div><p>{i.brand_name ?? '—'}</p><p className="text-xs text-slate-500">{i.made_in}</p></div> },
    { key: 'store', header: 'In store', render: (i) => <span className={`tabular-nums ${Number(i.min_level) > 0 && i.in_store <= Number(i.min_level) ? 'font-semibold text-red-600' : ''}`}>{i.in_store} {i.unit}</span> },
    { key: 'fit', header: 'On bowzers', hideBelow: 'md', render: (i) => <span className="tabular-nums">{i.fitted}</span> },
    { key: 'cost', header: 'Avg cost', sortKey: 'cost', hideBelow: 'lg', render: (i) => <span className="tabular-nums">{money(i.avg_cost)}</span> },
    { key: 'val', header: 'Value', render: (i) => <span className="tabular-nums">{money(i.value)}</span> },
  ];
  return <>
    <FilterBar active={['q', 'cat', 'low'].some((k) => state[k])} onClear={() => clear()}>
      <SearchInput className="w-full sm:w-64" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search item, code, brand…" />
      <FilterSelect label="Category" value={state.cat ?? 'ALL'} onChange={(v) => set({ cat: v })} options={[{ value: 'ALL', label: 'All categories' }, ...(cats.data?.data ?? []).map((c: any) => ({ value: String(c.id), label: c.name }))]} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={state.low === '1'} onChange={(e) => set({ low: e.target.checked ? '1' : undefined })} />Low stock only</label>
      {can('inventory:manage') && <Button className="ml-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New item</Button>}
    </FilterBar>
    <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(i) => i.id} onRowClick={(i) => setOpen(i.id)} page={page} pageSize={15} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No items match' }} />
    {open != null && <ItemDrawer id={open} onClose={() => setOpen(null)} />}{adding && <ItemModal onClose={() => setAdding(false)} />}
  </>;
}

function DocsTab() {
  const { state, set, clear, page } = useQueryState(); const [open, setOpen] = useState<number | null>(null);
  const { data, isLoading, error, refetch } = useList('/inventory/docs', { page, pageSize: 15, q: state.q, type: state.type, from: state.from, to: state.to });
  const cols: Column<any>[] = [
    { key: 'date', header: 'Date', render: (d) => <span className="whitespace-nowrap tabular-nums">{fmtDate(d.doc_date)}</span> }, { key: 'no', header: 'Voucher', render: (d) => <span className="font-semibold text-brand-700">{d.doc_no}</span> }, { key: 'type', header: 'Type', render: (d) => STOCK_LABELS[d.type] ?? d.type },
    { key: 'flow', header: 'Flow', hideBelow: 'md', render: (d) => <span className="text-sm">{d.vendor_name ? `${d.vendor_name} ${d.type === 'PURCHASE_RETURN' ? '←' : '→'} ` : ''}{[d.from_name, d.to_name].filter(Boolean).join(' → ') || d.vehicle_code}</span> },
    { key: 'lines', header: 'Lines', hideBelow: 'lg', render: (d) => d.lines }, { key: 'val', header: 'Value', render: (d) => <span className="tabular-nums">{money(d.total_value)}</span> }, { key: 'st', header: 'Status', render: (d) => <StatusPill status={d.status} /> },
  ];
  return <>
    <FilterBar active={['q', 'type', 'from', 'to'].some((k) => state[k])} onClear={() => clear()}>
      <SearchInput className="w-full sm:w-64" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search voucher no., vendor, narration…" />
      <FilterSelect label="Type" value={state.type ?? 'ALL'} onChange={(v) => set({ type: v })} options={[{ value: 'ALL', label: 'All types' }, ...Object.entries(STOCK_LABELS).map(([k, l]) => ({ value: k, label: l }))]} />
      <div className="flex items-center gap-1.5 text-sm text-slate-500"><input type="date" aria-label="From" className="input w-auto py-2" value={state.from ?? ''} onChange={(e) => set({ from: e.target.value })} />to<input type="date" aria-label="To" className="input w-auto py-2" value={state.to ?? ''} onChange={(e) => set({ to: e.target.value })} /></div>
    </FilterBar>
    <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(d) => d.id} onRowClick={(d) => setOpen(d.id)} page={page} pageSize={15} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No stock vouchers' }} />
    {open != null && <StockDocDrawer id={open} onClose={() => setOpen(null)} />}
  </>;
}

function WarehousesTab() {
  const { can } = useAuth(); const wh = useWarehouses(); const [name, setName] = useState(''); const [adding, setAdding] = useState(false);
  const add = useAction(() => post('/inventory/warehouses', { name }), { invalidate: ['/inventory'], success: 'Store added.', onSuccess: () => { setAdding(false); setName(''); } });
  if (wh.isLoading) return <PageLoader />;
  return <div>
    <div className="mb-3 flex justify-end">{can('inventory:manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New store</Button>}</div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{(wh.data?.data ?? []).map((w: any) => <div key={w.id} className="card p-4"><p className="text-xs text-slate-500">{w.code}{w.location_name ? ` · ${w.location_name}` : ''}</p><p className="mt-0.5 text-base font-semibold">{w.name}</p>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm"><div><dt className="text-xs text-slate-500">Lines</dt><dd className="font-semibold tabular-nums">{w.lines}</dd></div><div><dt className="text-xs text-slate-500">Units</dt><dd className="font-semibold tabular-nums">{w.units}</dd></div><div><dt className="text-xs text-slate-500">Value</dt><dd className="font-semibold tabular-nums">{money(w.value)}</dd></div></dl></div>)}</div>
    {adding && <Modal open onClose={() => setAdding(false)} title="New store" footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" loading={add.isPending} onClick={() => add.mutate(undefined as never)}>Save (F10)</Button></>}><TextInput label="Store name" required value={name} onChange={(e) => setName(e.target.value)} error={(add.error as any)?.fields?.name} /></Modal>}
  </div>;
}

function MastersTab() {
  const { can } = useAuth(); const cats = useCats(); const brands = useBrands(); const [kind, setKind] = useState<'cat' | 'sub' | 'brand' | null>(null); const [f, setF] = useState({ name: '', kind: 'SPARE', catId: '' });
  const m = useAction(() => (kind === 'cat' ? post('/inventory/categories', { name: f.name, kind: f.kind }) : kind === 'sub' ? post(`/inventory/categories/${f.catId}/subcategories`, { name: f.name }) : post('/inventory/brands', { name: f.name })), { invalidate: ['/inventory'], success: 'Saved.', onSuccess: () => { setKind(null); setF({ name: '', kind: 'SPARE', catId: '' }); } });
  return <div className="grid gap-5 lg:grid-cols-2">
    <Section title="Categories & sub-categories" actions={can('inventory:manage') && <div className="flex gap-2"><Button size="sm" onClick={() => setKind('cat')}>Category</Button><Button size="sm" onClick={() => setKind('sub')}>Sub-category</Button></div>}>
      <ul className="space-y-3 text-sm">{(cats.data?.data ?? []).map((c: any) => <li key={c.id}><p className="font-semibold">{c.name} <span className="text-xs font-normal text-slate-500">· {titleCase(c.kind)} · {c.items} items</span></p><p className="text-slate-600">{c.subcategories.map((s: any) => s.name).join(' · ') || '—'}</p></li>)}</ul></Section>
    <Section title="Brands" actions={can('inventory:manage') && <Button size="sm" onClick={() => setKind('brand')}>New brand</Button>}>
      <ul className="grid grid-cols-2 gap-2 text-sm">{(brands.data?.data ?? []).map((b: any) => <li key={b.id} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2"><span>{b.name}</span><span className="text-slate-500">{b.items}</span></li>)}</ul></Section>
    {kind && <Modal open onClose={() => setKind(null)} title={kind === 'cat' ? 'New category' : kind === 'sub' ? 'New sub-category' : 'New brand'} footer={<><Button onClick={() => setKind(null)}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Save (F10)</Button></>}>
      <div className="grid gap-4">{m.error && !m.error.fields && <Alert tone="danger">{m.error.message}</Alert>}
        {kind === 'sub' && <SelectInput label="Category" required value={f.catId} onChange={(e) => setF({ ...f, catId: e.target.value })} placeholder="Select" options={(cats.data?.data ?? []).map((c: any) => ({ value: c.id, label: c.name }))} />}
        <TextInput label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={(m.error as any)?.fields?.name} />
        {kind === 'cat' && <SelectInput label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={KINDS.map((k) => ({ value: k, label: titleCase(k) }))} />}</div></Modal>}
  </div>;
}

export default function Inventory() {
  const { can } = useAuth(); const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') ?? 'items'; const [menu, setMenu] = useState(false); const [newType, setNewType] = useState<(typeof NEW_STOCK_TYPES)[number] | null>(null);
  const sum = useQuery({ queryKey: ['/inventory/summary'], queryFn: () => get('/inventory/summary') });
  const s = sum.data;
  return <>
    <PageHeader title="Inventory" subtitle="Spares, tyres, cameras, trackers and consumables — in stores and fitted to each bowzer" breadcrumbs={[{ label: 'Inventory' }, { label: 'Items & stock' }]}
      actions={can('inventory:manage') && <div className="relative"><Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setMenu(!menu)}>New stock voucher <ChevronDown className="h-4 w-4" /></Button>
        {menu && <div className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-line bg-white py-1 shadow-pop" role="menu">{NEW_STOCK_TYPES.map((t) => <button key={t} role="menuitem" className="block w-full px-4 py-2 text-left text-sm hover:bg-brand-50" onClick={() => { setMenu(false); setNewType(t); }}>{STOCK_LABELS[t]}</button>)}</div>}</div>} />
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <KpiCard label="Active items" value={s?.items ?? '–'} tone="blue" /><KpiCard label="Stock in stores" value={s ? `PKR ${money(s.warehouse_value)}` : '–'} tone="green" /><KpiCard label="Fitted to bowzers" value={s ? `${s.fitted_units} units` : '–'} hint={s ? `PKR ${money(s.fitted_value)}` : ''} tone="slate" />
      <KpiCard label="Low stock" value={s?.low_stock ?? '–'} tone={s?.low_stock ? 'amber' : 'green'} to="/inventory?low=1" /><KpiCard label="Open requisitions / POs" value={s ? `${s.open_requests} / ${s.open_orders}` : '–'} tone="purple" to="/procurement" />
    </div>
    <Tabs value={tab} onChange={(k) => setSp({ tab: k })} tabs={[{ key: 'items', label: 'Items' }, { key: 'vouchers', label: 'Stock vouchers' }, { key: 'stores', label: 'Stores' }, { key: 'masters', label: 'Categories & brands' }]} />
    <div className="mt-4">{tab === 'items' && <ItemsTab />}{tab === 'vouchers' && <DocsTab />}{tab === 'stores' && <WarehousesTab />}{tab === 'masters' && <MastersTab />}</div>
    {newType && <StockVoucherModal type={newType} onClose={() => setNewType(null)} />}
  </>;
}

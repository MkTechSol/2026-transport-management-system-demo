import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import { fieldErrors, useAction, useList, useQueryState } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert, ErrorState, PageLoader } from '../ui/Feedback';
import { FilterSelect, SelectInput, TextArea, TextInput } from '../ui/Form';
import { Drawer, Modal } from '../ui/Overlay';
import { KV, KVGrid, PageHeader, Tabs } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';
import { useVehicleOptions } from '../features/common';
import { money, today, useBanks, useVendors } from '../features/finance';
import { useItems, useWarehouses } from '../features/stock';

function RequestModal({ onClose }: { onClose: () => void }) {
  const items = useItems(); const veh = useVehicleOptions();
  const [f, setF] = useState({ neededBy: '', vehicleId: '', notes: '' }); const [lines, setLines] = useState([{ itemId: '', qty: '' }]);
  const m = useAction(() => post('/procurement/requests', { neededBy: f.neededBy || null, vehicleId: f.vehicleId ? Number(f.vehicleId) : null, notes: f.notes || undefined, lines: lines.filter((l) => l.itemId).map((l) => ({ itemId: Number(l.itemId), qty: Number(l.qty) })) }),
    { invalidate: ['/procurement', '/approvals', '/inventory'], success: (r: any) => `Requisition ${r.request.pr_no} submitted for approval.`, onSuccess: onClose }); const fe = fieldErrors(m.error);
  return <Modal open onClose={onClose} size="lg" title="New purchase requisition" description="Goes to the approver; quotations and a purchase order follow once approved" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Submit (F10)</Button></>}>
    <div className="grid gap-4 sm:grid-cols-2">{m.error && !m.error.fields && <div className="sm:col-span-2"><Alert tone="danger">{m.error.message}</Alert></div>}
      <TextInput label="Needed by" type="date" min={today()} value={f.neededBy} onChange={(e) => setF({ ...f, neededBy: e.target.value })} /><SelectInput label="For bowzer (optional)" value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })} placeholder="General stock" options={(veh.data?.data ?? []).map((v: any) => ({ value: v.id, label: v.code }))} />
      <div className="sm:col-span-2 space-y-2">{lines.map((l, i) => <div key={i} className="grid grid-cols-[1fr_100px_32px] gap-2"><select aria-label={`Item ${i + 1}`} className="input" value={l.itemId} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, itemId: e.target.value } : x)))}><option value="">Select item…</option>{(items.data?.data ?? []).map((it: any) => <option key={it.id} value={it.id}>{it.code} · {it.name}</option>)}</select>
        <input aria-label={`Qty ${i + 1}`} type="number" min="0" className="input" placeholder="Qty" value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} />{lines.length > 1 ? <button type="button" aria-label={`Remove line ${i + 1}`} className="text-slate-400 hover:text-red-600" onClick={() => setLines(lines.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></button> : <span />}</div>)}
        <button type="button" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline" onClick={() => setLines([...lines, { itemId: '', qty: '' }])}><Plus className="h-4 w-4" />Add item</button>{fe['lines.0.qty'] && <p className="text-xs text-red-600">{fe['lines.0.qty']}</p>}</div>
      <TextArea label="Notes" rows={2} wrapperClassName="sm:col-span-2" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div></Modal>;
}

function QuoteModal({ pr, lines, onClose }: { pr: any; lines: any[]; onClose: () => void }) {
  const vendors = useVendors(); const [vendorId, setVendorId] = useState(''); const [days, setDays] = useState(''); const [rates, setRates] = useState<Record<number, string>>({});
  const m = useAction(() => post(`/procurement/requests/${pr.id}/quotes`, { vendorId: Number(vendorId), deliveryDays: days ? Number(days) : null, rates: lines.map((l) => ({ prLineId: l.id, rate: Number(rates[l.id] ?? 0) })) }), { invalidate: ['/procurement'], success: 'Quotation recorded.', onSuccess: onClose });
  return <Modal open onClose={onClose} title="Record vendor quotation" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!vendorId} loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Save (F10)</Button></>}>
    <div className="grid gap-4">{m.error && <Alert tone="danger">{m.error.message}</Alert>}<SelectInput label="Vendor" required value={vendorId} onChange={(e) => setVendorId(e.target.value)} placeholder="Select vendor" options={(vendors.data?.data ?? []).map((v: any) => ({ value: v.id, label: v.name }))} /><TextInput label="Delivery (days)" type="number" min="0" value={days} onChange={(e) => setDays(e.target.value)} />
      {lines.map((l) => <TextInput key={l.id} label={`${l.code} · ${l.name} — rate per ${l.unit} (qty ${Number(l.qty)})`} type="number" min="0" value={rates[l.id] ?? ''} onChange={(e) => setRates({ ...rates, [l.id]: e.target.value })} />)}</div></Modal>;
}

function RequestDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { can } = useAuth(); const [quote, setQuote] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/procurement/requests', id], queryFn: () => get(`/procurement/requests/${id}`) });
  const order = useAction((quoteId: number) => post(`/procurement/requests/${id}/order`, { quoteId }), { invalidate: ['/procurement', '/inventory'], success: (r: any) => `Purchase order ${r.order.po_no} created.`, onSuccess: () => refetch() });
  const cancel = useAction(() => post(`/procurement/requests/${id}/cancel`, {}), { invalidate: ['/procurement', '/approvals'], success: 'Requisition cancelled.', onSuccess: () => refetch() });
  const pr = data?.request; const cheapest = (lineId: number) => Math.min(...(data?.quotes ?? []).map((q: any) => q.rates[lineId] ?? Infinity));
  const bestTotal = Math.min(...(data?.quotes ?? []).map((q: any) => Number(q.total)));
  return <Drawer open onClose={onClose} width="max-w-3xl" title={pr?.pr_no ?? 'Requisition'} description={pr ? `Requested by ${pr.requested_by_name ?? '—'} · ${fmtDate(pr.pr_date)}` : undefined}
    footer={pr && ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(pr.status) && can('procurement:manage') ? <><Button onClick={() => cancel.mutate(undefined as never)}>Cancel requisition</Button>{['APPROVED', 'SUBMITTED'].includes(pr.status) && <Button variant="primary" onClick={() => setQuote(true)}>Record quotation</Button>}</> : undefined}>
    {isLoading ? <PageLoader /> : error || !pr ? <ErrorState error={error} onRetry={() => refetch()} /> : <div className="space-y-5">
      <KVGrid cols={3}><KV label="Status"><StatusPill status={pr.status} /></KV><KV label="Estimated value">PKR {money(pr.est_value)}</KV><KV label="Needed by">{fmtDate(pr.needed_by)}</KV>{pr.vehicle_code && <KV label="For bowzer">{pr.vehicle_code}</KV>}{pr.notes && <KV label="Notes" className="col-span-3">{pr.notes}</KV>}</KVGrid>
      {pr.status === 'SUBMITTED' && <Alert tone="info">Waiting for approval. Quotations can be collected meanwhile; a purchase order needs the approval first.</Alert>}
      {data.order && <Alert tone="success">Purchase order {data.order.po_no} raised.</Alert>}
      <div className="overflow-x-auto rounded-lg border border-line"><table className="w-full text-sm">
        <thead className="bg-slate-50"><tr><th className="th">Item</th><th className="th text-right">Qty</th>{data.quotes.map((q: any) => <th key={q.id} className="th text-right">{q.vendor_name}{q.selected && ' ✓'}<span className="block text-xs font-normal text-slate-500">{q.delivery_days != null ? `${q.delivery_days} days` : ''}</span></th>)}</tr></thead>
        <tbody className="divide-y divide-line">{data.lines.map((l: any) => <tr key={l.id}><td className="td"><p className="font-medium">{l.code}</p><p className="text-xs text-slate-500">{l.name}</p></td><td className="td text-right tabular-nums">{Number(l.qty)} {l.unit}</td>
          {data.quotes.map((q: any) => <td key={q.id} className={`td text-right tabular-nums ${q.rates[l.id] === cheapest(l.id) ? 'bg-green-50 font-semibold text-green-800' : ''}`}>{money(q.rates[l.id])}</td>)}</tr>)}</tbody>
        {data.quotes.length > 0 && <tfoot className="bg-slate-50 font-semibold"><tr><td className="td" colSpan={2}>Total</td>{data.quotes.map((q: any) => <td key={q.id} className={`td text-right tabular-nums ${Number(q.total) === bestTotal ? 'text-green-800' : ''}`}>{money(q.total)}</td>)}</tr>
          {pr.status === 'APPROVED' && can('procurement:manage') && <tr><td className="td" colSpan={2}>Create purchase order from</td>{data.quotes.map((q: any) => <td key={q.id} className="td text-right"><Button size="sm" variant={Number(q.total) === bestTotal ? 'primary' : 'secondary'} loading={order.isPending && order.variables === q.id} onClick={() => order.mutate(q.id)}>Order</Button></td>)}</tr>}</tfoot>}
      </table>{!data.quotes.length && <p className="px-4 py-6 text-center text-sm text-slate-500">No quotations yet.</p>}</div>
    </div>}
    {quote && data && <QuoteModal pr={pr} lines={data.lines} onClose={() => { setQuote(false); refetch(); }} />}
  </Drawer>;
}

function ReceiveModal({ order, lines, onClose }: { order: any; lines: any[]; onClose: () => void }) {
  const wh = useWarehouses(); const banks = useBanks();
  const [f, setF] = useState({ warehouseId: '', payMode: 'CREDIT', bankId: '', date: today() });
  const open = lines.filter((l) => Number(l.qty) - Number(l.received_qty) > 0);
  const [qty, setQty] = useState<Record<number, string>>(Object.fromEntries(open.map((l) => [l.item_id, String(Number(l.qty) - Number(l.received_qty))])));
  const [serials, setSerials] = useState<Record<number, string>>({});
  const m = useAction(() => post(`/procurement/orders/${order.id}/receive`, { warehouseId: Number(f.warehouseId), payMode: f.payMode, bankId: f.bankId ? Number(f.bankId) : undefined, date: f.date,
    lines: open.filter((l) => Number(qty[l.item_id]) > 0).map((l) => ({ itemId: l.item_id, qty: Number(qty[l.item_id]), ...(l.serialized ? { serialNos: (serials[l.item_id] ?? '').split(/[\s,]+/).filter(Boolean) } : {}) })) }),
    { invalidate: ['/procurement', '/inventory', '/finance', '/tyres'], success: (r: any) => `Goods receipt ${r.doc.doc_no} posted.`, onSuccess: onClose }); const fe = fieldErrors(m.error);
  return <Modal open onClose={onClose} size="lg" title={`Receive goods — ${order.po_no}`} description="Stock goes into the chosen store; the vendor payable is posted at the order rates" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.warehouseId} loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Post receipt (F10)</Button></>}>
    <div className="grid gap-4 sm:grid-cols-3">{m.error && !m.error.fields && <div className="sm:col-span-3"><Alert tone="danger">{m.error.message}</Alert></div>}
      <SelectInput label="Into store" required value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })} placeholder="Select store" options={(wh.data?.data ?? []).map((w: any) => ({ value: w.id, label: w.name }))} />
      <SelectInput label="Paid by" value={f.payMode} onChange={(e) => setF({ ...f, payMode: e.target.value })} options={[{ value: 'CREDIT', label: 'On credit' }, { value: 'CASH', label: 'Cash' }, { value: 'BANK', label: 'Bank' }]} /><TextInput label="Date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
      {f.payMode === 'BANK' && <SelectInput label="Bank" required value={f.bankId} onChange={(e) => setF({ ...f, bankId: e.target.value })} placeholder="Select bank" error={fe.bankId} options={(banks.data?.data ?? []).map((b: any) => ({ value: b.id, label: b.name }))} />}
      {open.map((l) => <div key={l.id} className="sm:col-span-3 grid grid-cols-[1fr_120px] gap-3 rounded-lg border border-line p-3"><div><p className="font-medium">{l.code} · {l.name}</p><p className="text-xs text-slate-500">Open {Number(l.qty) - Number(l.received_qty)} of {Number(l.qty)} @ {money(l.rate)}</p>
        {l.serialized && <TextInput label="Serial numbers (comma or space separated)" value={serials[l.item_id] ?? ''} onChange={(e) => setSerials({ ...serials, [l.item_id]: e.target.value })} error={fe.serialNos} wrapperClassName="mt-2" />}</div>
        <TextInput label="Receive qty" type="number" min="0" value={qty[l.item_id] ?? ''} onChange={(e) => setQty({ ...qty, [l.item_id]: e.target.value })} error={fe.qty} /></div>)}</div></Modal>;
}

function OrderDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { can } = useAuth(); const [recv, setRecv] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/procurement/orders', id], queryFn: () => get(`/procurement/orders/${id}`) });
  const cancel = useAction(() => post(`/procurement/orders/${id}/cancel`, {}), { invalidate: ['/procurement'], success: 'Purchase order cancelled.', onSuccess: () => refetch() });
  const o = data?.order;
  return <Drawer open onClose={onClose} width="max-w-2xl" title={o?.po_no ?? 'Purchase order'} description={o ? `${o.vendor_name} · ${fmtDate(o.po_date)}` : undefined}
    footer={o && ['OPEN', 'PARTIAL'].includes(o.status) ? <>{o.status === 'OPEN' && can('procurement:manage') && <Button onClick={() => cancel.mutate(undefined as never)}>Cancel order</Button>}{can('inventory:manage') && <Button variant="primary" onClick={() => setRecv(true)}>Receive goods</Button>}</> : undefined}>
    {isLoading ? <PageLoader /> : error || !o ? <ErrorState error={error} onRetry={() => refetch()} /> : <div className="space-y-5">
      <KVGrid cols={3}><KV label="Status"><StatusPill status={o.status} /></KV><KV label="Order value">PKR {money(o.total)}</KV><KV label="Expected">{fmtDate(o.expected_on)}</KV>{o.pr_no && <KV label="Requisition">{o.pr_no}</KV>}</KVGrid>
      <div className="overflow-x-auto rounded-lg border border-line"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Item</th><th className="th text-right">Ordered</th><th className="th text-right">Received</th><th className="th text-right">Rate</th></tr></thead>
        <tbody className="divide-y divide-line">{data.lines.map((l: any) => <tr key={l.id}><td className="td"><p className="font-medium">{l.code}</p><p className="text-xs text-slate-500">{l.name}</p></td><td className="td text-right tabular-nums">{Number(l.qty)}</td><td className="td text-right tabular-nums">{Number(l.received_qty)}</td><td className="td text-right tabular-nums">{money(l.rate)}</td></tr>)}</tbody></table></div>
      {data.receipts.length > 0 && <div><p className="mb-1 text-sm font-semibold">Goods receipts</p>{data.receipts.map((r: any) => <p key={r.id} className="text-sm">{r.doc_no} · {fmtDate(r.doc_date)} · PKR {money(r.total_value)}</p>)}</div>}
    </div>}
    {recv && data && <ReceiveModal order={o} lines={data.lines} onClose={() => { setRecv(false); refetch(); }} />}
  </Drawer>;
}

export default function Procurement() {
  const { can } = useAuth(); const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') ?? 'requests'; const [adding, setAdding] = useState(false); const [open, setOpen] = useState<number | null>(null); const [openPo, setOpenPo] = useState<number | null>(null);
  const { state, set, clear, page } = useQueryState();
  const reqs = useList('/procurement/requests', { page, pageSize: 15, q: state.q, status: state.status }, { enabled: tab === 'requests' });
  const orders = useList('/procurement/orders', { page, pageSize: 15, q: state.q, status: state.status }, { enabled: tab === 'orders' });
  const rcols: Column<any>[] = [
    { key: 'no', header: 'Requisition', render: (r) => <span className="font-semibold text-brand-700">{r.pr_no}</span> }, { key: 'date', header: 'Date', render: (r) => fmtDate(r.pr_date) }, { key: 'by', header: 'Requested by', hideBelow: 'md', render: (r) => r.requested_by_name ?? '—' },
    { key: 'veh', header: 'Bowzer', hideBelow: 'lg', render: (r) => r.vehicle_code ?? 'Stock' }, { key: 'lines', header: 'Items', render: (r) => r.lines }, { key: 'quotes', header: 'Quotes', render: (r) => r.quotes }, { key: 'val', header: 'Est. value', render: (r) => <span className="tabular-nums">{money(r.est_value)}</span> }, { key: 'st', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
  ];
  const ocols: Column<any>[] = [
    { key: 'no', header: 'Order', render: (o) => <span className="font-semibold text-brand-700">{o.po_no}</span> }, { key: 'date', header: 'Date', render: (o) => fmtDate(o.po_date) }, { key: 'v', header: 'Vendor', render: (o) => o.vendor_name }, { key: 'exp', header: 'Expected', hideBelow: 'md', render: (o) => fmtDate(o.expected_on) },
    { key: 'rec', header: 'Received', render: (o) => `${Number(o.received ?? 0)} / ${Number(o.qty ?? 0)}` }, { key: 'val', header: 'Value', render: (o) => <span className="tabular-nums">{money(o.total)}</span> }, { key: 'st', header: 'Status', render: (o) => <StatusPill status={o.status} /> },
  ];
  const cur = tab === 'requests' ? reqs : orders;
  return <>
    <PageHeader title="Procurement" subtitle="Requisition → approval → quotations → purchase order → goods receipt" breadcrumbs={[{ label: 'Inventory' }, { label: 'Procurement' }]} actions={can('procurement:manage') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New requisition</Button>} />
    <Tabs value={tab} onChange={(k) => setSp({ tab: k })} tabs={[{ key: 'requests', label: 'Requisitions' }, { key: 'orders', label: 'Purchase orders' }]} />
    <div className="mt-4"><FilterBar active={!!state.q || !!state.status} onClear={() => clear()}><SearchInput className="w-full sm:w-64" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search number or vendor…" />
      <FilterSelect label="Status" value={state.status ?? 'ALL'} onChange={(v) => set({ status: v })} options={[{ value: 'ALL', label: 'All' }, ...(tab === 'requests' ? ['SUBMITTED', 'APPROVED', 'ORDERED', 'REJECTED', 'CANCELLED'] : ['OPEN', 'PARTIAL', 'RECEIVED', 'CANCELLED']).map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))]} /></FilterBar>
      {tab === 'requests' ? <DataTable columns={rcols} rows={cur.data?.data} loading={cur.isLoading} error={cur.error} onRetry={() => cur.refetch()} rowKey={(r) => r.id} onRowClick={(r) => setOpen(r.id)} page={page} pageSize={15} total={cur.data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No requisitions' }} />
        : <DataTable columns={ocols} rows={cur.data?.data} loading={cur.isLoading} error={cur.error} onRetry={() => cur.refetch()} rowKey={(o) => o.id} onRowClick={(o) => setOpenPo(o.id)} page={page} pageSize={15} total={cur.data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No purchase orders' }} />}</div>
    {adding && <RequestModal onClose={() => setAdding(false)} />}{open != null && <RequestDrawer id={open} onClose={() => setOpen(null)} />}{openPo != null && <OrderDrawer id={openPo} onClose={() => setOpenPo(null)} />}
  </>;
}

import { Banknote, FilePlus2, Plus, Printer, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import { fieldErrors, useAction, useList, useQueryState } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert, ErrorState, PageLoader } from '../ui/Feedback';
import { FilterSelect, SelectInput, TextArea, TextInput } from '../ui/Form';
import { Drawer, Modal } from '../ui/Overlay';
import { KV, KVGrid, KpiCard, PageHeader, Tabs } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';
import { DistributorPicker, useVehicleOptions } from '../features/common';
import { ReceiptModal, money, today } from '../features/finance';
import { VoucherDrawer } from './Vouchers';

interface L { description: string; qty: string; unit: string; rate: string; vehicleId: string }
const blank = (): L => ({ description: '', qty: '', unit: 'MT', rate: '', vehicleId: '' });

export function InvoiceModal({ customer, onClose, onSaved }: { customer?: any; onClose: () => void; onSaved?: (i: any) => void }) {
  const veh: any[] = useVehicleOptions().data?.data ?? [];
  const [cust, setCust] = useState<any>(customer ?? null);
  const [f, setF] = useState({ kind: 'INVOICE', date: today(), taxPct: '', notes: '', refInvoiceId: '' });
  const [lines, setLines] = useState<L[]>([blank()]);
  const open = useQuery({ queryKey: ['/sales/invoices', 'open', cust?.id], queryFn: () => get(`/sales/invoices?customerId=${cust.id}&kind=INVOICE&pageSize=50`), enabled: !!cust && f.kind === 'RETURN' });
  const sub = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.rate || 0), 0);
  const m = useAction(() => post('/sales/invoices', { customerId: cust.id, kind: f.kind, date: f.date, taxPct: f.taxPct === '' ? undefined : Number(f.taxPct), notes: f.notes || undefined, refInvoiceId: f.refInvoiceId ? Number(f.refInvoiceId) : undefined,
    lines: lines.filter((l) => l.description).map((l) => ({ description: l.description, qty: Number(l.qty), unit: l.unit, rate: Number(l.rate), vehicleId: l.vehicleId ? Number(l.vehicleId) : undefined })) }),
    { invalidate: ['/sales', '/finance', '/distributors'], success: (r: any) => `${f.kind === 'RETURN' ? 'Credit note' : 'Invoice'} ${r.invoice.invoice_no} created.`, onSuccess: (r) => { onSaved?.(r.invoice); onClose(); } });
  const fe = fieldErrors(m.error);
  const setLine = (i: number, p: Partial<L>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  return (
    <Modal open onClose={onClose} size="xl" title={f.kind === 'RETURN' ? 'New sale return (credit note)' : 'New sale invoice'} description="Posts to receivables and freight income automatically"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!cust} loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Create (F10)</Button></>}>
      <div className="grid gap-4 sm:grid-cols-4">
        {m.error && !m.error.fields && <div className="sm:col-span-4"><Alert tone="danger">{m.error.message}</Alert></div>}
        <div className="sm:col-span-2"><p className="mb-1 text-xs font-medium text-slate-700">Customer <span className="text-red-500">*</span></p><DistributorPicker value={cust} onChange={setCust} /></div>
        <SelectInput label="Document" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={[{ value: 'INVOICE', label: 'Sale invoice' }, { value: 'RETURN', label: 'Sale return (credit note)' }]} />
        <TextInput label="Date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} error={fe.date} />
        {f.kind === 'RETURN' && <SelectInput label="Against invoice" wrapperClassName="sm:col-span-2" value={f.refInvoiceId} onChange={(e) => setF({ ...f, refInvoiceId: e.target.value })} placeholder="— none (keep as customer credit) —" options={(open.data?.data ?? []).map((i: any) => ({ value: i.id, label: `${i.invoice_no} · PKR ${money(i.outstanding)} due` }))} />}
        <TextInput label="Sales tax %" type="number" step="0.1" min="0" value={f.taxPct} onChange={(e) => setF({ ...f, taxPct: e.target.value })} hint="Blank = default from Settings" />
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg border border-line"><table className="w-full text-sm">
        <thead className="bg-slate-50"><tr><th className="th min-w-[14rem]">Description</th><th className="th">Qty</th><th className="th">Unit</th><th className="th">Rate</th><th className="th">Bowzer</th><th className="th text-right">Amount</th><th className="th" /></tr></thead>
        <tbody className="divide-y divide-line">{lines.map((l, i) => <tr key={i}>
          <td className="td"><input aria-label={`Description ${i + 1}`} className="input" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="e.g. LPG haulage Osakai → Peshawar" /></td>
          <td className="td"><input aria-label={`Qty ${i + 1}`} type="number" min="0" step="0.001" className="input w-24" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
          <td className="td"><input aria-label={`Unit ${i + 1}`} className="input w-16" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} /></td>
          <td className="td"><input aria-label={`Rate ${i + 1}`} type="number" min="0" step="0.01" className="input w-28" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} /></td>
          <td className="td"><select aria-label={`Bowzer ${i + 1}`} className="input" value={l.vehicleId} onChange={(e) => setLine(i, { vehicleId: e.target.value })}><option value="">—</option>{veh.map((v) => <option key={v.id} value={v.id}>{v.code}</option>)}</select></td>
          <td className="td text-right tabular-nums">{money(Number(l.qty || 0) * Number(l.rate || 0))}</td>
          <td className="td w-8">{lines.length > 1 && <button type="button" aria-label={`Remove line ${i + 1}`} className="rounded p-1 text-slate-400 hover:text-red-600" onClick={() => setLines(lines.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></button>}</td></tr>)}</tbody>
        <tfoot className="bg-slate-50 font-semibold"><tr><td className="td" colSpan={5}><button type="button" className="inline-flex items-center gap-1 text-brand-700 hover:underline" onClick={() => setLines([...lines, blank()])}><Plus className="h-4 w-4" />Add line</button></td><td className="td text-right tabular-nums">{money(sub)}</td><td /></tr></tfoot></table></div>
      <TextArea label="Notes" rows={2} wrapperClassName="mt-4" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
    </Modal>
  );
}

export function InvoiceDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { can } = useAuth(); const [receipt, setReceipt] = useState(false); const [voiding, setVoiding] = useState(false); const [reason, setReason] = useState(''); const [voucher, setVoucher] = useState<number | null>(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/sales/invoices', id], queryFn: () => get(`/sales/invoices/${id}`) });
  const v = useAction(() => post(`/sales/invoices/${id}/void`, { reason }), { invalidate: ['/sales', '/finance'], success: 'Invoice voided.', onSuccess: () => { setVoiding(false); refetch(); } });
  const inv = data?.invoice;
  return (
    <Drawer open onClose={onClose} width="max-w-3xl" title={inv ? inv.invoice_no : 'Invoice'} description={inv ? `${inv.kind === 'RETURN' ? 'Sale return' : 'Sale invoice'} · ${inv.customer_name}` : undefined}
      footer={inv && inv.status !== 'VOID' ? <><Button icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button>
        {inv.kind === 'INVOICE' && inv.outstanding > 0 && can('finance:post') && <Button variant="primary" icon={<Banknote className="h-4 w-4" />} onClick={() => setReceipt(true)}>Receive payment</Button>}
        {can('sales:manage') && inv.paid <= 0 && <Button variant="danger" onClick={() => setVoiding(true)}>Void</Button>}</> : undefined}>
      {isLoading ? <PageLoader /> : error || !inv ? <ErrorState error={error} onRetry={() => refetch()} /> : (
        <div className="print-area space-y-5">
          <div className="flex items-start justify-between"><div><p className="text-lg font-bold">GasMan Private Limited</p><p className="text-xs text-slate-500">LPG bowzer transport — demo document, synthetic data</p></div><div className="text-right"><p className="text-sm font-semibold">{inv.kind === 'RETURN' ? 'CREDIT NOTE' : 'SALES INVOICE'}</p><p className="text-sm">{inv.invoice_no}</p><StatusPill status={inv.status} /></div></div>
          <KVGrid cols={3}><KV label="Bill to">{inv.customer_name}<br /><span className="text-xs text-slate-500">{inv.customer_city}{inv.customer_ntn ? ` · NTN ${inv.customer_ntn}` : ''}</span></KV><KV label="Date">{fmtDate(inv.invoice_date)}</KV><KV label="Due">{fmtDate(inv.due_date)}</KV>
            {inv.trip_code && <KV label="Trip"><Link to={`/trips/${inv.trip_id}`} className="text-brand-700 hover:underline">{inv.trip_code}</Link></KV>}{inv.voucher_no && <KV label="Voucher"><button className="text-brand-700 hover:underline" onClick={() => setVoucher(inv.voucher_id)}>{inv.voucher_no}</button></KV>}</KVGrid>
          <div className="overflow-x-auto rounded-lg border border-line"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Description</th><th className="th">Bowzer</th><th className="th text-right">Qty</th><th className="th text-right">Rate</th><th className="th text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-line">{data.lines.map((l: any) => <tr key={l.id}><td className="td">{l.description}</td><td className="td">{l.vehicle_code ?? ''}</td><td className="td text-right tabular-nums">{Number(l.qty)} {l.unit}</td><td className="td text-right tabular-nums">{money(l.rate)}</td><td className="td text-right tabular-nums">{money(l.amount)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={4} className="td text-right">Subtotal</td><td className="td text-right tabular-nums">{money(inv.subtotal)}</td></tr>{Number(inv.tax_amount) > 0 && <tr><td colSpan={4} className="td text-right">Sales tax {Number(inv.tax_pct)}%</td><td className="td text-right tabular-nums">{money(inv.tax_amount)}</td></tr>}
              <tr className="font-bold"><td colSpan={4} className="td text-right">Total (PKR)</td><td className="td text-right tabular-nums">{money(inv.total)}</td></tr>{inv.kind === 'INVOICE' && <><tr><td colSpan={4} className="td text-right">Received</td><td className="td text-right tabular-nums">{money(inv.paid)}</td></tr><tr className="font-semibold"><td colSpan={4} className="td text-right">Outstanding</td><td className="td text-right tabular-nums">{money(inv.outstanding)}</td></tr></>}</tfoot></table></div>
          {data.receipts.length > 0 && <div className="print:hidden"><p className="mb-1 text-sm font-semibold">Settlements</p>{data.receipts.map((r: any) => <button key={r.voucher_id + r.voucher_no} onClick={() => setVoucher(r.voucher_id)} className="block text-sm text-brand-700 hover:underline">{r.voucher_no} · {fmtDate(r.voucher_date)} · PKR {money(r.amount)}</button>)}</div>}
          {inv.notes && <p className="text-sm text-slate-600">{inv.notes}</p>}
          {voiding && <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 print:hidden"><TextArea label="Reason for voiding" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={(v.error as any)?.fields?.reason} />{v.error && !(v.error as any).fields && <p className="text-sm text-red-700">{v.error.message}</p>}<div className="flex gap-2"><Button onClick={() => setVoiding(false)}>Keep</Button><Button variant="danger" loading={v.isPending} onClick={() => v.mutate(undefined as never)}>Void now</Button></div></div>}
        </div>
      )}
      {receipt && inv && <ReceiptModal invoice={inv} onClose={() => setReceipt(false)} onSaved={() => refetch()} />}
      {voucher != null && <VoucherDrawer id={voucher} onClose={() => setVoucher(null)} />}
    </Drawer>
  );
}

function BillingQueue() {
  const { can } = useAuth(); const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/sales/billing-queue'], queryFn: () => get('/sales/billing-queue') });
  const bill = useAction((tripId: number) => post(`/sales/billing-queue/${tripId}/invoice`, {}), { invalidate: ['/sales', '/finance', '/trips'], success: (r: any) => `Invoice ${r.invoice.invoice_no} created.` });
  const cols: Column<any>[] = [
    { key: 'trip', header: 'Trip', render: (t) => <Link to={`/trips/${t.id}`} className="font-semibold text-brand-700 hover:underline">{t.code}</Link> },
    { key: 'type', header: 'Type', render: (t) => (t.trip_type === 'UPLIFTING' ? 'Uplifting' : 'Delivery') },
    { key: 'veh', header: 'Bowzer', render: (t) => t.vehicle_code },
    { key: 'cust', header: 'Bill to', render: (t) => t.bill_to_name ?? <span className="text-amber-700">Choose customer</span> },
    { key: 'mt', header: 'Qty', render: (t) => `${t.mt} MT × ${money(t.freight_per_mt)}` },
    { key: 'amt', header: 'Amount', render: (t) => <span className="tabular-nums">{money(t.amount)}</span> },
    { key: 'act', header: '', render: (t) => can('sales:manage') && t.bill_to_id && <Button size="sm" variant="primary" loading={bill.isPending && bill.variables === t.id} onClick={() => bill.mutate(t.id)}>Create invoice</Button> },
  ];
  return <><Alert tone="info" className="mb-3">Completed trips are invoiced automatically. Anything listed here has no bill-to customer yet or was voided.</Alert><DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(t) => t.id} empty={{ title: 'Nothing waiting to be billed', description: 'All completed trips have invoices.' }} /></>;
}

function Orders() {
  const { can } = useAuth(); const { state, set, page } = useQueryState();
  const { data, isLoading, error, refetch } = useList('/sales/orders', { page, pageSize: 15, q: state.q, status: state.status });
  const [adding, setAdding] = useState(false);
  const inv = useAction((id: number) => post(`/sales/orders/${id}/invoice`, {}), { invalidate: ['/sales', '/finance'], success: (r: any) => `Invoice ${r.invoice.invoice_no} created.` });
  const cancel = useAction((id: number) => post(`/sales/orders/${id}/cancel`, {}), { invalidate: ['/sales'], success: 'Order cancelled.' });
  const cols: Column<any>[] = [
    { key: 'no', header: 'Order', render: (o) => <span className="font-semibold text-brand-700">{o.order_no}</span> }, { key: 'date', header: 'Date', render: (o) => fmtDate(o.order_date) }, { key: 'cust', header: 'Customer', render: (o) => o.customer_name },
    { key: 'del', header: 'Delivery by', hideBelow: 'md', render: (o) => fmtDate(o.delivery_date) }, { key: 'qty', header: 'Qty', render: (o) => `${Number(o.qty ?? 0)} MT` }, { key: 'tot', header: 'Value', render: (o) => <span className="tabular-nums">{money(o.total)}</span> },
    { key: 'st', header: 'Status', render: (o) => <StatusPill status={o.status} /> },
    { key: 'act', header: '', render: (o) => o.status === 'OPEN' && can('sales:manage') && <div className="flex gap-2"><Button size="sm" loading={inv.isPending && inv.variables === o.id} onClick={() => inv.mutate(o.id)}>Invoice</Button><Button size="sm" onClick={() => cancel.mutate(o.id)}>Cancel</Button></div> },
  ];
  return <>
    <FilterBar active={!!state.q || !!state.status} onClear={() => set({ q: undefined, status: undefined })}><SearchInput className="w-full sm:w-64" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search order or customer…" />
      <FilterSelect label="Status" value={state.status ?? 'ALL'} onChange={(v) => set({ status: v })} options={[{ value: 'ALL', label: 'All' }, { value: 'OPEN', label: 'Open (pending)' }, { value: 'INVOICED', label: 'Invoiced' }, { value: 'CANCELLED', label: 'Cancelled' }]} />
      {can('sales:manage') && <Button className="ml-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New order</Button>}</FilterBar>
    <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(o) => o.id} page={page} pageSize={15} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No sales orders' }} />
    {adding && <OrderModal onClose={() => setAdding(false)} />}
  </>;
}

function OrderModal({ onClose }: { onClose: () => void }) {
  const [cust, setCust] = useState<any>(null); const [f, setF] = useState({ date: today(), deliveryDate: '', notes: '' }); const [lines, setLines] = useState<L[]>([{ ...blank(), description: 'LPG haulage — bowzer load' }]);
  const m = useAction(() => post('/sales/orders', { customerId: cust.id, date: f.date, deliveryDate: f.deliveryDate || undefined, notes: f.notes || undefined, lines: lines.filter((l) => l.description).map((l) => ({ description: l.description, qty: Number(l.qty), unit: l.unit, rate: Number(l.rate) })) }),
    { invalidate: ['/sales'], success: (r: any) => `Order ${r.order.order_no} created.`, onSuccess: onClose });
  const setLine = (i: number, p: Partial<L>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  return <Modal open onClose={onClose} size="lg" title="New sales order" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!cust} loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Save order (F10)</Button></>}>
    <div className="grid gap-4 sm:grid-cols-2">{m.error && !m.error.fields && <div className="sm:col-span-2"><Alert tone="danger">{m.error.message}</Alert></div>}
      <div className="sm:col-span-2"><p className="mb-1 text-xs font-medium text-slate-700">Customer *</p><DistributorPicker value={cust} onChange={setCust} /></div>
      <TextInput label="Order date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /><TextInput label="Needed by" type="date" value={f.deliveryDate} onChange={(e) => setF({ ...f, deliveryDate: e.target.value })} />
      {lines.map((l, i) => <div key={i} className="grid grid-cols-[1fr_90px_110px] gap-2 sm:col-span-2"><input aria-label={`Description ${i + 1}`} className="input" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /><input aria-label={`Qty ${i + 1}`} type="number" className="input" placeholder="Qty MT" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /><input aria-label={`Rate ${i + 1}`} type="number" className="input" placeholder="Rate" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} /></div>)}
      <TextArea label="Notes" rows={2} wrapperClassName="sm:col-span-2" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div></Modal>;
}

export default function Invoices() {
  const { can } = useAuth(); const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') ?? 'invoices';
  const [adding, setAdding] = useState(false); const [receipt, setReceipt] = useState(false); const [open, setOpen] = useState<number | null>(null);
  const { state, set, clear, page } = useQueryState();
  const { data, isLoading, error, refetch } = useList('/sales/invoices', { page, pageSize: 15, q: state.q, status: state.status, kind: state.kind, overdue: state.overdue, from: state.from, to: state.to }, { enabled: tab === 'invoices' });
  const s = data?.summary;
  const cols: Column<any>[] = [
    { key: 'no', header: 'Invoice', sortKey: 'no', render: (i) => <span className="font-semibold text-brand-700">{i.invoice_no}</span> },
    { key: 'date', header: 'Date', render: (i) => <span className="whitespace-nowrap tabular-nums">{fmtDate(i.invoice_date)}</span> },
    { key: 'cust', header: 'Customer', render: (i) => <div><p>{i.customer_name}</p>{i.trip_code && <p className="text-xs text-slate-500">{i.trip_code}</p>}</div> },
    { key: 'due', header: 'Due', hideBelow: 'md', render: (i) => <span className={i.overdue ? 'font-medium text-red-600' : ''}>{fmtDate(i.due_date)}</span> },
    { key: 'tot', header: 'Total', render: (i) => <span className="tabular-nums">{i.kind === 'RETURN' ? '−' : ''}{money(i.total)}</span> },
    { key: 'out', header: 'Outstanding', hideBelow: 'md', render: (i) => <span className="tabular-nums">{i.kind === 'INVOICE' && i.status !== 'VOID' ? money(i.outstanding) : ''}</span> },
    { key: 'st', header: 'Status', render: (i) => <div className="flex items-center gap-1.5">{i.kind === 'RETURN' && <span className="text-xs text-slate-500">Credit note</span>}<StatusPill status={i.overdue ? 'OVERDUE' : i.status} /></div> },
  ];
  return (
    <>
      <PageHeader title="Sales & Invoicing" subtitle="Freight invoices, credit notes, customer receipts and sales orders — vouchers only, no point-of-sale" breadcrumbs={[{ label: 'Sales' }, { label: 'Invoices' }]}
        actions={<>{can('finance:post') && <Button icon={<Banknote className="h-4 w-4" />} onClick={() => setReceipt(true)}>Receive payment</Button>}{can('sales:manage') && <Button variant="primary" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setAdding(true)}>New invoice</Button>}</>} />
      <Tabs value={tab} onChange={(k) => setSp({ tab: k })} tabs={[{ key: 'invoices', label: 'Invoices' }, { key: 'queue', label: 'Billing queue' }, { key: 'orders', label: 'Sales orders' }]} />
      <div className="mt-4">
        {tab === 'invoices' && <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3"><KpiCard label="Billed (filtered)" value={s ? `PKR ${money(s.billed)}` : '–'} /><KpiCard label="Outstanding" value={s ? `PKR ${money(s.outstanding)}` : '–'} tone="amber" to="/sales/invoices?status=UNPAID,PARTIAL" /><KpiCard label="Overdue" value={s ? `PKR ${money(s.overdue)}` : '–'} tone="red" to="/sales/invoices?overdue=1" /></div>
          <FilterBar active={['q', 'status', 'kind', 'overdue', 'from', 'to'].some((k) => state[k])} onClear={() => clear()}>
            <SearchInput className="w-full sm:w-64" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search invoice, customer, trip…" />
            <FilterSelect label="Status" value={state.status ?? 'ALL'} onChange={(v) => set({ status: v })} options={[{ value: 'ALL', label: 'All' }, { value: 'UNPAID', label: 'Unpaid' }, { value: 'PARTIAL', label: 'Partly paid' }, { value: 'PAID', label: 'Paid' }, { value: 'VOID', label: 'Void' }]} />
            <FilterSelect label="Type" value={state.kind ?? 'ALL'} onChange={(v) => set({ kind: v })} options={[{ value: 'ALL', label: 'Invoices & returns' }, { value: 'INVOICE', label: 'Invoices' }, { value: 'RETURN', label: 'Sale returns' }]} />
            <div className="flex items-center gap-1.5 text-sm text-slate-500"><input type="date" aria-label="From" className="input w-auto py-2" value={state.from ?? ''} onChange={(e) => set({ from: e.target.value })} />to<input type="date" aria-label="To" className="input w-auto py-2" value={state.to ?? ''} onChange={(e) => set({ to: e.target.value })} /></div>
          </FilterBar>
          <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(i) => i.id} onRowClick={(i) => setOpen(i.id)} page={page} pageSize={15} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No invoices match' }} /></>}
        {tab === 'queue' && <BillingQueue />}
        {tab === 'orders' && <Orders />}
      </div>
      {adding && <InvoiceModal onClose={() => setAdding(false)} onSaved={(i) => setOpen(i.id)} />}
      {receipt && <ReceiptModal onClose={() => setReceipt(false)} />}
      {open != null && <InvoiceDrawer id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

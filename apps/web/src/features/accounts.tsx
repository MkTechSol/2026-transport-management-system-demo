import { useQuery } from '@tanstack/react-query';
import { Banknote, FilePlus2 } from 'lucide-react';
import { useState } from 'react';
import { get, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import { Button } from '../ui/Button';
import { ErrorState, PageLoader, ProgressBar } from '../ui/Feedback';
import { KpiCard, Section } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { ReceiptModal, ReportTable, money } from './finance';
import { InvoiceDrawer, InvoiceModal } from '../pages/Invoices';
import { VoucherDrawer } from '../pages/Vouchers';
import { StockVoucherModal } from './stock';

/** A bowzer is its own account: P&L and ledger from the vehicle dimension of the general ledger. */
export function BowzerAccount({ vehicleId, code }: { vehicleId: number; code: string }) {
  const [voucher, setVoucher] = useState<number | null>(null);
  const pl = useQuery({ queryKey: ['/finance/reports', 'profit-loss', vehicleId], queryFn: () => get(`/finance/reports/profit-loss${qs({ vehicleId })}`) });
  const ex = useQuery({ queryKey: ['/finance/reports', 'expense-report', vehicleId], queryFn: () => get(`/finance/reports/expense-report${qs({ vehicleId })}`) });
  const led = useQuery({ queryKey: ['/finance/reports', 'ledger', vehicleId], queryFn: () => get(`/finance/reports/ledger${qs({ vehicleId })}`) });
  if (pl.isLoading || led.isLoading) return <PageLoader />;
  if (pl.error || led.error || !pl.data || !led.data) return <ErrorState error={pl.error ?? led.error} onRetry={() => { pl.refetch(); led.refetch(); }} />;
  const row = (n: string) => pl.data.rows.find((r: any) => r.name === n);
  const income = row('Total income')?.amount ?? 0; const exp = row('Total expenses')?.amount ?? 0; const net = income - exp;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Freight income" value={`PKR ${money(income)}`} tone="blue" /><KpiCard label="Expenses" value={`PKR ${money(exp)}`} tone="amber" />
        <KpiCard label={net >= 0 ? 'Profit' : 'Loss'} value={`PKR ${money(Math.abs(net))}`} tone={net >= 0 ? 'green' : 'red'} /><KpiCard label="Margin" value={income > 0 ? `${Math.round((net / income) * 1000) / 10}%` : '—'} tone="slate" hint="Current fiscal year" />
      </div>
      <Section title="Where the money went" padded={false}><ReportTable report={ex.data ?? { title: '', columns: [], rows: [] }} fileName={`${code}-expenses`} /></Section>
      <Section title={`Ledger — ${code}`} padded={false}><ReportTable report={led.data} fileName={`${code}-ledger`} onRowClick={(r) => setVoucher(r.voucher_id)} /></Section>
      {voucher != null && <VoucherDrawer id={voucher} onClose={() => setVoucher(null)} />}
    </div>
  );
}

/** Receivable account for a distributor / marketer: balance, credit limit meter, invoices, ledger. */
export function CustomerAccount({ customer }: { customer: any }) {
  const { can } = useAuth(); const [inv, setInv] = useState(false); const [rcv, setRcv] = useState(false); const [open, setOpen] = useState<number | null>(null); const [voucher, setVoucher] = useState<number | null>(null);
  const acc = useQuery({ queryKey: ['/sales/customers', customer.id, 'account'], queryFn: () => get(`/sales/customers/${customer.id}/account`) });
  const invoices = useQuery({ queryKey: ['/sales/invoices', 'customer', customer.id], queryFn: () => get(`/sales/invoices?customerId=${customer.id}&pageSize=10`) });
  const led = useQuery({ queryKey: ['/finance/reports', 'ledger', 'customer', customer.id], queryFn: () => get(`/finance/reports/ledger${qs({ partyId: customer.id, partyType: 'CUSTOMER' })}`), enabled: can('finance:view') });
  if (acc.isLoading) return <PageLoader />;
  if (acc.error || !acc.data) return <ErrorState error={acc.error} onRetry={() => acc.refetch()} />;
  const a = acc.data; const limit = Number(a.customer.credit_limit_pkr);
  const cols = (invoices.data?.data ?? []) as any[];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Account &amp; receivables</h2>
        <div className="flex gap-2">{can('finance:post') && <Button icon={<Banknote className="h-4 w-4" />} onClick={() => setRcv(true)}>Receive payment</Button>}{can('sales:manage') && <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setInv(true)}>New invoice</Button>}</div></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Balance due" value={`PKR ${money(a.balance)}`} tone={a.overLimit ? 'red' : 'blue'} hint={a.balance < 0 ? 'Customer is in credit' : undefined} /><KpiCard label="Overdue" value={`PKR ${money(a.overdue)}`} tone={a.overdue > 0 ? 'amber' : 'green'} /><KpiCard label="Open invoices" value={a.openInvoices} tone="slate" />
        <div className="card px-4 py-3"><p className="text-xs font-medium text-slate-500">Credit limit</p><p className="mt-1 text-lg font-semibold">{limit > 0 ? `PKR ${money(limit)}` : 'No limit'}</p>
          {limit > 0 && <><ProgressBar className="mt-2" value={Math.min(100, a.creditUsedPct)} tone={a.overLimit ? 'red' : a.creditUsedPct >= a.customer.credit_alert_pct ? 'amber' : 'green'} /><p className="mt-1 text-xs text-slate-500">{a.creditUsedPct}% used · alert at {a.customer.credit_alert_pct}%</p></>}</div>
      </div>
      <Section title="Recent invoices" padded={false}>
        <table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Invoice</th><th className="th">Date</th><th className="th">Due</th><th className="th text-right">Total</th><th className="th text-right">Outstanding</th><th className="th">Status</th></tr></thead>
          <tbody className="divide-y divide-line">{cols.map((i) => <tr key={i.id} className="cursor-pointer hover:bg-brand-50/50" onClick={() => setOpen(i.id)}><td className="td font-medium text-brand-700">{i.invoice_no}</td><td className="td">{fmtDate(i.invoice_date)}</td><td className="td">{fmtDate(i.due_date)}</td><td className="td text-right tabular-nums">{money(i.total)}</td><td className="td text-right tabular-nums">{i.kind === 'INVOICE' && i.status !== 'VOID' ? money(i.outstanding) : ''}</td><td className="td"><StatusPill status={i.overdue ? 'OVERDUE' : i.status} /></td></tr>)}
            {!cols.length && <tr><td colSpan={6} className="td py-8 text-center text-slate-500">No invoices yet.</td></tr>}</tbody></table>
      </Section>
      {led.data && <Section title="Customer ledger" padded={false}><ReportTable report={led.data} fileName={`${customer.code}-ledger`} onRowClick={(r) => setVoucher(r.voucher_id)} /></Section>}
      {inv && <InvoiceModal customer={{ id: customer.id, name: customer.name, city: customer.city, region: customer.region }} onClose={() => setInv(false)} onSaved={(i) => { setOpen(i.id); acc.refetch(); }} />}
      {rcv && <ReceiptModal customer={customer} onClose={() => setRcv(false)} onSaved={() => { acc.refetch(); invoices.refetch(); led.refetch(); }} />}
      {open != null && <InvoiceDrawer id={open} onClose={() => { setOpen(null); acc.refetch(); invoices.refetch(); }} />}
      {voucher != null && <VoucherDrawer id={voucher} onClose={() => setVoucher(null)} />}
    </div>
  );
}

/** Everything fitted to, replaced on or consumed by one bowzer — items, tyres, parts history and fuel. */
export function BowzerInventory({ vehicleId, code }: { vehicleId: number; code: string }) {
  const { can } = useAuth(); const [modal, setModal] = useState<'PARTS_REPLACEMENT' | 'NAVIGATION' | null>(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/inventory/vehicles', vehicleId], queryFn: () => get(`/inventory/vehicles/${vehicleId}`) });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const byCat = new Map<string, any[]>(); for (const f of data.fitted) { const l = byCat.get(f.category) ?? []; l.push(f); byCat.set(f.category, l); }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Fitted items, tyres &amp; spare-part history</h2>
        {can('inventory:manage') && <div className="flex gap-2"><Button onClick={() => setModal('PARTS_REPLACEMENT')}>Replace a part</Button><Button onClick={() => setModal('NAVIGATION')}>Move an item</Button></div>}</div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Fitted units" value={data.fitted.reduce((s: number, f: any) => s + f.qty, 0)} tone="blue" /><KpiCard label="Tyres on wheels" value={`${data.tyres.length}${data.vehicle.wheels ? ` / ${data.vehicle.wheels}` : ''}`} tone={data.vehicle.wheels && data.tyres.length < data.vehicle.wheels ? 'amber' : 'green'} />
        <KpiCard label="Fuel fills" value={data.fuel.fills} hint={`${Math.round(data.fuel.litres).toLocaleString('en-US')} L · PKR ${Math.round(data.fuel.amount).toLocaleString('en-US')}`} tone="slate" /><KpiCard label="Average km/L" value={data.fuel.avg_kmpl ? data.fuel.avg_kmpl.toFixed(2) : '—'} tone="slate" />
      </div>
      <Section title="Fitted to this bowzer" padded={false}>
        <table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Category</th><th className="th">Item</th><th className="th text-right">Qty</th><th className="th text-right">Value</th><th className="th">Since</th></tr></thead>
          <tbody className="divide-y divide-line">{[...byCat.entries()].flatMap(([cat, rows]) => rows.map((r, i) => <tr key={r.id}><td className="td text-slate-500">{i === 0 ? cat : ''}</td><td className="td font-medium">{r.name}</td><td className="td text-right tabular-nums">{r.qty} {r.unit}</td><td className="td text-right tabular-nums">{money(r.value)}</td><td className="td">{fmtDate(r.since)}</td></tr>))}
            {!data.fitted.length && <tr><td colSpan={5} className="td py-8 text-center text-slate-500">Nothing recorded as fitted.</td></tr>}</tbody></table>
      </Section>
      <Section title="Tyres" padded={false}><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Position</th><th className="th">Serial</th><th className="th">Tyre</th><th className="th text-right">Distance run</th><th className="th">Fitted</th></tr></thead>
        <tbody className="divide-y divide-line">{data.tyres.map((t: any) => <tr key={t.id}><td className="td font-medium">{t.position}</td><td className="td">{t.serial_no}</td><td className="td">{t.item_name}</td><td className="td text-right tabular-nums">{Number(t.km_total).toLocaleString('en-US')} km</td><td className="td">{fmtDate(t.fitted_on)}</td></tr>)}{!data.tyres.length && <tr><td colSpan={5} className="td py-6 text-center text-slate-500">No serial-tracked tyres.</td></tr>}</tbody></table></Section>
      <Section title="Replacements, issues & moves" padded={false}><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Date</th><th className="th">Voucher</th><th className="th">Item</th><th className="th text-right">Qty</th><th className="th">Removed</th><th className="th text-right">Cost</th></tr></thead>
        <tbody className="divide-y divide-line">{data.replaced.map((r: any, i: number) => <tr key={i}><td className="td whitespace-nowrap">{fmtDate(r.doc_date)}</td><td className="td">{r.doc_no}</td><td className="td">{r.item_name}</td><td className="td text-right tabular-nums">{r.qty}</td><td className="td text-xs">{r.removed_name ? `${r.removed_name} (${(r.remove_disposition ?? '').toLowerCase()})` : ''}{r.reason ? ` · ${r.reason}` : ''}</td><td className="td text-right tabular-nums">{money(r.value)}</td></tr>)}{!data.replaced.length && <tr><td colSpan={6} className="td py-6 text-center text-slate-500">No history yet.</td></tr>}</tbody></table></Section>
      {modal && <StockVoucherModal type={modal} preset={modal === 'PARTS_REPLACEMENT' ? { vehicleId: String(vehicleId) } : undefined} onClose={() => { setModal(null); refetch(); }} />}
      <p className="text-xs text-slate-500">{code}: values use the item's moving-average cost.</p>
    </div>
  );
}

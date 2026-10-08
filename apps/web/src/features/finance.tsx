import { Download, Plus, Printer, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { get, post } from '../lib/api';
import { fmtDate, fmtPkr } from '../lib/format';
import { fieldErrors, useAction } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Feedback';
import { SelectInput, TextArea, TextInput } from '../ui/Form';
import { Modal } from '../ui/Overlay';
import { useVehicleOptions, DistributorPicker } from './common';

export const VOUCHER_LABELS: Record<string, string> = {
  CASH_PAYMENT: 'Cash payment', CASH_RECEIPT: 'Cash receipt', BANK_PAYMENT: 'Bank payment', BANK_RECEIVE: 'Bank receive', JOURNAL: 'Journal voucher', BOWZER_EXPENSE: 'Bowzer expense',
  SALE_INVOICE: 'Sale invoice', SALE_RETURN: 'Sale return', PURCHASE: 'Purchase', PURCHASE_RETURN: 'Purchase return', PAYROLL: 'Payroll', TRIP_EXPENSE: 'Trip expense', TRIP_FREIGHT: 'Trip freight', STOCK: 'Stock voucher', OPENING: 'Opening balance',
};
export const NEW_VOUCHER_TYPES = ['CASH_PAYMENT', 'CASH_RECEIPT', 'BANK_PAYMENT', 'BANK_RECEIVE', 'BOWZER_EXPENSE', 'JOURNAL'] as const;

export const today = () => new Date().toISOString().slice(0, 10);
export const money = (v: any) => { if (v == null || v === '') return ''; const n = Number(v); const f = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return n < 0 ? `(${f(Math.abs(n))})` : f(n); };

export const useAccounts = () => useQuery({ queryKey: ['/finance/accounts', 'all'], queryFn: () => get('/finance/accounts'), staleTime: 60_000 });
export const useBanks = () => useQuery({ queryKey: ['/finance/banks'], queryFn: () => get('/finance/banks'), staleTime: 30_000 });
export const useVendors = () => useQuery({ queryKey: ['/vendors', 'options'], queryFn: () => get('/vendors?pageSize=100&active=1'), staleTime: 60_000 });

/** Postable accounts grouped for a select; optionally limited to some account types. */
export function AccountSelect({ value, onChange, types, label, error, wrapperClassName }: { value: string; onChange: (v: string) => void; types?: string[]; label?: string; error?: string; wrapperClassName?: string }) {
  const { data } = useAccounts();
  const opts = useMemo(() => (data?.data ?? []).filter((a: any) => a.postable && a.active && (!types || types.includes(a.type))).map((a: any) => ({ value: a.id, label: `${a.code} · ${a.name}` })), [data, types]);
  return <SelectInput label={label ?? 'Account'} aria-label={label || 'Account'} value={value} onChange={(e) => onChange(e.target.value)} options={opts} placeholder="Select account" error={error} wrapperClassName={wrapperClassName} />;
}

export function BowzerSelect({ value, onChange, label = 'Bowzer', hint, error, required }: { value: string; onChange: (v: string) => void; label?: string; hint?: string; error?: string; required?: boolean }) {
  const { data } = useVehicleOptions();
  return <SelectInput label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder="— none —" hint={hint} error={error} required={required} options={(data?.data ?? []).map((v: any) => ({ value: v.id, label: `${v.code}${v.owner_name ? ` · ${v.owner_name}` : ''}` }))} />;
}

interface Line { accountId: string; amount: string; debit: string; credit: string; vehicleId: string; memo: string }
const blank = (): Line => ({ accountId: '', amount: '', debit: '', credit: '', vehicleId: '', memo: '' });

/** Single entry form for every manual voucher type (cash/bank payment & receipt, bowzer expense, journal). F10 saves. */
export function VoucherModal({ type, onClose, onSaved }: { type: (typeof NEW_VOUCHER_TYPES)[number]; onClose: () => void; onSaved?: (v: any) => void }) {
  const banks = useBanks(); const veh: any[] = useVehicleOptions().data?.data ?? [];
  const isJournal = type === 'JOURNAL'; const isBank = type.startsWith('BANK'); const isPay = type.endsWith('PAYMENT') || type === 'BOWZER_EXPENSE';
  const [f, setF] = useState({ date: today(), narration: '', bankId: '', vehicleId: '' });
  const [lines, setLines] = useState<Line[]>(isJournal ? [blank(), blank()] : [blank()]);
  const setLine = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0); const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0); const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  const m = useAction(() => post('/finance/vouchers', {
    type, date: f.date, narration: f.narration || undefined, bankId: isBank && f.bankId ? Number(f.bankId) : undefined, vehicleId: f.vehicleId ? Number(f.vehicleId) : undefined,
    lines: lines.filter((l) => l.accountId).map((l) => ({ accountId: Number(l.accountId), memo: l.memo || undefined, vehicleId: l.vehicleId ? Number(l.vehicleId) : undefined, ...(isJournal ? { debit: Number(l.debit || 0), credit: Number(l.credit || 0) } : { amount: Number(l.amount) }) })),
  }), { invalidate: ['/finance', '/sales'], success: (r: any) => `${VOUCHER_LABELS[type]} ${r.voucher.voucher_no} posted.`, onSuccess: (r) => { onSaved?.(r.voucher); onClose(); } });
  const fe = fieldErrors(m.error);
  const accTypes = type === 'CASH_RECEIPT' || type === 'BANK_RECEIVE' ? undefined : isPay && !isJournal ? ['EXPENSE', 'ASSET', 'LIABILITY'] : undefined;
  return (
    <Modal open onClose={onClose} size="xl" title={VOUCHER_LABELS[type]} description={isJournal ? 'Debits must equal credits' : isPay ? 'Money goes out; choose where it was spent' : 'Money comes in; choose where it came from'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Post voucher (F10)</Button></>}>
      <div className="grid gap-4 sm:grid-cols-4">
        {m.error && !m.error.fields && <div className="sm:col-span-4"><Alert tone="danger">{m.error.message}</Alert></div>}
        <TextInput label="Voucher date" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} error={fe.date} />
        {isBank && <SelectInput label="Bank account" required value={f.bankId} onChange={(e) => setF({ ...f, bankId: e.target.value })} placeholder="Select bank" error={fe.bankId} options={(banks.data?.data ?? []).map((b: any) => ({ value: b.id, label: `${b.name}` }))} />}
        {(type === 'BOWZER_EXPENSE') && <BowzerSelect required value={f.vehicleId} onChange={(v) => setF({ ...f, vehicleId: v })} error={fe.vehicleId} hint="Charged to this bowzer's account" />}
        {!isJournal && type !== 'BOWZER_EXPENSE' && <BowzerSelect value={f.vehicleId} onChange={(v) => setF({ ...f, vehicleId: v })} label="Bowzer (optional)" />}
        <TextArea label="Narration" rows={1} value={f.narration} onChange={(e) => setF({ ...f, narration: e.target.value })} wrapperClassName={isBank ? 'sm:col-span-1' : 'sm:col-span-2'} />
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr><th className="th">#</th><th className="th min-w-[16rem]">Account</th>{isJournal ? <><th className="th text-right">Debit</th><th className="th text-right">Credit</th></> : <th className="th text-right">Amount (PKR)</th>}<th className="th min-w-[9rem]">Bowzer</th><th className="th">Memo</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-line">
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="td w-8 text-slate-400">{i + 1}</td>
                <td className="td"><AccountSelect value={l.accountId} onChange={(v) => setLine(i, { accountId: v })} types={accTypes} label="" wrapperClassName="[&>label]:hidden" /></td>
                {isJournal ? <>
                  <td className="td"><input aria-label={`Debit ${i + 1}`} type="number" min="0" step="0.01" className="input w-28 text-right" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /></td>
                  <td className="td"><input aria-label={`Credit ${i + 1}`} type="number" min="0" step="0.01" className="input w-28 text-right" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} /></td></>
                  : <td className="td"><input aria-label={`Amount ${i + 1}`} type="number" min="0" step="0.01" className="input w-32 text-right" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} /></td>}
                <td className="td"><select aria-label={`Bowzer ${i + 1}`} className="input" value={l.vehicleId} onChange={(e) => setLine(i, { vehicleId: e.target.value })}><option value="">—</option>{veh.map((v: any) => <option key={v.id} value={v.id}>{v.code}</option>)}</select></td>
                <td className="td"><input aria-label={`Memo ${i + 1}`} className="input" value={l.memo} onChange={(e) => setLine(i, { memo: e.target.value })} /></td>
                <td className="td w-8">{lines.length > (isJournal ? 2 : 1) && <button type="button" aria-label={`Remove line ${i + 1}`} className="rounded p-1 text-slate-400 hover:text-red-600" onClick={() => setLines(lines.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 font-semibold"><tr><td className="td" colSpan={2}><button type="button" className="inline-flex items-center gap-1 text-brand-700 hover:underline" onClick={() => setLines([...lines, blank()])}><Plus className="h-4 w-4" />Add line</button></td>
            {isJournal ? <><td className={clsx('td text-right tabular-nums', dr !== cr && 'text-red-600')}>{money(dr)}</td><td className={clsx('td text-right tabular-nums', dr !== cr && 'text-red-600')}>{money(cr)}</td></> : <td className="td text-right tabular-nums">{money(total)}</td>}
            <td className="td" colSpan={3}>{isJournal && (dr === cr && dr > 0 ? <span className="text-green-700">Balanced</span> : <span className="text-red-600">Difference {money(Math.abs(dr - cr))}</span>)}</td></tr></tfoot>
        </table>
      </div>
      {fe._ && <p className="mt-2 text-sm text-red-600">{fe._}</p>}
    </Modal>
  );
}

/** Receive money from a customer and allocate it to open invoices (auto = oldest first). */
export function ReceiptModal({ customer, invoice, onClose, onSaved }: { customer?: any; invoice?: any; onClose: () => void; onSaved?: () => void }) {
  const banks = useBanks();
  const [cust, setCust] = useState<any>(customer ? { id: customer.id, name: customer.name, city: customer.city, region: customer.region } : invoice ? { id: invoice.customer_id, name: invoice.customer_name } : null);
  const [f, setF] = useState({ amount: invoice ? String(invoice.outstanding) : '', mode: 'BANK', bankId: '', date: today(), reference: '' });
  const m = useAction(() => post('/sales/receipts', { customerId: cust.id, amount: Number(f.amount), mode: f.mode, bankId: f.mode === 'BANK' && f.bankId ? Number(f.bankId) : undefined, date: f.date, reference: f.reference || undefined,
    ...(invoice ? { allocations: [{ invoiceId: invoice.id, amount: Math.min(Number(f.amount), Number(invoice.outstanding)) }] } : { autoAllocate: true }) }),
    { invalidate: ['/finance', '/sales', '/distributors'], success: (r: any) => `Receipt ${r.voucher.voucher_no} posted${r.unallocated ? ` (PKR ${r.unallocated.toLocaleString()} kept as customer credit)` : ''}.`, onSuccess: () => { onSaved?.(); onClose(); } });
  const fe = fieldErrors(m.error);
  return (
    <Modal open onClose={onClose} title="Receive payment" description="Settles the oldest unpaid invoices first" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!cust} loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Post receipt (F10)</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {m.error && !m.error.fields && <div className="sm:col-span-2"><Alert tone="danger">{m.error.message}</Alert></div>}
        <div className="sm:col-span-2"><p className="mb-1 text-xs font-medium text-slate-700">Customer <span className="text-red-500">*</span></p>{invoice ? <p className="text-sm font-semibold">{invoice.customer_name} · {invoice.invoice_no}</p> : <DistributorPicker value={cust} onChange={setCust} />}</div>
        <TextInput label="Amount (PKR)" required type="number" min="1" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} error={fe.amount} />
        <TextInput label="Date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} error={fe.date} />
        <SelectInput label="Received by" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} options={[{ value: 'BANK', label: 'Bank (cheque / transfer)' }, { value: 'CASH', label: 'Cash' }]} />
        {f.mode === 'BANK' && <SelectInput label="Bank account" required value={f.bankId} onChange={(e) => setF({ ...f, bankId: e.target.value })} placeholder="Select bank" error={fe.bankId} options={(banks.data?.data ?? []).map((b: any) => ({ value: b.id, label: b.name }))} />}
        <TextInput label="Cheque / reference no." value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} wrapperClassName="sm:col-span-2" />
      </div>
    </Modal>
  );
}

export interface ReportData { title: string; subtitle?: string; columns: { key: string; label: string; type?: string }[]; rows: any[]; totals?: Record<string, number | string> }
const cell = (c: { type?: string }, v: any) => (c.type === 'money' ? money(v) : c.type === 'date' ? fmtDate(v) : c.type === 'pct' ? (v == null ? '—' : `${v}%`) : c.type === 'num' ? (v == null ? '' : Number(v).toLocaleString('en-US')) : v ?? '');

export function downloadCsv(name: string, r: ReportData) {
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = [r.columns.map((c) => esc(c.label)).join(','), ...r.rows.map((x) => r.columns.map((c) => esc(x[c.key])).join(',')), r.totals ? r.columns.map((c, i) => esc(i === 0 ? 'Total' : r.totals![c.key] ?? '')).join(',') : ''].filter(Boolean).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

/** Generic tabular report with totals, CSV export and print. */
export function ReportTable({ report, onRowClick, fileName }: { report: ReportData; onRowClick?: (row: any) => void; fileName: string }) {
  return (
    <div className="print-area">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div><h2 className="text-lg font-semibold text-ink">{report.title}</h2>{report.subtitle && <p className="text-sm text-slate-500">{report.subtitle}</p>}<p className="hidden text-xs text-slate-500 print:block">GasMan Private Limited — demo data</p></div>
        <div className="flex gap-2 print:hidden"><Button size="sm" icon={<Download className="h-4 w-4" />} onClick={() => downloadCsv(fileName, report)}>CSV</Button><Button size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button></div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr>{report.columns.map((c) => <th key={c.key} className={clsx('th', ['money', 'num', 'pct'].includes(c.type ?? '') && 'text-right')}>{c.label}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {report.rows.map((r, i) => (
              <tr key={i} className={clsx(onRowClick && r.voucher_id && 'cursor-pointer hover:bg-brand-50/50', r.bold && 'bg-slate-50 font-semibold', r.opening && 'italic text-slate-500')} onClick={() => r.voucher_id && onRowClick?.(r)}>
                {report.columns.map((c) => <td key={c.key} className={clsx('td', ['money', 'num', 'pct'].includes(c.type ?? '') && 'text-right tabular-nums', c.type === 'money' && Number(r[c.key]) < 0 && 'text-red-600')}>{cell(c, r[c.key])}</td>)}
              </tr>
            ))}
            {!report.rows.length && <tr><td className="td py-10 text-center text-slate-500" colSpan={report.columns.length}>No data for this period.</td></tr>}
          </tbody>
          {report.totals && report.rows.length > 0 && <tfoot className="bg-slate-50 font-semibold"><tr>{report.columns.map((c, i) => <td key={c.key} className={clsx('td', ['money', 'num', 'pct'].includes(c.type ?? '') && 'text-right tabular-nums')}>{i === 0 ? 'Total' : report.totals![c.key] != null ? cell(c, report.totals![c.key]) : ''}</td>)}</tr></tfoot>}
        </table>
      </div>
    </div>
  );
}
export { fmtPkr };

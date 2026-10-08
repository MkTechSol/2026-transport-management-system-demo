import { ChevronDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import { useAction, useList, useQueryState } from '../lib/hooks';
import { post } from '../lib/api';
import { Button } from '../ui/Button';
import { ErrorState, PageLoader } from '../ui/Feedback';
import { FilterSelect, TextArea } from '../ui/Form';
import { Drawer } from '../ui/Overlay';
import { KV, KVGrid, PageHeader } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';
import { Link } from 'react-router-dom';
import { NEW_VOUCHER_TYPES, VOUCHER_LABELS, VoucherModal, money } from '../features/finance';

export function VoucherDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { can } = useAuth(); const [voiding, setVoiding] = useState(false); const [reason, setReason] = useState('');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/finance/vouchers', id], queryFn: () => get(`/finance/vouchers/${id}`) });
  const v = useAction(() => post(`/finance/vouchers/${id}/void`, { reason }), { invalidate: ['/finance', '/sales'], success: 'Voucher voided.', onSuccess: () => { setVoiding(false); refetch(); } });
  const vo = data?.voucher;
  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={vo ? `${vo.voucher_no}` : 'Voucher'} description={vo ? `${data.label} · ${fmtDate(vo.voucher_date)}` : undefined}
      footer={vo && vo.status === 'POSTED' && can('finance:post') && vo.source_type !== 'INVOICE' ? <Button variant="danger" onClick={() => setVoiding(true)}>Void voucher</Button> : undefined}>
      {isLoading ? <PageLoader /> : error || !vo ? <ErrorState error={error} onRetry={() => refetch()} /> : (
        <div className="space-y-5">
          <KVGrid cols={3}><KV label="Status"><StatusPill status={vo.status} /></KV><KV label="Amount">PKR {money(vo.total)}</KV><KV label="Entered by">{vo.created_by_name ?? 'System (auto-posted)'}</KV>
            {vo.vehicle_code && <KV label="Bowzer">{vo.vehicle_code}</KV>}{vo.trip_code && <KV label="Trip"><Link className="text-brand-700 hover:underline" to={`/trips/${vo.trip_id}`}>{vo.trip_code}</Link></KV>}<KV label="Narration" className="col-span-3">{vo.narration ?? '—'}</KV></KVGrid>
          {vo.void_reason && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Voided: {vo.void_reason}</p>}
          <div className="overflow-x-auto rounded-lg border border-line"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Account</th><th className="th">Bowzer / party</th><th className="th text-right">Debit</th><th className="th text-right">Credit</th></tr></thead>
            <tbody className="divide-y divide-line">{data.lines.map((l: any) => <tr key={l.id}><td className="td"><p className="font-medium">{l.account_code} · {l.account_name}</p>{l.memo && <p className="text-xs text-slate-500">{l.memo}</p>}</td><td className="td text-xs">{[l.vehicle_code, l.party_name, l.trip_code].filter(Boolean).join(' · ') || '—'}</td><td className="td text-right tabular-nums">{Number(l.debit) ? money(l.debit) : ''}</td><td className="td text-right tabular-nums">{Number(l.credit) ? money(l.credit) : ''}</td></tr>)}</tbody></table></div>
          {data.allocations.length > 0 && <div><p className="mb-1 text-sm font-semibold">Settles invoices</p>{data.allocations.map((a: any) => <p key={a.invoice_id} className="text-sm">{a.invoice_no} — PKR {money(a.amount)}</p>)}</div>}
          {voiding && <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3"><TextArea label="Reason for voiding" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={(v.error as any)?.fields?.reason} />
            {v.error && !(v.error as any).fields && <p className="text-sm text-red-700">{v.error.message}</p>}<div className="flex gap-2"><Button onClick={() => setVoiding(false)}>Keep</Button><Button variant="danger" loading={v.isPending} onClick={() => v.mutate(undefined as never)}>Void now</Button></div></div>}
        </div>
      )}
    </Drawer>
  );
}

export default function Vouchers() {
  const { can } = useAuth(); const [menu, setMenu] = useState(false); const [newType, setNewType] = useState<(typeof NEW_VOUCHER_TYPES)[number] | null>(null); const [open, setOpen] = useState<number | null>(null);
  const { state, set, clear, page } = useQueryState();
  const { data, isLoading, error, refetch } = useList('/finance/vouchers', { page, pageSize: 20, q: state.q, type: state.type, from: state.from, to: state.to, status: state.status });
  const cols: Column<any>[] = [
    { key: 'date', header: 'Date', render: (v) => <span className="whitespace-nowrap tabular-nums">{fmtDate(v.voucher_date)}</span> },
    { key: 'no', header: 'Voucher', render: (v) => <span className="font-semibold text-brand-700">{v.voucher_no}</span> },
    { key: 'type', header: 'Type', render: (v) => VOUCHER_LABELS[v.type] ?? v.type },
    { key: 'nar', header: 'Narration', hideBelow: 'md', render: (v) => <span className="line-clamp-1 max-w-md text-slate-700">{v.narration}</span> },
    { key: 'veh', header: 'Bowzer', hideBelow: 'lg', render: (v) => v.vehicle_code ?? '—' },
    { key: 'amt', header: 'Amount', render: (v) => <span className="tabular-nums">{money(v.total)}</span> },
    { key: 'st', header: 'Status', render: (v) => <StatusPill status={v.status} /> },
  ];
  return (
    <>
      <PageHeader title="Vouchers" subtitle="Cash and bank payments & receipts, bowzer expenses and journals — all postings in one register" breadcrumbs={[{ label: 'Finance' }, { label: 'Vouchers' }]}
        actions={can('finance:post') && <div className="relative"><Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setMenu(!menu)}>New voucher <ChevronDown className="h-4 w-4" /></Button>
          {menu && <div className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-line bg-white py-1 shadow-pop" role="menu">{NEW_VOUCHER_TYPES.map((t) => <button key={t} role="menuitem" className="block w-full px-4 py-2 text-left text-sm hover:bg-brand-50" onClick={() => { setMenu(false); setNewType(t); }}>{VOUCHER_LABELS[t]}</button>)}</div>}</div>} />
      <FilterBar active={['q', 'type', 'from', 'to', 'status'].some((k) => state[k])} onClear={() => clear()}>
        <SearchInput className="w-full sm:w-64" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search voucher no. or narration…" />
        <FilterSelect label="Type" value={state.type ?? 'ALL'} onChange={(v) => set({ type: v })} options={[{ value: 'ALL', label: 'All types' }, ...Object.entries(VOUCHER_LABELS).map(([k, l]) => ({ value: k, label: l }))]} />
        <FilterSelect label="Status" value={state.status ?? 'ALL'} onChange={(v) => set({ status: v })} options={[{ value: 'ALL', label: 'Any status' }, { value: 'POSTED', label: 'Posted' }, { value: 'VOID', label: 'Void' }]} />
        <div className="flex items-center gap-1.5 text-sm text-slate-500"><input type="date" aria-label="From" className="input w-auto py-2" value={state.from ?? ''} onChange={(e) => set({ from: e.target.value })} />to<input type="date" aria-label="To" className="input w-auto py-2" value={state.to ?? ''} onChange={(e) => set({ to: e.target.value })} /></div>
      </FilterBar>
      <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(v) => v.id} onRowClick={(v) => setOpen(v.id)} page={page} pageSize={20} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No vouchers match' }} />
      {newType && <VoucherModal type={newType} onClose={() => setNewType(null)} onSaved={(v) => setOpen(v.id)} />}
      {open != null && <VoucherDrawer id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

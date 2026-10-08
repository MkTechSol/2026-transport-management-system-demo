import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { get, qs } from '../lib/api';
import { ErrorState, PageLoader } from '../ui/Feedback';
import { PageHeader } from '../ui/Page';
import { AccountSelect, BowzerSelect, ReportTable, today } from '../features/finance';
import { DistributorPicker } from '../features/common';
import { VoucherDrawer } from './Vouchers';

export const FINANCE_REPORT_GROUPS: { title: string; items: { key: string; label: string; needs?: ('account' | 'bowzer' | 'party')[]; dates?: 'range' | 'asOf' | 'none' }[] }[] = [
  { title: 'Books', items: [
    { key: 'daybook', label: 'Day book', dates: 'range' }, { key: 'cash-book', label: 'Cash book', dates: 'range' }, { key: 'ledger', label: 'Account / bowzer / party ledger', needs: ['account', 'bowzer', 'party'], dates: 'range' }, { key: 'trial-balance', label: 'Trial balance', dates: 'range' }, { key: 'chart-of-accounts', label: 'Chart of accounts', dates: 'none' } ] },
  { title: 'Statements', items: [{ key: 'profit-loss', label: 'Profit & loss', needs: ['bowzer'], dates: 'range' }, { key: 'balance-sheet', label: 'Balance sheet', dates: 'asOf' }, { key: 'cash-flow', label: 'Cash flow', dates: 'range' }, { key: 'expense-report', label: 'Expense report', needs: ['bowzer'], dates: 'range' }] },
  { title: 'Bowzers', items: [{ key: 'bowzer-pnl', label: 'Bowzer profit & loss', dates: 'range' }] },
  { title: 'Receivables & payables', items: [{ key: 'receivable-aging', label: 'Receivable aging', dates: 'asOf' }, { key: 'invoice-aging', label: 'Invoice aging', dates: 'asOf' }, { key: 'payables', label: 'Payables by vendor', dates: 'asOf' }, { key: 'bank-balances', label: 'Bank balances', dates: 'asOf' }, { key: 'monthly-sales', label: 'Monthly sales', dates: 'range' }] },
];

export default function FinanceReports() {
  const { key = 'daybook' } = useParams(); const nav = useNavigate(); const [sp, setSp] = useSearchParams(); const [voucher, setVoucher] = useState<number | null>(null);
  const def = FINANCE_REPORT_GROUPS.flatMap((g) => g.items).find((i) => i.key === key) ?? FINANCE_REPORT_GROUPS[0].items[0];
  const p = (k: string) => sp.get(k) ?? '';
  const setP = (o: Record<string, string>) => setSp((cur) => { const n = new URLSearchParams(cur); for (const [k, v] of Object.entries(o)) v ? n.set(k, v) : n.delete(k); return n; }, { replace: true });
  const needsTarget = def.key === 'ledger' && !p('accountId') && !p('vehicleId') && !p('partyId');
  const params = { from: p('from') || undefined, to: p('to') || undefined, asOf: def.dates === 'asOf' ? p('asOf') || undefined : undefined, accountId: p('accountId') || undefined, vehicleId: p('vehicleId') || undefined, partyId: p('partyId') || undefined, partyType: p('partyId') ? p('partyType') || 'CUSTOMER' : undefined };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/finance/reports', key, params], queryFn: () => get(`/finance/reports/${def.key}${qs(params)}`), enabled: !needsTarget });
  const [party, setParty] = useState<any>(null);
  return (
    <>
      <PageHeader title="Financial Reports" subtitle="Every figure is calculated live from posted vouchers" breadcrumbs={[{ label: 'Finance' }, { label: 'Reports' }]} />
      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Report list" className="space-y-4">
          {FINANCE_REPORT_GROUPS.map((g) => <div key={g.title}><p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</p>
            {g.items.map((i) => <button key={i.key} onClick={() => nav(`/finance/reports/${i.key}`)} className={clsx('block w-full rounded-lg px-3 py-2 text-left text-sm', i.key === def.key ? 'bg-brand-50 font-semibold text-brand-700' : 'hover:bg-slate-100')}>{i.label}</button>)}</div>)}
        </nav>
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-3 print:hidden">
            {def.dates === 'range' && <><label className="text-xs font-medium text-slate-600">From<input type="date" className="input mt-1" value={p('from')} onChange={(e) => setP({ from: e.target.value })} /></label><label className="text-xs font-medium text-slate-600">To<input type="date" className="input mt-1" value={p('to') || today()} onChange={(e) => setP({ to: e.target.value })} /></label></>}
            {def.dates === 'asOf' && <label className="text-xs font-medium text-slate-600">As of<input type="date" className="input mt-1" value={p('asOf') || today()} onChange={(e) => setP({ asOf: e.target.value })} /></label>}
            {def.needs?.includes('account') && <div className="w-64"><AccountSelect label="Account" value={p('accountId')} onChange={(v) => setP({ accountId: v })} /></div>}
            {def.needs?.includes('bowzer') && <div className="w-48"><BowzerSelect value={p('vehicleId')} onChange={(v) => setP({ vehicleId: v })} /></div>}
            {def.needs?.includes('party') && <div className="w-64"><p className="mb-1 text-xs font-medium text-slate-600">Customer</p><DistributorPicker value={party} onChange={(d) => { setParty(d); setP({ partyId: d ? String(d.id) : '' }); }} /></div>}
            {def.key === 'ledger' && <p className="basis-full text-xs text-slate-500">Choose an account, a bowzer (each bowzer is its own account) or a customer.</p>}
          </div>
          {needsTarget ? <p className="rounded-xl border border-dashed border-line bg-white p-10 text-center text-sm text-slate-500">Pick an account, bowzer or customer above to open its ledger.</p>
            : isLoading ? <PageLoader /> : error || !data ? <ErrorState error={error} onRetry={() => refetch()} /> : <ReportTable report={data} fileName={def.key} onRowClick={(r) => setVoucher(r.voucher_id)} />}
        </div>
      </div>
      {voucher != null && <VoucherDrawer id={voucher} onClose={() => setVoucher(null)} />}
    </>
  );
}

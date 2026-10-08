import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader, Tabs } from '../ui/Page';
import { Column, DataTable } from '../ui/Table';
import { Alert } from '../ui/Feedback';
import { money } from '../features/finance';
import Distributors from './Distributors';

function Bowzers() {
  const { can } = useAuth(); const nav = useNavigate();
  const finance = can('finance:view');
  const pnl = useQuery({ queryKey: ['/finance/reports', 'bowzer-pnl', 'customers'], queryFn: () => get('/finance/reports/bowzer-pnl'), enabled: finance });
  const fleet = useQuery({ queryKey: ['/vehicles', 'customers-tab'], queryFn: () => get('/vehicles?pageSize=100&sort=code&dir=asc'), enabled: !finance });
  const rows: any[] = finance ? pnl.data?.rows ?? [] : fleet.data?.data ?? [];
  const idByCode = useQuery({ queryKey: ['/vehicles', 'ids'], queryFn: () => get('/vehicles?pageSize=100&sort=code&dir=asc'), staleTime: 60_000 });
  const ids = new Map<string, number>((idByCode.data?.data ?? []).map((v: any) => [v.code, v.id]));
  const cols: Column<any>[] = finance ? [
    { key: 'code', header: 'Bowzer account', render: (r) => <span className="font-semibold text-brand-700">{r.code}</span> }, { key: 'owner', header: 'Owner / partner', render: (r) => r.owner },
    { key: 'trips', header: 'Billed trips', render: (r) => r.trips }, { key: 'inc', header: 'Freight income', render: (r) => <span className="tabular-nums">{money(r.income)}</span> },
    { key: 'exp', header: 'Costs', render: (r) => <span className="tabular-nums">{money(r.fuel + r.other_exp)}</span> },
    { key: 'pr', header: 'Profit', render: (r) => <span className={`tabular-nums font-medium ${r.profit < 0 ? 'text-red-600' : 'text-green-700'}`}>{money(r.profit)}</span> }, { key: 'mg', header: 'Margin', render: (r) => (r.margin == null ? '—' : `${r.margin}%`) },
  ] : [{ key: 'code', header: 'Bowzer', render: (r) => <span className="font-semibold text-brand-700">{r.code}</span> }, { key: 'owner', header: 'Owner', render: (r) => r.owner_name ?? '—' }, { key: 'cap', header: 'Capacity', render: (r) => `${r.capacity_mt} MT` }];
  return <>
    <Alert tone="info" className="mb-3">Every bowzer is its own account: freight income, fuel, repairs, tyres and parts are charged to it, so its profit and loss and ledger are always available. {finance ? 'Showing the current fiscal year.' : ''}</Alert>
    <DataTable columns={cols} rows={rows} loading={pnl.isLoading || fleet.isLoading} error={pnl.error ?? fleet.error} rowKey={(r) => r.code} onRowClick={(r) => { const id = r.id ?? ids.get(r.code); if (id) nav(`/fleet/${id}?tab=account`); }} empty={{ title: 'No bowzers yet' }} />
  </>;
}

export default function Customers() {
  const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') ?? 'bowzers';
  return <>
    <PageHeader title="Customers" subtitle="Bowzer accounts and the distributors & marketers we bill" breadcrumbs={[{ label: 'Sales' }, { label: 'Customers' }]} />
    <Tabs value={tab} onChange={(k) => setSp({ tab: k })} tabs={[{ key: 'bowzers', label: 'Bowzers (vehicle accounts)' }, { key: 'parties', label: 'Distributors & marketers' }]} />
    <div className="mt-4">{tab === 'bowzers' ? <Bowzers /> : <Distributors embedded />}</div>
  </>;
}

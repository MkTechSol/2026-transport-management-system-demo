import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get, patch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { regionLabel } from '../lib/format';
import { useAction } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert, ErrorState, PageLoader } from '../ui/Feedback';
import { PageHeader, Section, Tabs } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { fmtDateTime } from '../lib/format';

interface Card { title: string; to: string; count?: (c: any) => string; hint: string; perm?: string }
const GROUPS: { title: string; cards: Card[] }[] = [
  { title: 'Operations masters', cards: [
    { title: 'Plants, terminals & depots', to: '/locations', count: (c) => `${c.locations}`, hint: 'Loading and parking points' },
    { title: 'Refineries / gas fields (uplift points)', to: '/locations?type=FIELD', count: (c) => `${c.fields}`, hint: 'Where uplifting trips load' },
    { title: 'Routes & freight rates', to: '/routes', count: (c) => `${c.routes}`, hint: 'Distance, duration and freight per MT' },
    { title: 'Bowzers (fleet)', to: '/fleet', count: (c) => `${c.bowzers}`, hint: 'Vehicles, owners, chassis, wheels' },
    { title: 'Drivers', to: '/drivers', count: (c) => `${c.drivers}`, hint: 'Licences and assignments' },
    { title: 'Customers — distributors & marketers', to: '/customers?tab=parties', count: (c) => `${c.distributors + c.marketers}`, hint: 'Credit limits and terms' },
    { title: 'Transporters & vendors', to: '/vendors', count: (c) => `${c.vendors + c.transporters}`, hint: 'Suppliers, workshops, fuel stations, sub-contractors' },
    { title: 'Trip expense definitions', to: '/setup?tab=expenses', hint: 'Expense types and defaults' },
  ] },
  { title: 'Finance', cards: [
    { title: 'Chart of accounts', to: '/finance/accounts', count: (c) => `${c.accounts}`, hint: 'Account levels and headings' },
    { title: 'Banks', to: '/finance/accounts?tab=banks', count: (c) => `${c.banks}`, hint: 'Bank accounts' },
    { title: 'Fiscal years (sessions)', to: '/finance/accounts?tab=years', count: (c) => `${c.fiscal_years}`, hint: 'Open and close periods' },
    { title: 'Approval rules', to: '/settings?tab=approvals', count: (c) => `${c.approval_rules}`, hint: 'Who approves what, from which amount' },
  ] },
  { title: 'Inventory', cards: [
    { title: 'Items', to: '/inventory', count: (c) => `${c.items}`, hint: 'Spares, tyres, cameras, consumables' },
    { title: 'Categories, sub-categories & brands', to: '/inventory?tab=masters', count: (c) => `${c.categories} / ${c.brands}`, hint: 'Item classification' },
    { title: 'Warehouses / stores', to: '/inventory?tab=stores', count: (c) => `${c.warehouses}`, hint: 'Where stock is kept' },
  ] },
  { title: 'People & system', cards: [
    { title: 'Staff & employees', to: '/hr', count: (c) => `${c.employees}`, hint: 'Departments, salaries, bank details' },
    { title: 'Users & roles', to: '/users', count: (c) => `${c.users}`, hint: 'Accounts and permissions' },
    { title: 'System settings', to: '/settings', hint: 'Delay thresholds, fuel variance, payment terms' },
    { title: 'Audit log', to: '/audit', hint: 'Who changed what, and when' },
  ] },
];

function Expenses() {
  const { can } = useAuth(); const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/setup/expense-definitions'], queryFn: () => get('/setup/expense-definitions') }); const [edit, setEdit] = useState<Record<string, string>>({});
  const save = useAction((v: { category: string; body: any }) => patch(`/setup/expense-definitions/${v.category}`, v.body), { invalidate: ['/setup'], success: 'Expense type updated.', onSuccess: () => refetch() });
  if (isLoading) return <PageLoader />; if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  return <><Alert tone="info" className="mb-3">Default amounts pre-fill the trip expense form. Categories drive ledger accounts, so new categories are added by MK TechSol; the defaults and visibility are yours to change.</Alert>
    <div className="overflow-x-auto rounded-xl border border-line bg-white"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Expense type</th><th className="th">Default amount (PKR)</th><th className="th">Receipt expected</th><th className="th">Active</th><th className="th">Note</th></tr></thead>
      <tbody className="divide-y divide-line">{data.data.map((d: any) => <tr key={d.category}><td className="td font-medium">{d.label}</td>
        <td className="td"><div className="flex items-center gap-2"><input aria-label={`Default amount for ${d.label}`} type="number" min="0" className="input w-32" disabled={!can('settings:manage')} value={edit[d.category] ?? String(d.default_amount)} onChange={(e) => setEdit({ ...edit, [d.category]: e.target.value })} />
          {can('settings:manage') && edit[d.category] !== undefined && Number(edit[d.category]) !== d.default_amount && <Button size="sm" variant="primary" onClick={() => save.mutate({ category: d.category, body: { defaultAmount: Number(edit[d.category]) } })}>Save</Button>}</div></td>
        <td className="td"><input type="checkbox" aria-label={`Receipt expected for ${d.label}`} disabled={!can('settings:manage')} checked={d.requires_receipt} onChange={(e) => save.mutate({ category: d.category, body: { requiresReceipt: e.target.checked } })} /></td>
        <td className="td"><input type="checkbox" aria-label={`${d.label} active`} disabled={!can('settings:manage')} checked={d.active} onChange={(e) => save.mutate({ category: d.category, body: { active: e.target.checked } })} /></td><td className="td text-slate-600">{d.note}</td></tr>)}</tbody></table></div></>;
}

function Integrity() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({ queryKey: ['/setup/integrity'], queryFn: () => get('/setup/integrity'), staleTime: 0 });
  return <>
    <div className="mb-3 flex items-center justify-between"><p className="text-sm text-slate-600">Cross-checks that the sub-ledgers (invoices, stock, tyres, payroll) agree with the general ledger. Run it before month-end close.</p><Button variant="primary" loading={isFetching} onClick={() => refetch()}>Run checks again</Button></div>
    {isLoading ? <PageLoader /> : error || !data ? <ErrorState error={error} onRetry={() => refetch()} /> : <>
      <Alert tone={data.ok ? 'success' : 'warning'} className="mb-3" title={data.ok ? 'All checks passed' : 'Some checks need attention'}>Last run {fmtDateTime(data.ranAt)}</Alert>
      <ul className="divide-y divide-line rounded-xl border border-line bg-white">{data.checks.map((c: any) => <li key={c.name} className="flex items-start gap-3 px-4 py-3">{c.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />}<div><p className="text-sm font-medium">{c.name}</p><p className="text-xs text-slate-500">{c.detail}</p></div></li>)}</ul></>}
  </>;
}

export default function SetupHub() {
  const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') ?? 'masters';
  const ov = useQuery({ queryKey: ['/setup/overview'], queryFn: () => get('/setup/overview') });
  return <>
    <PageHeader title="Setup" subtitle="Every master list in one place — plus expense definitions, regions, data checks and backup guidance" breadcrumbs={[{ label: 'Administration' }, { label: 'Setup' }]} />
    <Tabs value={tab} onChange={(k) => setSp({ tab: k })} tabs={[{ key: 'masters', label: 'Master data' }, { key: 'expenses', label: 'Trip expense definitions' }, { key: 'regions', label: 'States & regions' }, { key: 'integrity', label: 'Data integrity' }, { key: 'backup', label: 'Backup & utilities' }]} />
    <div className="mt-4">
      {tab === 'masters' && (ov.isLoading ? <PageLoader /> : ov.error || !ov.data ? <ErrorState error={ov.error} onRetry={() => ov.refetch()} /> : <div className="space-y-6">{GROUPS.map((g) => <div key={g.title}><h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{g.title}</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{g.cards.map((c) => <Link key={c.title} to={c.to} className="card block p-4 transition hover:border-brand-400 hover:shadow-md"><div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold text-ink">{c.title}</p>{c.count && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">{c.count(ov.data.counts)}</span>}</div><p className="mt-1 text-xs text-slate-500">{c.hint}</p></Link>)}</div></div>)}</div>)}
      {tab === 'expenses' && <Expenses />}
      {tab === 'regions' && <Section title="States & regions in use" subtitle="Regions group distributors and routes for reporting"><div className="flex flex-wrap gap-2">{(ov.data?.regions ?? []).map((r: string) => <StatusPill key={r} status="ACTIVE" label={regionLabel(r)} />)}</div></Section>}
      {tab === 'integrity' && <Integrity />}
      {tab === 'backup' && <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Backups"><ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700"><li>The database is backed up nightly with <code>deploy/backup.sh</code> (compressed pg_dump, 14 daily copies kept).</li><li>Restore: <code>gunzip -c backup.sql.gz | psql …</code> into an empty database, then start the API (migrations are idempotent).</li><li>Before any restore, copy the current database first; restores are not undoable.</li><li>The demo environment can be reset to its seeded state from the sidebar (Super Admin only).</li></ul></Section>
        <Section title="Utilities"><ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700"><li><b>Data integrity</b> tab: ledger, receivables, stock and payroll cross-checks.</li><li><b>Reports</b> export to CSV from every report screen; vouchers and invoices print from the browser.</li><li><b>Audit log</b> records logins, status changes, postings and master-data edits.</li><li>Fiscal-year close is under Finance → Accounts &amp; Banks → Fiscal years.</li></ul></Section></div>}
    </div>
  </>;
}

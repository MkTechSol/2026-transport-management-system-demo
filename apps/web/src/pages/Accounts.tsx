import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { get, post, patch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import { fieldErrors, useAction } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert, ErrorState, PageLoader } from '../ui/Feedback';
import { SelectInput, TextInput } from '../ui/Form';
import { Modal } from '../ui/Overlay';
import { PageHeader, Tabs } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { money, today } from '../features/finance';

function AccountModal({ onClose, accounts }: { onClose: () => void; accounts: any[] }) {
  const [f, setF] = useState({ code: '', name: '', parentId: '', postable: 'true' });
  const m = useAction(() => post('/finance/accounts', { code: f.code, name: f.name, parentId: Number(f.parentId), postable: f.postable === 'true' }), { invalidate: ['/finance'], success: 'Account created.', onSuccess: onClose });
  const fe = fieldErrors(m.error);
  return <Modal open onClose={onClose} title="New account" description="Accounts sit under a heading and inherit its type" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Save (F10)</Button></>}>
    <div className="grid gap-4">{m.error && !m.error.fields && <Alert tone="danger">{m.error.message}</Alert>}
      <SelectInput label="Parent heading" required value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })} placeholder="Select parent" error={fe.parentId} options={accounts.filter((a) => a.level < 4).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
      <TextInput label="Code" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} error={fe.code} placeholder="e.g. 5440" /><TextInput label="Account name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={fe.name} />
      <SelectInput label="Kind" value={f.postable} onChange={(e) => setF({ ...f, postable: e.target.value })} options={[{ value: 'true', label: 'Posting account (vouchers can use it)' }, { value: 'false', label: 'Heading (groups other accounts)' }]} /></div></Modal>;
}
function BankModal({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: '', branch: '', accountNo: '' });
  const m = useAction(() => post('/finance/banks', f), { invalidate: ['/finance'], success: 'Bank account added.', onSuccess: onClose }); const fe = fieldErrors(m.error);
  return <Modal open onClose={onClose} title="New bank account" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Save (F10)</Button></>}>
    <div className="grid gap-4">{m.error && !m.error.fields && <Alert tone="danger">{m.error.message}</Alert>}<TextInput label="Bank name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={fe.name} /><TextInput label="Branch" value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} /><TextInput label="Account no. / IBAN" value={f.accountNo} onChange={(e) => setF({ ...f, accountNo: e.target.value })} /></div></Modal>;
}
function FiscalModal({ onClose }: { onClose: () => void }) {
  const y = new Date().getFullYear() + 1;
  const [f, setF] = useState({ label: `${y}-${String(y + 1).slice(2)}`, startsOn: `${y}-07-01`, endsOn: `${y + 1}-06-30` });
  const m = useAction(() => post('/finance/fiscal-years', f), { invalidate: ['/finance'], success: 'Fiscal year added.', onSuccess: onClose }); const fe = fieldErrors(m.error);
  return <Modal open onClose={onClose} title="New fiscal year" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Save (F10)</Button></>}>
    <div className="grid gap-4">{m.error && !m.error.fields && <Alert tone="danger">{m.error.message}</Alert>}<TextInput label="Session label" required value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} error={fe.label} /><TextInput label="Starts" type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} error={fe.startsOn} /><TextInput label="Ends" type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} error={fe.endsOn} /></div></Modal>;
}

export default function Accounts() {
  const { can } = useAuth(); const nav = useNavigate(); const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') ?? 'chart'; const [modal, setModal] = useState<string | null>(null);
  const accts = useQuery({ queryKey: ['/finance/accounts', 'balances'], queryFn: () => get('/finance/accounts?balances=1') });
  const banks = useQuery({ queryKey: ['/finance/banks'], queryFn: () => get('/finance/banks') });
  const fys = useQuery({ queryKey: ['/finance/fiscal-years'], queryFn: () => get('/finance/fiscal-years') });
  const closeFy = useAction((id: number) => post(`/finance/fiscal-years/${id}/close`, {}), { invalidate: ['/finance'], success: 'Fiscal year closed.' });
  const toggle = useAction((a: any) => patch(`/finance/accounts/${a.id}`, { active: !a.active }), { invalidate: ['/finance'], success: 'Account updated.' });
  const rows: any[] = accts.data?.data ?? [];
  return (
    <>
      <PageHeader title="Chart of Accounts & Setup" subtitle="Account levels, bank accounts and fiscal sessions" breadcrumbs={[{ label: 'Finance' }, { label: 'Accounts' }]}
        actions={can('finance:post') && <>{tab === 'chart' && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setModal('account')}>New account</Button>}{tab === 'banks' && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setModal('bank')}>New bank</Button>}{tab === 'years' && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setModal('fy')}>New fiscal year</Button>}</>} />
      <Tabs value={tab} onChange={(k) => setSp({ tab: k })} tabs={[{ key: 'chart', label: 'Chart of accounts' }, { key: 'banks', label: 'Banks' }, { key: 'years', label: 'Fiscal years' }]} />
      <div className="mt-4">
        {tab === 'chart' && (accts.isLoading ? <PageLoader /> : accts.error ? <ErrorState error={accts.error} onRetry={() => accts.refetch()} /> :
          <div className="overflow-x-auto rounded-xl border border-line bg-white"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Code</th><th className="th">Account</th><th className="th">Type</th><th className="th text-right">Balance (Dr+/Cr−)</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-line">{rows.map((a) => <tr key={a.id} className={clsx(!a.postable && 'bg-slate-50/70 font-semibold', !a.active && 'text-slate-400', a.postable && 'cursor-pointer hover:bg-brand-50/50')} onClick={() => a.postable && nav(`/finance/reports/ledger?accountId=${a.id}`)}>
              <td className="td tabular-nums">{a.code}</td><td className="td" style={{ paddingLeft: `${(a.level - 1) * 18 + 12}px` }}>{a.name}</td><td className="td text-xs">{a.type}</td><td className="td text-right tabular-nums">{a.postable ? money(a.balance) : ''}</td>
              <td className="td text-right" onClick={(e) => e.stopPropagation()}>{can('finance:post') && !a.system_key && a.postable && <button className="text-xs text-brand-700 hover:underline" onClick={() => toggle.mutate(a)}>{a.active ? 'Deactivate' : 'Activate'}</button>}</td></tr>)}</tbody></table></div>)}
        {tab === 'banks' && <div className="overflow-x-auto rounded-xl border border-line bg-white"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Bank</th><th className="th">Branch</th><th className="th">Account no.</th><th className="th text-right">Balance</th></tr></thead>
          <tbody className="divide-y divide-line">{(banks.data?.data ?? []).map((b: any) => <tr key={b.id} className="cursor-pointer hover:bg-brand-50/50" onClick={() => nav(`/finance/reports/ledger?accountId=${b.account_id}`)}><td className="td font-medium">{b.name}</td><td className="td">{b.branch}</td><td className="td tabular-nums">{b.account_no}</td><td className="td text-right tabular-nums">{money(b.balance)}</td></tr>)}</tbody></table></div>}
        {tab === 'years' && <div className="overflow-x-auto rounded-xl border border-line bg-white"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Session</th><th className="th">From</th><th className="th">To</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-line">{(fys.data?.data ?? []).map((y: any) => <tr key={y.id}><td className="td font-medium">{y.label}</td><td className="td">{fmtDate(y.starts_on)}</td><td className="td">{fmtDate(y.ends_on)}</td><td className="td"><StatusPill status={y.status} /></td><td className="td text-right">{y.status === 'OPEN' && y.ends_on < today() && can('finance:post') && <Button size="sm" onClick={() => closeFy.mutate(y.id)}>Close year</Button>}</td></tr>)}</tbody></table></div>}
      </div>
      {modal === 'account' && <AccountModal accounts={rows} onClose={() => setModal(null)} />}{modal === 'bank' && <BankModal onClose={() => setModal(null)} />}{modal === 'fy' && <FiscalModal onClose={() => setModal(null)} />}
    </>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Lock, ShieldCheck, Users as UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ROLES, ROLE_LABELS } from '@gasman/shared';
import { del, get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, fmtPkr, timeAgo, titleCase } from '../lib/format';
import { useAction, useQueryState } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert, PageLoader } from '../ui/Feedback';
import { SelectInput, TextInput } from '../ui/Form';
import { KpiCard, PageHeader, Section, Tabs } from '../ui/Page';
import { Pill } from '../ui/Pill';

export default function Settings() {
  const { state, set } = useQueryState(); const tab = state.tab ?? 'transport';
  return (
    <>
      <PageHeader title="Settings" subtitle="Transportation rules, approval workflow and security" breadcrumbs={[{ label: 'Administration' }, { label: 'Settings' }]} />
      <Tabs value={tab} onChange={(k) => set({ tab: k })} tabs={[{ key: 'transport', label: 'Transportation settings' }, { key: 'rules', label: 'Approval rules' }, { key: 'security', label: 'Security dashboard' }]} />
      {tab === 'transport' && <Transport />}{tab === 'rules' && <Rules />}{tab === 'security' && <Security />}
    </>
  );
}

function Transport() {
  const { can } = useAuth(); const { data, isLoading } = useQuery({ queryKey: ['/settings'], queryFn: () => get('/settings') });
  const [vals, setVals] = useState<Record<string, any>>({});
  useEffect(() => { if (data) setVals(Object.fromEntries(data.data.map((s: any) => [s.key, s.value]))); }, [data]);
  const m = useAction(() => patch('/settings', Object.fromEntries(data.data.filter((s: any) => vals[s.key] !== s.value).map((s: any) => [s.key, vals[s.key]]))), { invalidate: ['/settings'], success: 'Settings saved.' });
  if (isLoading || !data) return <PageLoader />;
  const groups = [...new Set<string>(data.data.map((s: any) => s.group))];
  const dirty = data.data.some((s: any) => vals[s.key] !== s.value);
  const canEdit = can('settings:manage');
  return (
    <div className="space-y-5">
      {!canEdit && <Alert tone="info">You can view these settings but only an administrator or transport manager can change them.</Alert>}
      {m.error && <Alert tone="danger">{m.error.message}</Alert>}
      {groups.map((g) => (
        <Section key={g} title={g}>
          <div className="grid gap-5 sm:grid-cols-2">
            {data.data.filter((s: any) => s.group === g).map((s: any) => s.type === 'boolean' ? (
              <label key={s.key} className="flex items-start gap-3 rounded-lg border border-line p-3"><input type="checkbox" className="mt-1" disabled={!canEdit} checked={!!vals[s.key]} onChange={(e) => setVals({ ...vals, [s.key]: e.target.checked })} /><span><span className="block text-sm font-medium">{s.label}</span><span className="block text-xs text-slate-500">{s.description}</span></span></label>
            ) : (
              <TextInput key={s.key} label={s.label} type="number" step="any" disabled={!canEdit} value={vals[s.key] ?? ''} onChange={(e) => setVals({ ...vals, [s.key]: e.target.value === '' ? '' : Number(e.target.value) })} hint={s.description} />
            ))}
          </div>
        </Section>
      ))}
      {canEdit && <div className="sticky bottom-3 flex justify-end"><Button variant="primary" loading={m.isPending} disabled={!dirty} onClick={() => m.mutate(undefined as never)}>Save changes</Button></div>}
    </div>
  );
}

const ENTITIES = ['TRIP_EXPENSE', 'PURCHASE_REQUISITION', 'PURCHASE_ORDER', 'LEAVE', 'PAYROLL'];
function Rules() {
  const { can } = useAuth(); const { data, isLoading, refetch } = useQuery({ queryKey: ['/approvals', 'rules'], queryFn: () => get('/approvals/rules') });
  const [f, setF] = useState({ entityType: 'TRIP_EXPENSE', minAmount: '0', approverRole: 'TRANSPORT_MANAGER' });
  const add = useAction(() => post('/approvals/rules', { entityType: f.entityType, minAmount: Number(f.minAmount), approverRole: f.approverRole }), { invalidate: ['/approvals'], success: 'Rule added.', onSuccess: () => refetch() });
  const rm = useAction((id: number) => del(`/approvals/rules/${id}`), { invalidate: ['/approvals'], success: 'Rule removed.', onSuccess: () => refetch() });
  const tog = useAction((r: any) => patch(`/approvals/rules/${r.id}`, { active: !r.active }), { invalidate: ['/approvals'], onSuccess: () => refetch() });
  if (isLoading || !data) return <PageLoader />;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <Section title="Approval workflow rules" subtitle="For each request type, the rule with the highest threshold not above the amount decides who must approve" padded={false}>
        <table className="w-full"><thead className="bg-slate-50/70"><tr><th className="th">Request type</th><th className="th text-right">From amount</th><th className="th">Approver</th><th className="th">Active</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-line">{data.data.map((r: any) => <tr key={r.id}><td className="td font-medium">{titleCase(r.entity_type)}</td><td className="td text-right tabular-nums">{fmtPkr(r.min_amount)}</td><td className="td"><Pill tone="blue" dot={false}>{ROLE_LABELS[r.approver_role as keyof typeof ROLE_LABELS] ?? r.approver_role}</Pill></td>
            <td className="td"><input type="checkbox" aria-label="Active" checked={r.active} disabled={!can('approvals:configure')} onChange={() => tog.mutate(r)} /></td><td className="td text-right">{can('approvals:configure') && <Button size="sm" variant="ghost" onClick={() => rm.mutate(r.id)}>Remove</Button>}</td></tr>)}</tbody></table>
      </Section>
      {can('approvals:configure') && (
        <Section title="Add rule"><div className="space-y-3">
          {add.error && <Alert tone="danger">{add.error.message}</Alert>}
          <SelectInput label="Request type" value={f.entityType} onChange={(e) => setF({ ...f, entityType: e.target.value })} options={ENTITIES.map((e) => ({ value: e, label: titleCase(e) }))} />
          <TextInput label="Applies from amount (PKR)" type="number" min="0" value={f.minAmount} onChange={(e) => setF({ ...f, minAmount: e.target.value })} />
          <SelectInput label="Approver role" value={f.approverRole} onChange={(e) => setF({ ...f, approverRole: e.target.value })} options={ROLES.filter((r) => r !== 'DRIVER').map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
          <Button variant="primary" className="w-full" loading={add.isPending} onClick={() => add.mutate(undefined as never)}>Add rule</Button>
        </div></Section>
      )}
    </div>
  );
}

function Security() {
  const { data, isLoading } = useQuery({ queryKey: ['/settings', 'security'], queryFn: () => get('/settings/security'), refetchInterval: 30_000 });
  if (isLoading || !data) return <PageLoader />;
  const s = data.stats;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Active users" value={s.active_users} icon={<UsersIcon className="h-5 w-5" />} tone="green" /><KpiCard label="Active sessions" value={s.active_sessions} icon={<ShieldCheck className="h-5 w-5" />} />
        <KpiCard label="Sign-ins (24h)" value={s.logins_24h} tone="slate" /><KpiCard label="Failed sign-ins (24h)" value={s.failed_logins_24h} tone={s.failed_logins_24h ? 'amber' : 'slate'} />
        <KpiCard label="Locked / disabled" value={`${s.locked_users} / ${s.disabled_users}`} icon={<Lock className="h-5 w-5" />} tone={s.locked_users ? 'red' : 'slate'} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Section title="Recent security events" padded={false}><ul className="divide-y divide-line">{data.recent.map((e: any, i: number) => <li key={i} className="flex items-center justify-between px-5 py-3 text-sm"><span><b>{e.user_email ?? 'unknown'}</b> <span className="text-slate-500">· {titleCase(e.action)}</span></span><span className="text-xs text-slate-500">{e.ip} · {timeAgo(e.created_at)}</span></li>)}</ul></Section>
        <Section title="Policy"><dl className="space-y-2 text-sm">{[['Minimum password length', `${data.policy.passwordMinLength} characters`], ['Account lockout', `after ${data.policy.lockoutAfter} failures, ${data.policy.lockoutMinutes} min`], ['Access token lifetime', `${data.policy.accessTokenMinutes} min`], ['Refresh token lifetime', `${data.policy.refreshTokenDays} days (rotating)`], ['Password storage', 'bcrypt'], ['API authorization', 'role-based, enforced server-side']].map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-slate-600">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}</dl>
          <p className="mt-4 text-xs text-slate-500">Last refreshed {fmtDateTime(new Date())}.</p></Section>
      </div>
    </div>
  );
}

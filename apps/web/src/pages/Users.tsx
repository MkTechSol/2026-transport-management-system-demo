import { Check, Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ROLES, ROLE_LABELS, Role } from '@gasman/shared';
import { get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { fieldErrors, useAction, useList, useQueryState } from '../lib/hooks';
import { useDriverOptions } from '../features/common';
import { Button } from '../ui/Button';
import { Alert, PageLoader } from '../ui/Feedback';
import { FilterSelect, SelectInput, TextInput } from '../ui/Form';
import { Modal } from '../ui/Overlay';
import { PageHeader, Section, Tabs } from '../ui/Page';
import { Pill, StatusPill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';

export default function Users() {
  const { can } = useAuth(); const { state, set, page } = useQueryState(); const tab = state.tab ?? 'users'; const [form, setForm] = useState<any | null | undefined>(undefined);
  const { data, isLoading, error, refetch } = useList('/users', { page, pageSize: 15, q: state.q, role: state.role });
  const cols: Column<any>[] = [
    { key: 'n', header: 'User', render: (u) => <div><p className="font-semibold">{u.full_name}</p><p className="text-xs text-slate-500">{u.email}</p></div> },
    { key: 'r', header: 'Role', render: (u) => <Pill tone={u.role === 'SUPER_ADMIN' ? 'purple' : 'blue'} dot={false}>{ROLE_LABELS[u.role as Role]}</Pill> },
    { key: 'd', header: 'Linked driver', hideBelow: 'md', render: (u) => u.driver_name ?? '—' },
    { key: 'l', header: 'Last sign-in', hideBelow: 'lg', render: (u) => fmtDateTime(u.last_login_at) },
    { key: 's', header: 'Status', render: (u) => <StatusPill status={u.status} /> },
    { key: 'a', header: '', render: (u) => can('users:manage') && <div className="text-right"><Button size="sm" onClick={() => setForm(u)}>Edit</Button></div> },
  ];
  return (
    <>
      <PageHeader title="Users & Roles" subtitle="Access is enforced by the API — not just hidden in the UI" breadcrumbs={[{ label: 'Administration' }, { label: 'Users & roles' }]} actions={can('users:manage') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setForm(null)}>Add user</Button>} />
      <Tabs value={tab} onChange={(k) => set({ tab: k })} tabs={[{ key: 'users', label: 'Users' }, { key: 'matrix', label: 'Permission matrix' }]} />
      {tab === 'users' && <>
        <FilterBar><SearchInput className="w-full sm:w-72" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search name or email…" />
          <FilterSelect label="Role" value={state.role ?? 'ALL'} onChange={(v) => set({ role: v })} options={[{ value: 'ALL', label: 'All roles' }, ...ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))]} /></FilterBar>
        <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(u) => u.id} page={page} pageSize={15} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No users' }} />
      </>}
      {tab === 'matrix' && <Matrix />}
      {form !== undefined && <UserForm user={form} onClose={() => { setForm(undefined); refetch(); }} />}
    </>
  );
}

const SHORT: Record<string, string> = { view: 'View', create: 'Create', update: 'Edit', archive: 'Archive', manage: 'Manage', assign: 'Assign', dispatch: 'Dispatch', progress: 'Update', cancel: 'Cancel', report: 'Report', export: 'Export', reset: 'Reset' };
function Matrix() {
  const { data, isLoading } = useQuery({ queryKey: ['/users', 'roles'], queryFn: () => get('/users/roles') });
  if (isLoading || !data) return <PageLoader />;
  return (
    <Section padded={false} title="Role × module permissions" subtitle="Each cell lists the actions the role may perform. This is the same matrix the API enforces.">
      <div className="overflow-x-auto"><table className="w-full min-w-[900px]">
        <thead className="bg-slate-50/70"><tr><th className="th">Module</th>{data.roles.map((r: any) => <th key={r.role} className="th text-center">{r.label}<span className="block font-normal normal-case text-slate-400">{r.users} user{r.users === 1 ? '' : 's'}</span></th>)}</tr></thead>
        <tbody className="divide-y divide-line">{data.modules.map((m: any) => (
          <tr key={m.module}><td className="td font-medium">{m.module}</td>{data.roles.map((r: any) => {
            const allowed = m.perms.filter((p: string) => r.permissions.includes(p));
            return <td key={r.role} className="td text-center">{allowed.length === 0 ? <Minus className="mx-auto h-4 w-4 text-slate-300" /> : allowed.length === m.perms.length && m.perms.length > 1 ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700"><Check className="h-4 w-4" />Full</span> : <span className="text-xs text-slate-700">{allowed.map((p: string) => SHORT[p.split(':')[1]] ?? p).join(' · ')}</span>}</td>; })}</tr>))}
        </tbody></table></div>
      <p className="border-t border-line px-5 py-3 text-xs text-slate-500">Drivers see only their own trips, vehicle, profile and documents. Management has read-only access plus report export.</p>
    </Section>
  );
}

function UserForm({ user, onClose }: { user: any | null; onClose: () => void }) {
  const drivers = useDriverOptions();
  const [f, setF] = useState({ email: user?.email ?? '', fullName: user?.full_name ?? '', role: user?.role ?? 'DISPATCHER', driverId: String(user?.driver_id ?? ''), password: '', status: user?.status ?? 'ACTIVE' });
  const set = (k: string) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  const m = useAction(() => (user ? patch(`/users/${user.id}`, { fullName: f.fullName, role: f.role, driverId: f.role === 'DRIVER' && f.driverId ? Number(f.driverId) : null, status: f.status, ...(f.password ? { password: f.password } : {}) })
    : post('/users', { email: f.email, fullName: f.fullName, role: f.role, driverId: f.role === 'DRIVER' && f.driverId ? Number(f.driverId) : null, password: f.password })), { invalidate: ['/users'], success: 'User saved.', onSuccess: onClose });
  const fe = fieldErrors(m.error);
  return (
    <Modal open onClose={onClose} title={user ? `Edit ${user.full_name}` : 'Add user'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {m.error && !m.error.fields && <div className="sm:col-span-2"><Alert tone="danger">{m.error.message}</Alert></div>}
        <TextInput label="Email" required type="email" value={f.email} onChange={set('email')} error={fe.email} disabled={!!user} wrapperClassName="sm:col-span-2" />
        <TextInput label="Full name" required value={f.fullName} onChange={set('fullName')} error={fe.fullName} />
        <SelectInput label="Role" value={f.role} onChange={set('role')} options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
        {f.role === 'DRIVER' && <SelectInput label="Driver profile" required value={f.driverId} onChange={set('driverId')} error={fe.driverId} placeholder="Select driver" options={(drivers.data?.data ?? []).map((d: any) => ({ value: d.id, label: `${d.full_name} (${d.employee_id})` }))} wrapperClassName="sm:col-span-2" />}
        <TextInput label={user ? 'New password (leave blank to keep)' : 'Password'} type="password" autoComplete="new-password" value={f.password} onChange={set('password')} error={fe.password} hint="At least 10 characters" required={!user} />
        {user && <SelectInput label="Status" value={f.status} onChange={set('status')} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'DISABLED', label: 'Disabled' }]} />}
      </div>
    </Modal>
  );
}

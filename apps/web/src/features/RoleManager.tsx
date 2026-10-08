import { Copy, Lock, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { del, get, patch, post } from '../lib/api';
import { fieldErrors, useAction } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert, PageLoader } from '../ui/Feedback';
import { SelectInput, TextArea, TextInput } from '../ui/Form';
import { Pill } from '../ui/Pill';
import { Section } from '../ui/Page';

const ACTION: Record<string, string> = { view: 'View', create: 'Create', update: 'Edit', archive: 'Archive', manage: 'Manage', assign: 'Assign', dispatch: 'Dispatch', progress: 'Update progress', cancel: 'Cancel', report: 'Report', export: 'Export', record: 'Record', approve: 'Approve', decide: 'Decide', configure: 'Configure', post: 'Post entries', use: 'Use' };
const permLabel = (p: string) => { const [mod, act] = p.split(':'); return act === 'manage' && mod === 'payroll' ? 'Manage payroll' : (ACTION[act] ?? act); };

interface Draft { code: string | null; name: string; description: string; basedOn: string; permissions: string[]; builtIn: boolean; users: number }
const blank = (): Draft => ({ code: null, name: '', description: '', basedOn: 'DISPATCHER', permissions: [], builtIn: false, users: 0 });

function Check({ checked, indeterminate, onChange, label, hint, disabled }: { checked: boolean; indeterminate?: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate && !checked; }, [indeterminate, checked]);
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-70' : 'cursor-pointer'}`} title={hint}>
      <input ref={ref} type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Super-admin screen: create roles and tick exactly what they may do (all / per module / individually). */
export function RoleManager() {
  const { data, isLoading, refetch } = useQuery({ queryKey: ['/roles'], queryFn: () => get('/roles') });
  const [draft, setDraft] = useState<Draft | null>(null);
  const all: string[] = useMemo(() => (data?.groups ?? []).flatMap((g: any) => g.perms), [data]);
  const save = useAction(() => (draft!.code ? patch(`/roles/${draft!.code}`, { name: draft!.name, description: draft!.description || null, basedOn: draft!.basedOn, permissions: draft!.permissions })
    : post('/roles', { name: draft!.name, description: draft!.description || null, basedOn: draft!.basedOn, permissions: draft!.permissions })),
  { invalidate: ['/roles', '/users'], success: 'Role saved.', onSuccess: (r: any) => { refetch(); setDraft({ code: r.role.role, name: r.role.label, description: r.role.description ?? '', basedOn: r.role.basedOn, permissions: r.role.permissions, builtIn: false, users: r.role.users }); } });
  const rm = useAction(() => del(`/roles/${draft!.code}`), { invalidate: ['/roles', '/users'], success: 'Role deleted.', onSuccess: () => { setDraft(null); refetch(); } });
  if (isLoading || !data) return <PageLoader />;
  const fe = fieldErrors(save.error);
  const ro = !!draft?.builtIn;
  const sel = new Set(draft?.permissions ?? []);
  const setPerms = (perms: string[], on: boolean) => setDraft((d) => { if (!d) return d; const s = new Set(d.permissions); perms.forEach((p) => (on ? s.add(p) : s.delete(p))); return { ...d, permissions: all.filter((p) => s.has(p)) }; });
  const open = (r: any) => setDraft({ code: r.custom ? r.role : null, name: r.label, description: r.description ?? '', basedOn: r.basedOn, permissions: r.permissions, builtIn: !r.custom, users: r.users });
  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
      <Section title="Roles" padded={false} actions={<Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setDraft(blank())}>New role</Button>}>
        <ul className="divide-y divide-line">
          {data.roles.map((r: any) => (
            <li key={r.role}><button type="button" onClick={() => open(r)} className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-50 ${draft && (draft.code ?? '') === (r.custom ? r.role : '') && draft.builtIn === !r.custom && draft.name === r.label ? 'bg-brand-50' : ''}`}>
              <span className="min-w-0"><span className="block truncate text-sm font-semibold">{r.label}</span><span className="block text-xs text-slate-500">{r.permissions.length} permissions · {r.users} user{r.users === 1 ? '' : 's'}</span></span>
              {r.custom ? <Pill tone="blue" dot={false}>Custom</Pill> : <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-label="Built-in" />}
            </button></li>
          ))}
        </ul>
      </Section>
      {!draft ? (
        <Section title="Roles & permissions"><p className="text-sm text-slate-600">Pick a role to see what it can do, or press <b>New role</b> to build one. Tick permissions individually, by module, or all at once. Built-in roles are fixed — use <b>Duplicate</b> to start a custom role from one.</p></Section>
      ) : (
        <Section title={draft.code ? `Edit role — ${draft.name}` : ro ? `${draft.name} (built-in)` : 'New role'}
          actions={<div className="flex flex-wrap gap-2">
            {ro && <Button size="sm" icon={<Copy className="h-4 w-4" />} onClick={() => setDraft({ ...draft, code: null, builtIn: false, name: `${draft.name} copy`, users: 0 })}>Duplicate as new role</Button>}
            {draft.code && <Button size="sm" variant="danger" icon={<Trash2 className="h-4 w-4" />} loading={rm.isPending} disabled={draft.users > 0} title={draft.users ? 'Move its users to another role first' : undefined} onClick={() => { if (window.confirm(`Delete role “${draft.name}”?`)) rm.mutate(undefined as never); }}>Delete</Button>}
            {!ro && <Button size="sm" variant="primary" icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate(undefined as never)}>Save role</Button>}
          </div>}>
          <div className="space-y-5">
            {save.error && !save.error.fields && <Alert tone="danger">{save.error.message}</Alert>}
            {ro && <Alert tone="info">Built-in roles cannot be edited. Duplicate this role to create a custom one with the same permissions as a starting point.</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput label="Role name" required value={draft.name} disabled={ro} onChange={(e) => setDraft({ ...draft, name: e.target.value })} error={fe.name} placeholder="e.g. Billing clerk" />
              <SelectInput label="Works like (workflow behaviour)" value={draft.basedOn} disabled={ro} onChange={(e) => setDraft({ ...draft, basedOn: e.target.value })} options={data.baseOptions} error={fe.basedOn} />
              <div className="sm:col-span-2"><TextArea label="Description (optional)" value={draft.description} disabled={ro} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={250} /></div>
            </div>
            <p className="-mt-2 text-xs text-slate-500">“Works like” decides trip steps, approval routing, notifications and driver-style “own data only” scoping. What the role can open or change is decided by the checkboxes below.</p>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3">
              <Check label={`Select all (${sel.size} of ${all.length})`} checked={sel.size === all.length} indeterminate={sel.size > 0} disabled={ro} onChange={(v) => setPerms(all, v)} />
              {!ro && <Button size="sm" variant="ghost" onClick={() => setPerms(all, false)}>Clear all</Button>}
            </div>
            {fe.permissions && <p className="text-sm text-red-600">{fe.permissions}</p>}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.groups.map((g: any) => {
                const n = g.perms.filter((p: string) => sel.has(p)).length;
                return (
                  <fieldset key={g.module} className="rounded-xl border border-line p-3">
                    <legend className="px-1"><Check label={g.module} checked={n === g.perms.length} indeterminate={n > 0} disabled={ro} onChange={(v) => setPerms(g.perms, v)} /></legend>
                    <div className="mt-1 space-y-1.5 pl-6">{g.perms.map((p: string) => <Check key={p} label={permLabel(p)} hint={p} checked={sel.has(p)} disabled={ro} onChange={(v) => setPerms([p], v)} />)}</div>
                  </fieldset>
                );
              })}
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

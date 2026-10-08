import { Phone, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES } from '@gasman/shared';
import { patch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, titleCase } from '../lib/format';
import { fieldErrors, useAction, useList, useQueryState } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Feedback';
import { FilterSelect, SelectInput, TextArea } from '../ui/Form';
import { Modal } from '../ui/Overlay';
import { PageHeader, Section, Tabs } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';
import { IncidentModal } from '../features/forms';

export default function Safety() {
  const { can } = useAuth(); const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') ?? (can('safety:view') ? 'incidents' : 'incidents');
  const [report, setReport] = useState(false);
  return (
    <>
      <PageHeader title="Safety" subtitle="Inspections, incident reporting and emergency readiness" breadcrumbs={[{ label: 'Compliance & Safety' }, { label: 'Safety' }]} actions={can('safety:report') && <Button variant="danger" icon={<ShieldAlert className="h-4 w-4" />} onClick={() => setReport(true)}>Report incident</Button>} />
      <Tabs value={tab} onChange={(k) => setSp({ tab: k }, { replace: true })} tabs={[{ key: 'incidents', label: 'Incidents' }, ...(can('safety:view') ? [{ key: 'checks', label: 'Inspections & checklists' }] : []), { key: 'emergency', label: 'Emergency contacts' }]} />
      {tab === 'incidents' && <Incidents />}{tab === 'checks' && <Checks />}{tab === 'emergency' && <Emergency />}
      {report && <IncidentModal onClose={() => setReport(false)} />}
    </>
  );
}

function Incidents() {
  const { can } = useAuth(); const { state, set, clear, page } = useQueryState(); const [open, setOpen] = useState<any>(null);
  const { data, isLoading, error, refetch } = useList('/safety/incidents', { page, pageSize: 15, q: state.q, status: state.status, severity: state.severity });
  const cols: Column<any>[] = [
    { key: 'code', header: 'Incident', render: (i) => <div><p className="font-semibold text-brand-700">{i.code}</p><p className="text-xs text-slate-500">{fmtDateTime(i.reported_at)}</p></div> },
    { key: 'cat', header: 'Category', render: (i) => titleCase(i.category) },
    { key: 'sev', header: 'Severity', render: (i) => <StatusPill status={i.severity} /> },
    { key: 'ref', header: 'Trip / vehicle', hideBelow: 'md', render: (i) => <span>{i.trip_code ?? '—'}<span className="block text-xs text-slate-500">{i.vehicle_code} · {i.driver_name}</span></span> },
    { key: 'desc', header: 'Description', hideBelow: 'lg', render: (i) => <span className="line-clamp-2 max-w-sm text-sm text-slate-600">{i.description}</span> },
    { key: 'status', header: 'Status', render: (i) => <StatusPill status={i.status} /> },
  ];
  return (
    <>
      <FilterBar active={['q', 'status', 'severity'].some((k) => state[k])} onClear={() => clear(['tab'])}>
        <SearchInput className="w-full sm:w-72" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search incidents…" />
        <FilterSelect label="Status" value={state.status ?? 'ALL'} onChange={(v) => set({ status: v })} options={[{ value: 'ALL', label: 'All statuses' }, ...INCIDENT_STATUSES.map((s) => ({ value: s, label: titleCase(s) })), { value: 'OPEN,INVESTIGATING', label: 'Not closed' }]} />
        <FilterSelect label="Severity" value={state.severity ?? 'ALL'} onChange={(v) => set({ severity: v })} options={[{ value: 'ALL', label: 'Any severity' }, ...INCIDENT_SEVERITIES.map((s) => ({ value: s, label: titleCase(s) })), { value: 'HIGH,CRITICAL', label: 'High + critical' }]} />
      </FilterBar>
      <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(i) => i.id} onRowClick={setOpen} page={page} pageSize={15} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No incidents', description: 'Nothing has been reported with these filters.' }} />
      {open && <IncidentDetail inc={open} canManage={can('safety:manage')} onClose={() => { setOpen(null); refetch(); }} />}
    </>
  );
}

function IncidentDetail({ inc, canManage, onClose }: { inc: any; canManage: boolean; onClose: () => void }) {
  const [status, setStatus] = useState(inc.status); const [res, setRes] = useState(inc.resolution ?? '');
  const m = useAction(() => patch(`/safety/incidents/${inc.id}`, { status, resolution: res || undefined }), { invalidate: ['/safety'], success: 'Incident updated.', onSuccess: onClose });
  const fe = fieldErrors(m.error);
  return (
    <Modal open onClose={onClose} title={inc.code} description={`${titleCase(inc.category)} · reported ${fmtDateTime(inc.reported_at)}`} footer={canManage ? <><Button onClick={onClose}>Close</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Save</Button></> : <Button onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <div className="flex gap-2"><StatusPill status={inc.severity} /><StatusPill status={inc.status} /></div>
        <p className="text-sm leading-relaxed">{inc.description}</p>
        <p className="text-xs text-slate-500">{inc.trip_code && <>Trip <Link className="text-brand-700 underline" to={`/trips/${inc.trip_id}`}>{inc.trip_code}</Link> · </>}{inc.vehicle_code} · {inc.driver_name}</p>
        {canManage ? <>
          {m.error && !m.error.fields && <Alert tone="danger">{m.error.message}</Alert>}
          <SelectInput label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={INCIDENT_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))} />
          <TextArea label="Resolution / corrective action" value={res} onChange={(e) => setRes(e.target.value)} error={fe.resolution} maxLength={1000} />
        </> : inc.resolution && <div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="text-xs font-semibold text-slate-500">Resolution</p>{inc.resolution}</div>}
      </div>
    </Modal>
  );
}

function Checks() {
  const { state, set, page } = useQueryState();
  const { data, isLoading, error, refetch } = useList('/safety/checks', { page, pageSize: 15, q: state.q, result: state.result });
  const cols: Column<any>[] = [
    { key: 'when', header: 'Completed', render: (c) => <span className="tabular-nums">{fmtDateTime(c.completed_at)}</span> },
    { key: 'kind', header: 'Check', render: (c) => (c.kind === 'PRE_TRIP' ? 'Pre-trip' : 'Post-trip') },
    { key: 'v', header: 'Vehicle', render: (c) => c.vehicle_code }, { key: 'd', header: 'Driver', hideBelow: 'md', render: (c) => c.driver_name ?? '—' },
    { key: 't', header: 'Trip', hideBelow: 'md', render: (c) => (c.trip_id ? <Link className="text-brand-700 hover:underline" to={`/trips/${c.trip_id}?tab=safety`}>{c.trip_code}</Link> : '—') },
    { key: 'fail', header: 'Findings', hideBelow: 'lg', render: (c) => { const f = c.items.filter((i: any) => !i.ok); return f.length ? <span className="text-sm text-red-700">{f.map((i: any) => i.label).join(', ')}</span> : <span className="text-slate-400">All items OK</span>; } },
    { key: 'r', header: 'Result', render: (c) => <StatusPill status={c.result} /> },
  ];
  return (
    <>
      <FilterBar><SearchInput className="w-full sm:w-72" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search vehicle, trip, driver…" />
        <FilterSelect label="Result" value={state.result ?? 'ALL'} onChange={(v) => set({ result: v })} options={[{ value: 'ALL', label: 'Pass & fail' }, { value: 'PASS', label: 'Passed' }, { value: 'FAIL', label: 'Failed' }]} /></FilterBar>
      <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(c) => c.id} page={page} pageSize={15} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No checklists recorded' }} />
    </>
  );
}

function Emergency() {
  const rows = [['Plant emergency desk — Osakai', '051-555-0101'], ['Plant emergency desk — Dhurnal', '051-555-0102'], ['Transport control room (24/7)', '051-555-0103'], ['Rescue 1122 (national)', '1122'], ['Fire brigade', '16']];
  return (
    <Section title="Emergency contacts" subtitle="Placeholder numbers for the demo — replace with GasMan's official emergency directory">
      <ul className="divide-y divide-line">{rows.map(([n, p]) => <li key={n} className="flex items-center justify-between py-3 text-sm"><span>{n}</span><a href={`tel:${p}`} className="inline-flex items-center gap-2 font-semibold text-brand-700"><Phone className="h-4 w-4" />{p}</a></li>)}</ul>
    </Section>
  );
}

import { CheckCheck, Clock3, Inbox, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDuration, fmtPkr, timeAgo, titleCase } from '../lib/format';
import { fieldErrors, useAction, useList, useQueryState } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Feedback';
import { FilterSelect, TextArea } from '../ui/Form';
import { Modal } from '../ui/Overlay';
import { KpiCard, PageHeader, Tabs } from '../ui/Page';
import { Pill, StatusPill } from '../ui/Pill';
import { Column, DataTable, FilterBar } from '../ui/Table';

const ENTITY_LINK = (a: any): string | null => (a.entity_type === 'TRIP_EXPENSE' ? '/expenses' : a.entity_type === 'PURCHASE_REQUISITION' || a.entity_type === 'PURCHASE_ORDER' ? '/procurement' : a.entity_type === 'LEAVE' ? '/hr?tab=leave' : a.entity_type === 'PAYROLL' ? '/hr?tab=payroll' : null);
const ENTITY_LABEL: Record<string, string> = { TRIP_EXPENSE: 'Trip expense', PURCHASE_REQUISITION: 'Purchase requisition', PURCHASE_ORDER: 'Purchase order', LEAVE: 'Leave request', PAYROLL: 'Payroll run' };

export default function Approvals() {
  const { can, user } = useAuth(); const { state, set, page } = useQueryState(); const tab = state.tab ?? 'mine'; const [dlg, setDlg] = useState<{ a: any; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const params = { page, pageSize: 15, entityType: state.entityType, ...(tab === 'mine' ? { status: 'PENDING', mine: 'true' } : tab === 'pending' ? { status: 'PENDING' } : { status: 'APPROVED,REJECTED' }) };
  const { data, isLoading, error, refetch } = useList('/approvals', params, { refetchInterval: 20_000 });
  const st = data?.stats;
  const cols: Column<any>[] = [
    { key: 't', header: 'Request', render: (a) => <div><p className="font-semibold">{a.title}</p><p className="text-xs text-slate-500">{ENTITY_LABEL[a.entity_type] ?? titleCase(a.entity_type)}</p></div> },
    { key: 'amt', header: 'Amount', render: (a) => <span className="tabular-nums">{a.amount != null ? fmtPkr(a.amount) : '—'}</span> },
    { key: 'by', header: 'Requested by', hideBelow: 'md', render: (a) => <div><p>{a.requested_by_name ?? 'System'}</p><p className="text-xs text-slate-500">{timeAgo(a.requested_at)}</p></div> },
    { key: 'role', header: 'Approver', hideBelow: 'lg', render: (a) => <Pill tone="slate" dot={false}>{titleCase(a.approver_role)}</Pill> },
    { key: 's', header: 'Status', render: (a) => <div><StatusPill status={a.status} />{a.decided_by_name && <p className="mt-1 text-xs text-slate-500">{a.decided_by_name}{a.decision_note ? ` — ${a.decision_note}` : ''}</p>}</div> },
    { key: 'act', header: '', render: (a) => (
      <div className="flex justify-end gap-1.5">
        {ENTITY_LINK(a) && <Link to={ENTITY_LINK(a)!} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50">Open</Link>}
        {a.status === 'PENDING' && can('approvals:decide') && a.can_decide && <><Button size="sm" variant="success" onClick={() => setDlg({ a, decision: 'APPROVED' })}>Approve</Button><Button size="sm" onClick={() => setDlg({ a, decision: 'REJECTED' })}>Reject</Button></>}
      </div>) },
  ];
  return (
    <>
      <PageHeader title="Approval Center" subtitle="Review and decide transactions assigned to you" breadcrumbs={[{ label: 'Fuel & Expenses' }, { label: 'Approvals' }]} actions={can('approvals:configure') && <Link to="/settings?tab=rules" className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium hover:bg-slate-50">Workflow rules</Link>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Pending my approval" value={st?.pending_mine ?? '–'} tone={st?.pending_mine ? 'amber' : 'green'} icon={<Inbox className="h-5 w-5" />} to="/approvals" />
        <KpiCard label="Pending (all approvers)" value={st?.pending_all ?? '–'} hint={st ? fmtPkr(st.pending_amount) : ''} tone="slate" icon={<Clock3 className="h-5 w-5" />} to="/approvals?tab=pending" />
        <KpiCard label="Decided today" value={st?.decided_today ?? '–'} tone="green" icon={<CheckCheck className="h-5 w-5" />} to="/approvals?tab=history" />
        <KpiCard label="Average decision time" value={st ? fmtDuration(st.avg_decision_min) : '–'} hint="Last 30 days" icon={<ShieldCheck className="h-5 w-5" />} />
      </div>
      <Tabs value={tab} onChange={(k) => set({ tab: k === 'mine' ? undefined : k })} tabs={[{ key: 'mine', label: 'Assigned to me', count: st?.pending_mine }, { key: 'pending', label: 'All pending' }, { key: 'history', label: 'History' }]} />
      <FilterBar><FilterSelect label="Type" value={state.entityType ?? 'ALL'} onChange={(v) => set({ entityType: v })} options={[{ value: 'ALL', label: 'All request types' }, ...Object.entries(ENTITY_LABEL).map(([k, l]) => ({ value: k, label: l }))]} /></FilterBar>
      <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(a) => a.id} page={page} pageSize={15} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)}
        empty={{ title: tab === 'mine' ? 'You’re all caught up' : 'Nothing here', description: tab === 'mine' ? `No transactions are waiting for your approval${user ? ` (${titleCase(user.role)})` : ''}.` : undefined }} />
      {dlg && <DecideModal a={dlg.a} decision={dlg.decision} onClose={() => { setDlg(null); refetch(); }} />}
    </>
  );
}

function DecideModal({ a, decision, onClose }: { a: any; decision: 'APPROVED' | 'REJECTED'; onClose: () => void }) {
  const [note, setNote] = useState('');
  const m = useAction(() => post(`/approvals/${a.id}/decide`, { decision, note: note || undefined }), { invalidate: ['/approvals', '/expenses', '/trips', '/dashboard'], success: decision === 'APPROVED' ? 'Approved.' : 'Rejected.', onSuccess: onClose });
  const fe = fieldErrors(m.error);
  return (
    <Modal open onClose={onClose} size="sm" title={`${decision === 'APPROVED' ? 'Approve' : 'Reject'}: ${a.title}`} description={a.amount != null ? fmtPkr(a.amount) : undefined}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant={decision === 'APPROVED' ? 'success' : 'danger'} loading={m.isPending} onClick={() => m.mutate(undefined as never)}>{decision === 'APPROVED' ? 'Approve (F10)' : 'Reject'}</Button></>}>
      <div className="space-y-3">{m.error && !m.error.fields && <Alert tone="danger">{m.error.message}</Alert>}<TextArea label={decision === 'REJECTED' ? 'Reason (required)' : 'Comment (optional)'} value={note} onChange={(e) => setNote(e.target.value)} error={fe.note} maxLength={300} /></div>
    </Modal>
  );
}

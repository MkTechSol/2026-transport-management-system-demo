import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtPkr, timeAgo } from '../lib/format';
import { useAction } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert, ErrorState, PageLoader } from '../ui/Feedback';
import { TextInput } from '../ui/Form';
import { Modal } from '../ui/Overlay';

/** Phone-first home for managers: what needs a decision, what is late, and the numbers that matter — big touch targets, no tables. */
export default function ManagerHome() {
  const { user, can } = useAuth(); const [reject, setReject] = useState<any>(null); const [note, setNote] = useState('');
  const dash = useQuery({ queryKey: ['/dashboard', 'mobile'], queryFn: () => get('/dashboard'), refetchInterval: 30_000 });
  const appr = useQuery({ queryKey: ['/approvals', 'mobile'], queryFn: () => get('/approvals?status=PENDING&pageSize=8'), enabled: can('approvals:view'), refetchInterval: 30_000 });
  const exc = useQuery({ queryKey: ['/exceptions', 'mobile'], queryFn: () => get('/exceptions'), enabled: can('exceptions:view'), refetchInterval: 60_000 });
  const decide = useAction((v: { id: number; decision: string; note?: string }) => post(`/approvals/${v.id}/decide`, { decision: v.decision, note: v.note }), { invalidate: ['/approvals', '/expenses', '/dashboard', '/procurement', '/hr'], success: (_r: any) => 'Decision recorded.', onSuccess: () => { setReject(null); setNote(''); } });
  if (dash.isLoading) return <PageLoader />; if (dash.error || !dash.data) return <ErrorState error={dash.error} onRetry={() => dash.refetch()} />;
  const k = dash.data.kpis; const f = dash.data.finance;
  const tile = (label: string, value: any, to: string, tone = 'text-ink') => <Link to={to} className="card block p-4 active:bg-slate-50"><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p></Link>;
  const items: any[] = appr.data?.data ?? [];
  return (
    <div className="mx-auto max-w-lg space-y-5 pb-10">
      <div><p className="text-sm text-slate-500">Good day,</p><h1 className="text-xl font-bold">{user?.name}</h1></div>
      <div className="grid grid-cols-2 gap-3">
        {tile('Active trips', k.activeTrips, '/trips?scope=active')}{tile('Delayed', k.delayedTrips, '/trips?status=DELAYED', k.delayedTrips ? 'text-red-600' : 'text-ink')}{tile('Completed today', k.completedToday, '/trips?status=COMPLETED')}{tile('Vehicles available', k.availableVehicles, '/fleet')}
        {f && <>{tile('Trip profit (MTD)', fmtPkr(f.profitMtd), '/finance/reports/bowzer-pnl', f.profitMtd < 0 ? 'text-red-600' : 'text-green-700')}{tile('Overdue invoices', fmtPkr(f.treasury?.overdue ?? 0), '/sales/invoices?overdue=1', 'text-amber-700')}</>}
      </div>
      {can('approvals:view') && <section><div className="mb-2 flex items-center justify-between"><h2 className="text-base font-semibold">Waiting for your decision {items.length ? `(${appr.data?.meta?.total ?? items.length})` : ''}</h2><Link to="/approvals" className="text-sm font-medium text-brand-700">All</Link></div>
        {!items.length ? <Alert tone="success">Nothing is waiting for approval.</Alert> : <ul className="space-y-3">{items.map((a) => (
          <li key={a.id} className="card p-4"><p className="text-sm font-semibold">{a.title}</p><p className="mt-0.5 text-xs text-slate-500">{a.entity_type.replace(/_/g, ' ').toLowerCase()} · {timeAgo(a.requested_at)}{a.amount ? ` · ${fmtPkr(a.amount)}` : ''}</p>
            {(user?.role === 'SUPER_ADMIN' || user?.role === a.approver_role) ? <div className="mt-3 grid grid-cols-2 gap-3"><Button className="h-12 text-base" variant="primary" icon={<Check className="h-5 w-5" />} loading={decide.isPending && decide.variables?.id === a.id && decide.variables?.decision === 'APPROVED'} onClick={() => decide.mutate({ id: a.id, decision: 'APPROVED' })}>Approve</Button><Button className="h-12 text-base" variant="danger" icon={<X className="h-5 w-5" />} onClick={() => setReject(a)}>Reject</Button></div>
              : <p className="mt-2 text-xs text-slate-500">Needs {a.approver_role.replace(/_/g, ' ').toLowerCase()}.</p>}</li>))}</ul>}</section>}
      {can('exceptions:view') && exc.data && <section><div className="mb-2 flex items-center justify-between"><h2 className="text-base font-semibold">Needs attention</h2><Link to="/exceptions" className="text-sm font-medium text-brand-700">All {exc.data.total}</Link></div>
        <ul className="space-y-2">{exc.data.data.slice(0, 5).map((e: any) => <li key={e.key}><Link to={e.link} className="card block p-3 text-sm"><span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold ${e.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' : e.severity === 'WARNING' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{e.severity}</span>{e.title}</Link></li>)}</ul></section>}
      <div className="grid grid-cols-2 gap-3 text-center text-sm font-medium"><Link to="/tracking" className="card p-4">Live map</Link><Link to="/trips/new" className="card p-4">New trip</Link><Link to="/notifications" className="card p-4">Notifications</Link><Link to="/" className="card p-4">Full dashboard</Link></div>
      {reject && <Modal open onClose={() => setReject(null)} title="Reject request" description={reject.title} footer={<><Button onClick={() => setReject(null)}>Cancel</Button><Button variant="danger" loading={decide.isPending} disabled={!note.trim()} onClick={() => decide.mutate({ id: reject.id, decision: 'REJECTED', note })}>Reject</Button></>}><TextInput label="Reason" required value={note} onChange={(e) => setNote(e.target.value)} /></Modal>}
    </div>
  );
}

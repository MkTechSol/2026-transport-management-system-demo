import clsx from 'clsx';
import { AlertTriangle, CheckCheck, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { post } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useAction, useList, useQueryState } from '../lib/hooks';
import { Button } from '../ui/Button';
import { EmptyState, ErrorState, Skeleton } from '../ui/Feedback';
import { PageHeader, Tabs } from '../ui/Page';
import { Pagination } from '../ui/Table';

const ICON: Record<string, any> = { INFO: [Info, 'bg-blue-50 text-blue-600'], SUCCESS: [CheckCircle2, 'bg-green-50 text-green-600'], WARNING: [AlertTriangle, 'bg-amber-50 text-amber-600'], CRITICAL: [ShieldAlert, 'bg-red-50 text-red-600'] };
const LINK = (n: any) => (n.entity_type === 'TRIP' ? `/trips/${n.entity_id}` : n.entity_type === 'VEHICLE' ? `/fleet/${n.entity_id}` : n.entity_type === 'DRIVER' ? `/drivers/${n.entity_id}` : n.entity_type === 'INCIDENT' ? '/safety?tab=incidents' : null);

export default function Notifications() {
  const nav = useNavigate(); const { state, set, page } = useQueryState();
  const { data, isLoading, error, refetch } = useList('/notifications', { page, pageSize: 20, unread: state.unread }, { refetchInterval: 30_000 });
  const read = useAction((id: number) => post(`/notifications/${id}/read`), { invalidate: ['/notifications'] });
  const all = useAction(() => post('/notifications/read-all'), { invalidate: ['/notifications'], success: 'All notifications marked as read.' });
  return (
    <>
      <PageHeader title="Notification Center" subtitle="Alerts generated from trips, fleet compliance and safety events" breadcrumbs={[{ label: 'Insights' }, { label: 'Notifications' }]} actions={<Button icon={<CheckCheck className="h-4 w-4" />} loading={all.isPending} onClick={() => all.mutate(undefined as never)}>Mark all as read</Button>} />
      <Tabs value={state.unread ? 'unread' : 'all'} onChange={(k) => set({ unread: k === 'unread' ? 'true' : undefined })} tabs={[{ key: 'all', label: 'All' }, { key: 'unread', label: 'Unread' }]} />
      <div className="card overflow-hidden">
        {isLoading && <div className="space-y-3 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>}
        {error && <ErrorState error={error} onRetry={() => refetch()} />}
        <ul className="divide-y divide-line">
          {data?.data.map((n: any) => { const [I, c] = ICON[n.severity] ?? ICON.INFO; const to = LINK(n);
            return (
              <li key={n.id}><button onClick={() => { if (n.unread) read.mutate(n.id); if (to) nav(to); }} className={clsx('flex w-full items-start gap-4 px-5 py-4 text-left hover:bg-slate-50', n.unread && 'bg-brand-50/40')}>
                <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', c)}><I className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className={clsx('block text-sm', n.unread ? 'font-semibold' : 'font-medium')}>{n.title}</span>{n.body && <span className="mt-0.5 block text-sm text-slate-600">{n.body}</span>}</span>
                <span className="flex flex-col items-end gap-1"><span className="whitespace-nowrap text-xs text-slate-500">{timeAgo(n.created_at)}</span>{n.unread && <span className="h-2 w-2 rounded-full bg-brand-600" aria-label="Unread" />}</span>
              </button></li>); })}
        </ul>
        {data && !data.data.length && <EmptyState title={state.unread ? 'You’re all caught up' : 'No notifications yet'} description="New alerts will appear here as trips, documents and maintenance change." />}
        {data && <Pagination page={page} pageSize={20} total={data.meta.total} onPage={(p) => set({ page: p }, false)} />}
      </div>
    </>
  );
}

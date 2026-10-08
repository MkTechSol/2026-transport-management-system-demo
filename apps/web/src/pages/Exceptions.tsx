import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { get, post } from '../lib/api';
import { fieldErrors, useAction } from '../lib/hooks';
import { Button } from '../ui/Button';
import { EmptyState, ErrorState, PageLoader } from '../ui/Feedback';
import { TextInput } from '../ui/Form';
import { Modal } from '../ui/Overlay';
import { KpiCard, PageHeader } from '../ui/Page';

const ICON = { CRITICAL: ShieldAlert, WARNING: AlertTriangle, INFO: Info };
const TONE = { CRITICAL: 'border-red-200 bg-red-50 text-red-700', WARNING: 'border-amber-200 bg-amber-50 text-amber-700', INFO: 'border-blue-200 bg-blue-50 text-blue-700' };

export default function Exceptions() {
  const [sp, setSp] = useSearchParams(); const sev = sp.get('severity') ?? ''; const cat = sp.get('category') ?? ''; const showAcked = sp.get('acked') === '1';
  const [ack, setAck] = useState<any>(null); const [note, setNote] = useState('');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/exceptions', showAcked], queryFn: () => get(`/exceptions${showAcked ? '?acked=1' : ''}`), refetchInterval: 60_000 });
  const m = useAction(() => post('/exceptions/ack', { key: ack.key, note: note || undefined }), { invalidate: ['/exceptions'], success: 'Marked as reviewed.', onSuccess: () => { setAck(null); setNote(''); } });
  const setP = (o: Record<string, string>) => setSp((cur) => { const n = new URLSearchParams(cur); for (const [k, v] of Object.entries(o)) v ? n.set(k, v) : n.delete(k); return n; }, { replace: true });
  const items: any[] = (data?.data ?? []).filter((e: any) => (!sev || e.severity === sev) && (!cat || e.category === cat));
  const cats = Object.keys(data?.byCategory ?? {});
  return <>
    <PageHeader title="Exceptions Center" subtitle="Everything that needs a human look — computed live from trips, fleet, fuel, finance, stock and compliance" breadcrumbs={[{ label: 'Insights' }, { label: 'Exceptions' }]} />
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard label="Critical" value={data?.counts.CRITICAL ?? '–'} tone="red" to="/exceptions?severity=CRITICAL" /><KpiCard label="Warnings" value={data?.counts.WARNING ?? '–'} tone="amber" to="/exceptions?severity=WARNING" /><KpiCard label="Information" value={data?.counts.INFO ?? '–'} tone="blue" to="/exceptions?severity=INFO" /><KpiCard label="Open in total" value={data?.total ?? '–'} tone="slate" to="/exceptions" /></div>
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm"><span className="text-slate-500">Area:</span>
      <button className={clsx('rounded-full border px-3 py-1', !cat ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-line bg-white')} onClick={() => setP({ category: '' })}>All</button>
      {cats.map((c) => <button key={c} className={clsx('rounded-full border px-3 py-1', cat === c ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-line bg-white')} onClick={() => setP({ category: c })}>{c} ({data.byCategory[c]})</button>)}
      <label className="ml-auto flex items-center gap-2"><input type="checkbox" checked={showAcked} onChange={(e) => setP({ acked: e.target.checked ? '1' : '' })} />Show reviewed</label></div>
    {isLoading ? <PageLoader /> : error || !data ? <ErrorState error={error} onRetry={() => refetch()} /> : !items.length ? <EmptyState title="Nothing needs attention" description="Every rule you have access to is clear right now." icon={<CheckCircle2 className="h-8 w-8 text-green-600" />} /> : (
      <ul className="space-y-2">{items.map((e) => { const Icon = ICON[e.severity as keyof typeof ICON]; return (
        <li key={e.key} className={clsx('flex items-start gap-3 rounded-xl border bg-white p-3 shadow-sm', e.acked && 'opacity-60')}>
          <span className={clsx('mt-0.5 rounded-lg border p-1.5', TONE[e.severity as keyof typeof TONE])}><Icon className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-ink">{e.title}</p><p className="text-sm text-slate-600">{e.detail}</p><p className="mt-0.5 text-xs text-slate-400">{e.category}{e.acked ? ` · reviewed by ${e.acked.by ?? 'someone'}${e.acked.note ? `: ${e.acked.note}` : ''}` : ''}</p></div>
          <div className="flex shrink-0 gap-2"><Link to={e.link} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:bg-slate-50">Open</Link>{!e.acked && <Button size="sm" onClick={() => setAck(e)}>Mark reviewed</Button>}</div>
        </li>); })}</ul>)}
    {ack && <Modal open onClose={() => setAck(null)} title="Mark as reviewed" description={ack.title} footer={<><Button onClick={() => setAck(null)}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Mark reviewed (F10)</Button></>}>
      <TextInput label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Renewal paid, document arrives Monday" error={fieldErrors(m.error).note} /><p className="mt-2 text-xs text-slate-500">Reviewed items stay hidden until you tick “Show reviewed”. The underlying condition is not changed.</p></Modal>}
  </>;
}

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, titleCase } from '../lib/format';
import { fieldErrors, useAction, useList, useQueryState } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert, ErrorState, PageLoader } from '../ui/Feedback';
import { FilterSelect, SelectInput, TextInput } from '../ui/Form';
import { Drawer, Modal } from '../ui/Overlay';
import { KV, KVGrid, KpiCard, PageHeader, Section, Tabs } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';
import { useVehicleOptions } from '../features/common';
import { today } from '../features/finance';

function FitModal({ vehicleId, position, onClose }: { vehicleId: number; position: string; onClose: () => void }) {
  const stock = useQuery({ queryKey: ['/tyres', 'available'], queryFn: () => get('/tyres?status=IN_STORE,RETREAD&pageSize=100') });
  const [f, setF] = useState({ serialNo: '', disposition: 'RETREAD', reason: '', date: today() });
  const m = useAction(() => post('/tyres/fit', { serialNo: f.serialNo, vehicleId, position, removeDisposition: f.disposition, reason: f.reason || undefined, date: f.date }), { invalidate: ['/tyres', '/inventory', '/finance'], success: (r: any) => `Tyre fitted — voucher ${r.doc.doc_no}.`, onSuccess: onClose }); const fe = fieldErrors(m.error);
  return <Modal open onClose={onClose} title={`Fit tyre at ${position}`} description="Creates a Parts replacement voucher; any tyre already on this position is removed" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.serialNo} loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Fit tyre (F10)</Button></>}>
    <div className="grid gap-4">{m.error && !m.error.fields && <Alert tone="danger">{m.error.message}</Alert>}
      <SelectInput label="Tyre from store" required value={f.serialNo} onChange={(e) => setF({ ...f, serialNo: e.target.value })} placeholder="Select serial" error={fe.serialNo} options={(stock.data?.data ?? []).map((t: any) => ({ value: t.serial_no, label: `${t.serial_no} · ${t.item_name} · ${t.warehouse_name ?? ''}${t.status === 'RETREAD' ? ' (retread)' : ''}` }))} />
      <TextInput label="Date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
      <SelectInput label="If a tyre is already on this wheel" value={f.disposition} onChange={(e) => setF({ ...f, disposition: e.target.value })} options={[{ value: 'RETREAD', label: 'Send the old tyre for retreading' }, { value: 'RETURN', label: 'Return it to store' }, { value: 'SCRAP', label: 'Scrap it' }]} />
      <TextInput label="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Worn to limit" /></div></Modal>;
}

function WheelMap() {
  const { can } = useAuth(); const veh = useVehicleOptions(); const [sp, setSp] = useSearchParams(); const vid = sp.get('vehicle') ?? ''; const [fit, setFit] = useState<string | null>(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/tyres/vehicle', vid], queryFn: () => get(`/tyres/vehicle/${vid}`), enabled: !!vid });
  return <div>
    <div className="mb-4 w-64"><SelectInput label="Bowzer" value={vid} onChange={(e) => setSp({ tab: 'map', vehicle: e.target.value })} placeholder="Select a bowzer" options={(veh.data?.data ?? []).map((v: any) => ({ value: v.id, label: v.code }))} /></div>
    {!vid ? <p className="rounded-xl border border-dashed border-line bg-white p-10 text-center text-sm text-slate-500">Choose a bowzer to see every wheel position and the tyre on it.</p> : isLoading ? <PageLoader /> : error || !data ? <ErrorState error={error} onRetry={() => refetch()} /> : <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{data.positions.map((p: string) => { const t = data.fitted.find((x: any) => x.position === p); return (
        <button key={p} disabled={!can('tyres:manage')} onClick={() => setFit(p)} className={clsx('rounded-xl border p-3 text-left transition', t ? 'border-line bg-white hover:border-brand-400' : 'border-dashed border-amber-400 bg-amber-50 hover:bg-amber-100')}>
          <p className="text-xs font-semibold text-slate-500">{p}</p>{t ? <><p className="mt-0.5 font-semibold">{t.serial_no}</p><p className="text-xs text-slate-500">{t.size ?? t.item_name}</p><p className={clsx('mt-1 text-sm tabular-nums', t.km_total > 90000 ? 'font-semibold text-red-600' : t.km_total > 60000 ? 'text-amber-700' : 'text-slate-700')}>{Number(t.km_total).toLocaleString('en-US')} km</p>{t.retread_count > 0 && <p className="text-xs text-slate-500">{t.retread_count}× retreaded</p>}</> : <p className="mt-1 text-sm font-medium text-amber-800">Empty — fit a tyre</p>}</button>); })}</div>
      <Section className="mt-5" title="Tyre history" padded={false}><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Date</th><th className="th">Event</th><th className="th">Position</th><th className="th">Tyre</th><th className="th text-right">Odometer</th><th className="th">Note</th></tr></thead>
        <tbody className="divide-y divide-line">{data.history.map((h: any, i: number) => <tr key={i}><td className="td whitespace-nowrap">{fmtDate(h.event_date)}</td><td className="td">{titleCase(h.event_type)}</td><td className="td">{h.position}</td><td className="td">{h.serial_no}</td><td className="td text-right tabular-nums">{h.odometer?.toLocaleString('en-US')}</td><td className="td text-slate-600">{h.note}</td></tr>)}{!data.history.length && <tr><td colSpan={6} className="td py-6 text-center text-slate-500">No changes recorded yet.</td></tr>}</tbody></table></Section></>}
    {fit && vid && <FitModal vehicleId={Number(vid)} position={fit} onClose={() => { setFit(null); refetch(); }} />}
  </div>;
}

function TyreDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/tyres', id], queryFn: () => get(`/tyres/${id}`) }); const t = data?.tyre;
  return <Drawer open onClose={onClose} width="max-w-xl" title={t ? t.serial_no : 'Tyre'} description={t?.item_name}>
    {isLoading ? <PageLoader /> : error || !t ? <ErrorState error={error} onRetry={() => refetch()} /> : <div className="space-y-5">
      <KVGrid cols={3}><KV label="Status"><StatusPill status={t.status} /></KV><KV label="Size">{t.size ?? '—'}</KV><KV label="Cost">PKR {Number(t.cost).toLocaleString('en-US')}</KV><KV label="Location">{t.vehicle_code ? `${t.vehicle_code} @ ${t.position}` : t.warehouse_name ?? '—'}</KV><KV label="Distance run">{Number(t.km_run).toLocaleString('en-US')} km</KV><KV label="Retreads">{t.retread_count}</KV></KVGrid>
      <ol className="space-y-2 border-l-2 border-line pl-4 text-sm">{data.events.map((e: any) => <li key={e.id}><p className="font-medium">{titleCase(e.event_type)} {e.vehicle_code && `· ${e.vehicle_code}`} {e.position && `@ ${e.position}`}</p><p className="text-xs text-slate-500">{fmtDate(e.event_date)}{e.odometer ? ` · ${Number(e.odometer).toLocaleString('en-US')} km` : ''} {e.note}</p></li>)}</ol></div>}
  </Drawer>;
}

export default function Tyres() {
  const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') ?? 'register'; const { state, set, clear, page } = useQueryState(); const [open, setOpen] = useState<number | null>(null);
  const { data, isLoading, error, refetch } = useList('/tyres', { page, pageSize: 15, q: state.q, status: state.status }, { enabled: tab === 'register' });
  const s = data?.stats;
  const cols: Column<any>[] = [
    { key: 'sn', header: 'Serial', render: (t) => <span className="font-semibold text-brand-700">{t.serial_no}</span> }, { key: 'item', header: 'Tyre', hideBelow: 'md', render: (t) => t.item_name },
    { key: 'loc', header: 'Location', render: (t) => (t.vehicle_code ? `${t.vehicle_code} @ ${t.position}` : t.warehouse_name ?? '—') }, { key: 'km', header: 'Distance run', render: (t) => <span className="tabular-nums">{Number(t.km_total).toLocaleString('en-US')} km</span> },
    { key: 'rt', header: 'Retreads', hideBelow: 'lg', render: (t) => t.retread_count }, { key: 'fit', header: 'Fitted on', hideBelow: 'lg', render: (t) => fmtDate(t.fitted_on) }, { key: 'st', header: 'Status', render: (t) => <StatusPill status={t.status} /> },
  ];
  return <>
    <PageHeader title="Tyres" subtitle="Serial-tracked register, wheel map per bowzer and full fitment history" breadcrumbs={[{ label: 'Inventory' }, { label: 'Tyres' }]} />
    <Tabs value={tab} onChange={(k) => setSp({ tab: k })} tabs={[{ key: 'register', label: 'Register' }, { key: 'map', label: 'Bowzer wheel map' }]} />
    <div className="mt-4">{tab === 'map' ? <WheelMap /> : <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4"><KpiCard label="Fitted" value={s?.fitted ?? '–'} tone="blue" /><KpiCard label="In store" value={s?.in_store ?? '–'} tone="green" /><KpiCard label="Out for retread" value={s?.retread ?? '–'} tone="amber" /><KpiCard label="Scrapped" value={s?.scrapped ?? '–'} tone="slate" /></div>
      <FilterBar active={!!state.q || !!state.status} onClear={() => clear()}><SearchInput className="w-full sm:w-64" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search serial, bowzer…" />
        <FilterSelect label="Status" value={state.status ?? 'ALL'} onChange={(v) => set({ status: v })} options={[{ value: 'ALL', label: 'All' }, { value: 'FITTED', label: 'Fitted' }, { value: 'IN_STORE', label: 'In store' }, { value: 'RETREAD', label: 'Retread' }, { value: 'SCRAPPED', label: 'Scrapped' }]} /></FilterBar>
      <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(t) => t.id} onRowClick={(t) => setOpen(t.id)} page={page} pageSize={15} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No tyres match' }} /></>}</div>
    {open != null && <TyreDrawer id={open} onClose={() => setOpen(null)} />}
  </>;
}

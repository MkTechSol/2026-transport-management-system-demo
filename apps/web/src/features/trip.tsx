import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Truck, UserRound } from 'lucide-react';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { TRIP_STATUS_LABELS, TripStatus } from '@gasman/shared';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fieldErrors, useAction } from '../lib/hooks';
import { fmtMt, titleCase } from '../lib/format';
import { Button } from '../ui/Button';
import { Alert, PageLoader } from '../ui/Feedback';
import { TextArea, TextInput } from '../ui/Form';
import { Drawer, Modal } from '../ui/Overlay';
import { Pill, StatusPill } from '../ui/Pill';
import { useQuery } from '@tanstack/react-query';

export const TRIP_INVALIDATE = ['/trips', '/vehicles', '/drivers', '/tracking', '/me', '/maintenance', '/safety'];

export interface TripLike { id: number; code: string; status: TripStatus; planned_load_mt: number | string; loaded_mt?: number | string | null; vehicle_id?: number | null; driver_id?: number | null; vehicle_code?: string | null; vehicle_odometer_km?: number | null; odometer_start?: number | null; trip_type?: string }

/* ---------------------------------------------------------------- Assignment drawer */
export function AssignDrawer({ trip, open, onClose, onDone }: { trip: TripLike; open: boolean; onClose: () => void; onDone?: () => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['/trips', trip.id, 'candidates'], queryFn: () => get(`/trips/${trip.id}/candidates`), enabled: open, staleTime: 0 });
  const [vid, setVid] = useState<number | null>(null); const [did, setDid] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const best = useMemo(() => data?.vehicles.find((v: any) => v.eligible), [data]);
  useEffect(() => { if (data && vid === null) { setVid(trip.vehicle_id ?? best?.id ?? null); } }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!data) return;
    if (did === null) { const cur = trip.driver_id && data.drivers.find((d: any) => d.id === trip.driver_id && d.eligible); const dflt = vid ? data.vehicles.find((v: any) => v.id === vid)?.defaultDriverId : null;
      const pick = cur ? trip.driver_id : data.drivers.find((d: any) => d.id === dflt && d.eligible)?.id ?? data.drivers.find((d: any) => d.eligible)?.id ?? null; setDid(pick ?? null); }
  }, [data, vid]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useAction(() => post(`/trips/${trip.id}/assign`, { vehicleId: vid, driverId: did }), { invalidate: TRIP_INVALIDATE, success: 'Vehicle and driver assigned.', onSuccess: () => { onClose(); onDone?.(); } });
  const vSel = data?.vehicles.find((v: any) => v.id === vid); const dSel = data?.drivers.find((d: any) => d.id === did);
  const bad = [...(vSel?.violations ?? []), ...(dSel?.violations ?? [])];
  const list = (rows: any[]) => (showAll ? rows : rows.filter((r) => r.eligible));
  return (
    <Drawer open={open} onClose={onClose} width="max-w-2xl" title="Assign vehicle & driver" description={`${trip.code} · planned load ${fmtMt(trip.planned_load_mt)}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!vid || !did || bad.length > 0} onClick={() => m.mutate(undefined as never)}>Confirm assignment</Button></>}>
      {isLoading && <PageLoader label="Checking availability, documents and capacity…" />}
      {error && <Alert tone="danger">{(error as Error).message}</Alert>}
      {data && (
        <div className="space-y-5">
          {best ? <Alert tone="success" title={`${best.code} is the best fit`}>{best.why.join(' · ')}</Alert> : <Alert tone="warning" title="No fully compliant vehicle found">Review the reasons below, renew documents or change the trip schedule.</Alert>}
          {m.error && <Alert tone="danger" title="Cannot assign">{m.error.message}</Alert>}
          <Choice title="Vehicle" icon={<Truck className="h-4 w-4" />} rows={list(data.vehicles)} selected={vid} onSelect={(id) => { setVid(id); setDid(null); }}
            render={(v: any) => <><span className="font-medium">{v.code}</span><span className="text-xs text-slate-500">{v.registrationNo} · {v.capacityMt} MT · {v.fleetType === 'HIRED' ? 'Hired' : 'Owned'}{v.lastLocation ? ` · at ${v.lastLocation}` : ''}</span></>} />
          <Choice title="Driver" icon={<UserRound className="h-4 w-4" />} rows={list(data.drivers)} selected={did} onSelect={setDid}
            render={(d: any) => <><span className="font-medium">{d.name}</span><span className="text-xs text-slate-500">{d.employeeId} · {d.experienceYears} yrs · safety {d.safetyScore}</span></>} />
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Also show unavailable / non-compliant options (with reasons)</label>
          {bad.length > 0 && <Alert tone="danger" title="This selection violates assignment rules">{bad.map((b: string) => <p key={b}>• {b}</p>)}</Alert>}
        </div>
      )}
    </Drawer>
  );
}

function Choice({ title, icon, rows, selected, onSelect, render }: { title: string; icon: ReactNode; rows: any[]; selected: number | null; onSelect: (id: number) => void; render: (r: any) => ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">{icon}{title}<span className="text-xs font-normal text-slate-500">({rows.length} option{rows.length === 1 ? '' : 's'})</span></h3>
      <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1" role="radiogroup" aria-label={title}>
        {rows.map((r, i) => (
          <label key={r.id} className={clsx('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5', selected === r.id ? 'border-brand-600 bg-brand-50' : 'border-line hover:bg-slate-50', !r.eligible && 'opacity-80')}>
            <input type="radio" name={title} className="mt-1" checked={selected === r.id} onChange={() => onSelect(r.id)} />
            <span className="flex min-w-0 flex-1 flex-col">{render(r)}
              {!r.eligible && <span className="mt-1 text-xs text-red-600">{r.violations[0]}{r.violations.length > 1 ? ` (+${r.violations.length - 1} more)` : ''}</span>}
            </span>
            <span className="flex flex-col items-end gap-1">{r.eligible ? (i === 0 ? <Pill tone="green">Recommended</Pill> : <Pill tone="blue" dot={false}>Eligible</Pill>) : <Pill tone="red">Not eligible</Pill>}<StatusPill status={r.status} /></span>
          </label>
        ))}
        {!rows.length && <p className="py-4 text-center text-sm text-slate-500">No eligible options.</p>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Safety check */
export const PRETRIP = [
  ['tank_valves', 'Tank valves & fittings leak-free'], ['relief_valve', 'Safety relief valve tagged & in date'], ['gauges', 'Pressure / level gauges working'], ['earthing', 'Earthing strap & static bonding intact'],
  ['fire_ext', 'Fire extinguishers (2x) charged'], ['brakes_tyres', 'Brakes, lights & tyres inspected'], ['placards', 'Hazard placards & emergency card on board'], ['ppe', 'Driver PPE and emergency contacts available'],
] as const;

export function SafetyCheckModal({ trip, open, onClose, kind = 'PRE_TRIP' }: { trip: TripLike; open: boolean; onClose: () => void; kind?: 'PRE_TRIP' | 'POST_TRIP' }) {
  const [ok, setOk] = useState<Record<string, boolean>>(() => Object.fromEntries(PRETRIP.map(([k]) => [k, true])));
  const [notes, setNotes] = useState('');
  useEffect(() => { if (open) { setOk(Object.fromEntries(PRETRIP.map(([k]) => [k, true]))); setNotes(''); } }, [open]);
  const failing = PRETRIP.filter(([k]) => !ok[k]);
  const m = useAction(() => post(`/trips/${trip.id}/safety-checks`, { kind, items: PRETRIP.map(([key, label]) => ({ key, label, ok: ok[key] })), notes: notes || undefined }),
    { invalidate: TRIP_INVALIDATE, success: failing.length ? 'Check recorded as FAILED — the trip cannot start until a passing check is recorded.' : 'Pre-trip safety check passed.', onSuccess: onClose });
  return (
    <Modal open={open} onClose={onClose} size="md" title={kind === 'PRE_TRIP' ? 'Pre-trip safety checklist' : 'Post-trip checklist'} description={`${trip.code} · ${trip.vehicle_code ?? ''}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant={failing.length ? 'danger' : 'success'} loading={m.isPending} onClick={() => m.mutate(undefined as never)}>{failing.length ? 'Record failed check' : 'Confirm all checks passed'}</Button></>}>
      <div className="space-y-3">
        {m.error && <Alert tone="danger">{m.error.message}</Alert>}
        <p className="text-sm text-slate-600">Tick each item that has been physically verified. Mark anything that fails — the trip will be blocked until it is fixed and re-checked.</p>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {PRETRIP.map(([k, label]) => (
            <li key={k} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="text-sm">{label}</span>
              <span className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-xs font-medium">
                <button type="button" onClick={() => setOk((s) => ({ ...s, [k]: true }))} className={clsx('px-3 py-1.5', ok[k] ? 'bg-green-600 text-white' : 'bg-white text-slate-600')} aria-pressed={ok[k]}>OK</button>
                <button type="button" onClick={() => setOk((s) => ({ ...s, [k]: false }))} className={clsx('px-3 py-1.5', !ok[k] ? 'bg-red-600 text-white' : 'bg-white text-slate-600')} aria-pressed={!ok[k]}>Fail</button>
              </span>
            </li>
          ))}
        </ul>
        <TextArea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={400} />
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Transition dialogs + action bar */
const PRIMARY: Record<string, 'primary' | 'success' | 'danger' | 'secondary'> = { DISPATCHED: 'primary', IN_TRANSIT: 'primary', ARRIVED: 'primary', DELIVERED: 'success', COMPLETED: 'success', CANCELLED: 'danger', ON_HOLD: 'secondary' };

export function TripActionBar({ trip, actions, hasPassedPretrip, onChanged, size = 'md', showAssign = true, autoAssign = false }: { trip: TripLike; actions: { to: TripStatus; label: string }[]; hasPassedPretrip?: boolean; onChanged?: () => void; size?: 'sm' | 'md'; showAssign?: boolean; autoAssign?: boolean }) {
  const { can } = useAuth();
  const [dlg, setDlg] = useState<{ to: TripStatus; label: string } | null>(null); const [assign, setAssign] = useState(autoAssign && can('trips:assign')); const [check, setCheck] = useState(false);
  const canAssign = can('trips:assign') && ['DRAFT', 'PLANNED', 'ASSIGNED'].includes(trip.status);
  const canCheck = can('safety:report') && trip.vehicle_id && ['ASSIGNED', 'DISPATCHED'].includes(trip.status);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {showAssign && canAssign && <Button size={size} variant={trip.status === 'ASSIGNED' ? 'secondary' : 'primary'} icon={<Truck className="h-4 w-4" />} onClick={() => setAssign(true)}>{trip.status === 'ASSIGNED' ? 'Change assignment' : 'Assign vehicle & driver'}</Button>}
      {canCheck && <Button size={size} icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => setCheck(true)}>Pre-trip check</Button>}
      {actions.map((a) => <Button key={a.to + a.label} size={size} variant={a.label === 'Resume' ? 'primary' : PRIMARY[a.to] ?? 'secondary'} onClick={() => setDlg(a)}>{a.label}</Button>)}
      {canAssign && <AssignDrawer trip={trip} open={assign} onClose={() => setAssign(false)} onDone={onChanged} />}
      <SafetyCheckModal trip={trip} open={check} onClose={() => { setCheck(false); onChanged?.(); }} />
      {dlg && <TransitionDialog trip={trip} action={dlg} hasPassedPretrip={hasPassedPretrip} onClose={() => setDlg(null)} onDone={() => { setDlg(null); onChanged?.(); }} onCheck={() => { setDlg(null); setCheck(true); }} />}
    </div>
  );
}

function TransitionDialog({ trip, action, hasPassedPretrip, onClose, onDone, onCheck }: { trip: TripLike; action: { to: TripStatus; label: string }; hasPassedPretrip?: boolean; onClose: () => void; onDone: () => void; onCheck: () => void }) {
  const to = action.to;
  const needsReason = to === 'ON_HOLD' || to === 'CANCELLED';
  const starting = to === 'IN_TRANSIT' && trip.status === 'DISPATCHED';
  const delivering = to === 'DELIVERED';
  const [f, setF] = useState({ reason: '', loadedMt: String(trip.planned_load_mt), deliveredMt: String(trip.loaded_mt ?? trip.planned_load_mt), receivedBy: '', deliveryNoteNo: '', podNotes: '', note: '', odometer: String(starting ? (trip.vehicle_odometer_km ?? '') : ''), upliftVoucherNo: '' });
  const completing = to === 'COMPLETED';
  const set = (k: string) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  const m = useAction(() => post(`/trips/${trip.id}/transition`, {
    to, reason: f.reason || undefined, note: f.note || undefined,
    ...(starting ? { loadedMt: Number(f.loadedMt), odometerKm: f.odometer ? Number(f.odometer) : undefined, upliftVoucherNo: f.upliftVoucherNo || undefined } : {}), ...(completing && f.odometer ? { odometerKm: Number(f.odometer) } : {}), ...(delivering ? { deliveredMt: Number(f.deliveredMt), receivedBy: f.receivedBy, deliveryNoteNo: f.deliveryNoteNo || undefined, podNotes: f.podNotes || undefined } : {}),
  }), { invalidate: TRIP_INVALIDATE, success: () => `${trip.code}: ${TRIP_STATUS_LABELS[to] ?? titleCase(to)}`, onSuccess: onDone });
  const fe = fieldErrors(m.error);
  const danger = to === 'CANCELLED';
  const copy: Partial<Record<TripStatus, string>> = {
    DISPATCHED: 'This releases the trip to the yard. The assigned vehicle and driver will be marked On Trip and the driver is notified.',
    PLANNED: trip.status === 'ASSIGNED' ? 'The vehicle and driver will be released and the trip returns to Planned.' : 'Confirm the plan so it appears in dispatch.',
    ARRIVED: 'Confirm the vehicle has reached the destination.', RETURNING: 'Confirm the vehicle has left the customer site and is returning to the plant.',
    COMPLETED: 'Closing the trip releases the vehicle and driver and records the return to the plant.', DELAYED: 'Flag this trip as delayed so managers are alerted.', IN_TRANSIT: starting ? '' : 'Resume the trip.',
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`${action.label} — ${trip.code}`}
      footer={<><Button onClick={onClose} disabled={m.isPending}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} loading={m.isPending} disabled={(needsReason && !f.reason.trim()) || (delivering && (!f.deliveredMt || !f.receivedBy.trim()))} onClick={() => m.mutate(undefined as never)}>{action.label}</Button></>}>
      <div className="space-y-3">
        {m.error && <Alert tone="danger" title="Action not allowed">{m.error.message}
          {(m.error as any).code === 'RULE_VIOLATION' && /pre-trip/i.test(m.error.message) && <div className="mt-2"><Button size="sm" variant="primary" onClick={onCheck}>Record pre-trip check</Button></div>}</Alert>}
        {copy[to] && <p className="text-sm text-slate-600">{copy[to]}</p>}
        {starting && hasPassedPretrip === false && <Alert tone="warning" title="Pre-trip safety check required">A passed pre-trip safety check must be recorded before departure. <button className="font-semibold underline" onClick={onCheck}>Record it now</button></Alert>}
        {starting && hasPassedPretrip && <Alert tone="success"><span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" />Pre-trip safety check passed.</span></Alert>}
        {starting && <>
          <div className="grid grid-cols-2 gap-3">
            <TextInput label={trip.trip_type === 'UPLIFTING' ? 'Quantity uplifted (MT)' : 'Quantity loaded (MT)'} type="number" step="0.01" min="0" value={f.loadedMt} onChange={set('loadedMt')} error={fe.loadedMt} hint={`Planned ${fmtMt(trip.planned_load_mt)}`} />
            <TextInput label="Meter reading at start (km)" type="number" min="0" value={f.odometer} onChange={set('odometer')} error={fe.odometerKm} />
          </div>
          <TextInput label={trip.trip_type === 'UPLIFTING' ? 'Uplifting voucher no.' : 'Loading / delivery order no.'} value={f.upliftVoucherNo} onChange={set('upliftVoucherNo')} hint="Source document number from the loading point" />
        </>}
        {completing && <TextInput label="Meter reading at completion (km)" type="number" min="0" value={f.odometer} onChange={set('odometer')} error={fe.odometerKm} hint={trip.odometer_start ? `Start reading was ${trip.odometer_start} km; leave blank to estimate from the route` : 'Leave blank to estimate from the route'} />}
        {needsReason && <TextArea label={to === 'CANCELLED' ? 'Reason for cancellation' : 'Reason for hold'} required value={f.reason} onChange={set('reason')} error={fe.reason} maxLength={250} />}
        {delivering && <>
          <div className="grid grid-cols-2 gap-3"><TextInput label="Delivered quantity (MT)" required type="number" step="0.01" min="0" value={f.deliveredMt} onChange={set('deliveredMt')} error={fe.deliveredMt} hint={`Loaded ${fmtMt(trip.loaded_mt ?? trip.planned_load_mt)}`} />
            <TextInput label="Delivery note no." value={f.deliveryNoteNo} onChange={set('deliveryNoteNo')} /></div>
          <TextInput label="Received by (name)" required value={f.receivedBy} onChange={set('receivedBy')} error={fe.receivedBy} />
          <TextArea label="Proof-of-delivery notes" value={f.podNotes} onChange={set('podNotes')} maxLength={500} />
        </>}
        {!needsReason && !delivering && !starting && !completing && <TextInput label="Note (optional)" value={f.note} onChange={set('note')} maxLength={200} />}
        {danger && <p className="flex items-center gap-2 text-xs text-slate-500"><AlertTriangle className="h-3.5 w-3.5" />Cancelled trips cannot be reopened.</p>}
      </div>
    </Modal>
  );
}

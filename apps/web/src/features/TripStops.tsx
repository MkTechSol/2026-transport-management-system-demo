import clsx from 'clsx';
import { CheckCircle2, CircleDashed, MapPin, SkipForward, Truck } from 'lucide-react';
import { useState } from 'react';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fieldErrors, useAction } from '../lib/hooks';
import { fmtMt, fmtPkr, fmtShortDateTime } from '../lib/format';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Feedback';
import { Modal } from '../ui/Overlay';
import { TextArea, TextInput } from '../ui/Form';
import { Pill } from '../ui/Pill';
import { TRIP_INVALIDATE } from './trip';

export interface TripStop {
  id: number; seq: number; location_name: string; location_city?: string; distributor_name?: string | null; planned_mt: number | string; delivered_mt?: number | string | null; status: 'PENDING' | 'ARRIVED' | 'DELIVERED' | 'SKIPPED';
  eta_at?: string | null; arrived_at?: string | null; delivered_at?: string | null; received_by?: string | null; delivery_note_no?: string | null; skip_reason?: string | null; freight_per_mt?: number | string; bill_to_name?: string | null;
}
const TONE = { PENDING: 'slate', ARRIVED: 'amber', DELIVERED: 'green', SKIPPED: 'red' } as const;
const LABEL = { PENDING: 'Pending', ARRIVED: 'Arrived', DELIVERED: 'Delivered', SKIPPED: 'Skipped' } as const;

/** Where the load stands: loaded minus what earlier stops already took. */
export const onBoardMt = (trip: { loaded_mt?: any; planned_load_mt: any }, stops: TripStop[]) =>
  Math.max(0, Number(trip.loaded_mt ?? trip.planned_load_mt) - stops.filter((s) => s.status === 'DELIVERED').reduce((a, s) => a + Number(s.delivered_mt ?? 0), 0));

export function StopsPanel({ trip, stops, onChanged, compact = false }: { trip: { id: number; code: string; status: string; stop_count?: number; loaded_mt?: any; planned_load_mt: any; origin_name?: string }; stops: TripStop[]; onChanged?: () => void; compact?: boolean }) {
  const { can } = useAuth();
  const [dlg, setDlg] = useState<{ stop: TripStop; kind: 'deliver' | 'skip' } | null>(null);
  const arrive = useAction((s: TripStop) => post(`/trips/${trip.id}/stops/${s.id}/arrive`, {}), { invalidate: TRIP_INVALIDATE, success: 'Arrival recorded.', onSuccess: () => onChanged?.() });
  const road = ['IN_TRANSIT', 'DELAYED'].includes(trip.status) && can('trips:progress');
  const next = stops.find((s) => s.seq < stops.length && ['PENDING', 'ARRIVED'].includes(s.status));
  const left = onBoardMt(trip, stops);
  const showRates = stops.some((s) => s.freight_per_mt !== undefined);
  return (
    <div>
      {stops.length > 1 && <p className="mb-3 text-sm text-slate-600">{stops.filter((s) => ['DELIVERED', 'SKIPPED'].includes(s.status)).length} of {stops.length} stops done{['IN_TRANSIT', 'DELAYED', 'ARRIVED'].includes(trip.status) && <> · <b className="tabular-nums">{fmtMt(left, 2)}</b> still on board</>}</p>}
      {arrive.error && <Alert tone="danger" className="mb-3">{arrive.error.message}</Alert>}
      <ol className="relative space-y-4 border-l border-line pl-6">
        {stops.map((s) => {
          const isFinal = s.seq === stops.length; const act = road && next?.id === s.id;
          return (
            <li key={s.id} className="relative">
              <span className={clsx('absolute -left-[34px] top-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-4 ring-white', s.status === 'DELIVERED' ? 'bg-green-600' : s.status === 'ARRIVED' ? 'bg-amber-500' : s.status === 'SKIPPED' ? 'bg-red-500' : 'bg-slate-400')}>{s.seq}</span>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{s.distributor_name ?? s.location_name}{isFinal && stops.length > 1 && <span className="ml-2 text-xs font-normal text-slate-500">final stop</span>}</p>
                  <p className="text-xs text-slate-500">{s.location_name}{s.location_city ? ` · ${s.location_city}` : ''}</p>
                </div>
                <Pill tone={TONE[s.status]} dot={false}>{LABEL[s.status]}</Pill>
              </div>
              <p className="mt-1 text-sm text-slate-700">
                {s.status === 'DELIVERED' ? <><b className="tabular-nums">{fmtMt(Number(s.delivered_mt), 2)}</b> delivered <span className="text-slate-500">(planned {fmtMt(Number(s.planned_mt), 2)})</span></> : <>Planned <b className="tabular-nums">{fmtMt(Number(s.planned_mt), 2)}</b></>}
                {s.eta_at && s.status !== 'DELIVERED' && s.status !== 'SKIPPED' && <span className="text-slate-500"> · ETA {fmtShortDateTime(s.eta_at)}</span>}
                {showRates && Number(s.freight_per_mt) > 0 && <span className="text-slate-500"> · {fmtPkr(Number(s.freight_per_mt))}/MT{s.bill_to_name ? ` · bill ${s.bill_to_name}` : ''}</span>}
              </p>
              {!compact && (s.arrived_at || s.delivered_at) && <p className="text-xs text-slate-500">{s.arrived_at && <>Arrived {fmtShortDateTime(s.arrived_at)}</>}{s.delivered_at && <> · delivered {fmtShortDateTime(s.delivered_at)}</>}{s.received_by && <> · received by {s.received_by}</>}{s.delivery_note_no && <> · DN {s.delivery_note_no}</>}</p>}
              {s.skip_reason && <p className="text-xs text-red-600">Skipped: {s.skip_reason}</p>}
              {act && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {s.status === 'PENDING' && <Button size="sm" variant="primary" icon={<Truck className="h-4 w-4" />} loading={arrive.isPending} onClick={() => arrive.mutate(s)}>Arrived here</Button>}
                  <Button size="sm" variant={s.status === 'ARRIVED' ? 'primary' : 'secondary'} icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setDlg({ stop: s, kind: 'deliver' })}>Confirm delivery</Button>
                  <Button size="sm" variant="ghost" icon={<SkipForward className="h-4 w-4" />} onClick={() => setDlg({ stop: s, kind: 'skip' })}>Skip stop</Button>
                </div>
              )}
              {isFinal && stops.length > 1 && s.status === 'PENDING' && ['IN_TRANSIT', 'DELAYED'].includes(trip.status) && <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><CircleDashed className="h-3 w-3" />Use “Arrived” and “Delivered” on the trip once the earlier stops are done.</p>}
            </li>
          );
        })}
      </ol>
      {dlg && <StopDialog trip={trip} stop={dlg.stop} kind={dlg.kind} left={left} onClose={() => setDlg(null)} onDone={() => { setDlg(null); onChanged?.(); }} />}
    </div>
  );
}

function StopDialog({ trip, stop, kind, left, onClose, onDone }: { trip: { id: number; code: string }; stop: TripStop; kind: 'deliver' | 'skip'; left: number; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ mt: String(Math.min(Number(stop.planned_mt), Math.round(left * 100) / 100)), receivedBy: '', dn: '', notes: '', reason: '' });
  const set = (k: string) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  const m = useAction(() => post(`/trips/${trip.id}/stops/${stop.id}/${kind}`, kind === 'deliver' ? { deliveredMt: Number(f.mt), receivedBy: f.receivedBy, deliveryNoteNo: f.dn || undefined, podNotes: f.notes || undefined } : { reason: f.reason }),
    { invalidate: TRIP_INVALIDATE, success: kind === 'deliver' ? `Delivered at ${stop.location_name}` : `Skipped ${stop.location_name}`, onSuccess: onDone });
  const fe = fieldErrors(m.error);
  return (
    <Modal open onClose={onClose} size="sm" title={`${kind === 'deliver' ? 'Confirm delivery' : 'Skip stop'} ${stop.seq} — ${stop.distributor_name ?? stop.location_name}`}
      footer={<><Button onClick={onClose} disabled={m.isPending}>Cancel</Button><Button variant={kind === 'skip' ? 'danger' : 'primary'} loading={m.isPending} disabled={kind === 'deliver' ? !f.mt || !f.receivedBy.trim() : !f.reason.trim()} onClick={() => m.mutate(undefined as never)}>{kind === 'deliver' ? 'Confirm delivery' : 'Skip stop'}</Button></>}>
      <div className="space-y-3">
        {m.error && !m.error.fields && <Alert tone="danger" title="Not allowed">{m.error.message}</Alert>}
        {kind === 'deliver' ? <>
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Delivered quantity (MT)" required type="number" step="0.01" min="0" value={f.mt} onChange={set('mt')} error={fe.deliveredMt} hint={`Planned ${fmtMt(Number(stop.planned_mt), 2)} · ${fmtMt(left, 2)} on board`} />
            <TextInput label="Delivery note no." value={f.dn} onChange={set('dn')} />
          </div>
          <TextInput label="Received by (name)" required value={f.receivedBy} onChange={set('receivedBy')} error={fe.receivedBy} />
          <TextArea label="Proof-of-delivery notes" value={f.notes} onChange={set('notes')} maxLength={500} />
        </> : <>
          <p className="flex items-center gap-2 text-sm text-slate-600"><MapPin className="h-4 w-4" />The vehicle will continue to the next stop; this stop is not billed. Any gas not delivered stays on board.</p>
          <TextArea label="Reason for skipping" required value={f.reason} onChange={set('reason')} error={fe.reason} maxLength={250} />
        </>}
      </div>
    </Modal>
  );
}

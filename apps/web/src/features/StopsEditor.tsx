import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { fmtDuration } from '../lib/format';
import { Button } from '../ui/Button';
import { DistributorPicker } from './common';

export interface StopRow { dist: any | null; mt: string }
export const MAX_STOPS = 8;
export const emptyStop = (): StopRow => ({ dist: null, mt: '' });
export const stopsPayload = (rows: StopRow[]) => rows.map((s) => ({ distributorId: s.dist.id as number, plannedMt: Number(s.mt) }));

/** Returns field-level messages for the stop list (empty object when valid). */
export function validateStops(rows: StopRow[]): Record<string, string> {
  const e: Record<string, string> = {};
  rows.forEach((s, i) => {
    if (!s.dist) e[`dist${i}`] = 'Choose the distributor for this stop.';
    else if (rows.some((o, j) => j < i && o.dist?.location_id === s.dist.location_id)) e[`dist${i}`] = 'This delivery point is already on the trip.';
    const n = Number(s.mt);
    if (!s.mt || !(n > 0)) e[`mt${i}`] = 'Enter MT.'; else if (n > 60) e[`mt${i}`] = 'Max 60 MT.';
  });
  const total = rows.reduce((a, s) => a + (Number(s.mt) || 0), 0);
  if (total > 60) e.total = 'Total load cannot exceed 60 MT.';
  return e;
}

/** Ordered delivery points for a trip: origin → stop 1 → stop 2 … The order entered is the order served. */
export function StopsEditor({ rows, onChange, errors = {}, etaMin, originName }: { rows: StopRow[]; onChange: (r: StopRow[]) => void; errors?: Record<string, string>; etaMin?: number[]; originName?: string }) {
  const set = (i: number, p: Partial<StopRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const move = (i: number, d: -1 | 1) => { const n = [...rows]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange(n); };
  const total = rows.reduce((a, s) => a + (Number(s.mt) || 0), 0);
  return (
    <div className="space-y-3">
      {originName && <p className="text-xs text-slate-500">Starts at <b>{originName}</b>. Stops are served in the order shown.</p>}
      <ol className="space-y-3">
        {rows.map((s, i) => (
          <li key={i} className="rounded-xl border border-line bg-white p-3">
            <div className="flex items-start gap-3">
              <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white" aria-hidden>{i + 1}</span>
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-700">{rows.length > 1 ? `Stop ${i + 1}${i === rows.length - 1 ? ' (final)' : ''}` : 'Destination distributor'} <span className="text-red-500">*</span></p>
                  <DistributorPicker value={s.dist} onChange={(d) => set(i, { dist: d })} error={errors[`dist${i}`]} />
                  {errors[`dist${i}`] && <p className="mt-1 text-xs text-red-600">{errors[`dist${i}`]}</p>}
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block w-36 text-xs font-medium text-slate-700">Quantity (MT) <span className="text-red-500">*</span>
                    <input type="number" step="0.1" min="0" className={`input mt-1 ${errors[`mt${i}`] ? 'input-error' : ''}`} value={s.mt} onChange={(e) => set(i, { mt: e.target.value })} aria-label={`Stop ${i + 1} quantity in MT`} placeholder="e.g. 8" />
                    {errors[`mt${i}`] && <span className="mt-1 block text-xs text-red-600">{errors[`mt${i}`]}</span>}
                  </label>
                  {etaMin?.[i] != null && <span className="pb-2 text-xs text-slate-500">ETA <b>+{fmtDuration(etaMin[i])}</b> after departure</span>}
                </div>
              </div>
              {rows.length > 1 && (
                <div className="flex shrink-0 flex-col gap-1">
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move stop ${i + 1} up`} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={`Move stop ${i + 1} down`} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove stop ${i + 1}`} className="rounded p-1 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" disabled={rows.length >= MAX_STOPS} icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...rows, emptyStop()])}>Add another delivery point</Button>
        <p className={`text-sm ${errors.total ? 'text-red-600' : 'text-slate-600'}`}>Total load <b className="tabular-nums">{total.toFixed(1)} MT</b>{rows.length > 1 && ` across ${rows.length} stops`}{errors.total && ` — ${errors.total}`}</p>
      </div>
    </div>
  );
}

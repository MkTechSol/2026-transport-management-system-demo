import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, post } from '../lib/api';
import { fmtDate } from '../lib/format';
import { fieldErrors, useAction } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert, ErrorState, PageLoader } from '../ui/Feedback';
import { SelectInput, TextInput } from '../ui/Form';
import { Drawer, Modal } from '../ui/Overlay';
import { KV, KVGrid } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { useVehicleOptions } from './common';
import { money, today, useBanks, useVendors } from './finance';

export const STOCK_LABELS: Record<string, string> = { OPENING: 'Opening stock', PURCHASE: 'Purchase', PURCHASE_RETURN: 'Purchase return', NAVIGATION: 'Navigation (transfer)', PARTS_REPLACEMENT: 'Parts replacement', ISSUE: 'Issue to bowzer', ADJUSTMENT: 'Stock adjustment' };
export const NEW_STOCK_TYPES = ['PURCHASE', 'PURCHASE_RETURN', 'NAVIGATION', 'PARTS_REPLACEMENT', 'ISSUE', 'ADJUSTMENT'] as const;

export const useWarehouses = () => useQuery({ queryKey: ['/inventory/warehouses'], queryFn: () => get('/inventory/warehouses'), staleTime: 30_000 });
export const useItems = () => useQuery({ queryKey: ['/inventory/items', 'all'], queryFn: () => get('/inventory/items?all=1&pageSize=100'), staleTime: 30_000 });
const useAvailable = (type?: string, id?: string) => useQuery({ queryKey: ['/inventory/available', type, id], queryFn: () => get(`/inventory/available?holderType=${type}&holderId=${id}`), enabled: !!type && !!id });

interface HolderSel { type: 'WAREHOUSE' | 'VEHICLE'; id: string }
interface Line { itemId: string; qty: string; unitCost: string; serialNo: string; position: string; removeItemId: string; removeQty: string; removeSerialNo: string; removeDisposition: string; reason: string }
const blank = (): Line => ({ itemId: '', qty: '', unitCost: '', serialNo: '', position: '', removeItemId: '', removeQty: '1', removeSerialNo: '', removeDisposition: 'SCRAP', reason: '' });

function HolderSelect({ label, value, onChange, allow, error }: { label: string; value: HolderSel; onChange: (h: HolderSel) => void; allow: ('WAREHOUSE' | 'VEHICLE')[]; error?: string }) {
  const wh = useWarehouses(); const veh = useVehicleOptions();
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2">
      {allow.length > 1 ? <SelectInput label={`${label} type`} value={value.type} onChange={(e) => onChange({ type: e.target.value as any, id: '' })} options={[{ value: 'WAREHOUSE', label: 'Store' }, { value: 'VEHICLE', label: 'Bowzer' }]} /> : <div />}
      {value.type === 'WAREHOUSE'
        ? <SelectInput label={label} required value={value.id} onChange={(e) => onChange({ ...value, id: e.target.value })} placeholder="Select store" error={error} options={(wh.data?.data ?? []).map((w: any) => ({ value: w.id, label: w.name }))} />
        : <SelectInput label={label} required value={value.id} onChange={(e) => onChange({ ...value, id: e.target.value })} placeholder="Select bowzer" error={error} options={(veh.data?.data ?? []).map((v: any) => ({ value: v.id, label: v.code }))} />}
    </div>
  );
}

/** One form for every stock voucher: purchase, purchase return, navigation (transfer), parts replacement, issue, adjustment. F10 saves. */
export function StockVoucherModal({ type, onClose, onSaved, preset }: { type: (typeof NEW_STOCK_TYPES)[number] | 'OPENING'; onClose: () => void; onSaved?: (d: any) => void; preset?: Partial<{ vehicleId: string; fromId: string }> }) {
  const vendors = useVendors(); const banks = useBanks(); const allItems = useItems(); const veh = useVehicleOptions(); const wh = useWarehouses();
  const [f, setF] = useState({ date: today(), narration: '', vendorId: '', payMode: 'CREDIT', bankId: '', vehicleId: preset?.vehicleId ?? '' });
  const [from, setFrom] = useState<HolderSel>({ type: 'WAREHOUSE', id: preset?.fromId ?? '' });
  const [to, setTo] = useState<HolderSel>({ type: type === 'NAVIGATION' ? 'VEHICLE' : 'WAREHOUSE', id: '' });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const setLine = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const buying = type === 'PURCHASE' || type === 'OPENING'; const outgoing = !buying;
  const source = type === 'PURCHASE_RETURN' || type === 'ISSUE' || type === 'ADJUSTMENT' || type === 'PARTS_REPLACEMENT' ? { type: 'WAREHOUSE', id: from.id } : from;
  const avail = useAvailable(outgoing ? source.type : undefined, outgoing ? source.id : undefined);
  const onVeh = useAvailable(type === 'PARTS_REPLACEMENT' ? 'VEHICLE' : undefined, f.vehicleId);
  const catalog: any[] = buying ? allItems.data?.data ?? [] : avail.data?.data ?? [];
  const itemOf = (id: string) => (allItems.data?.data ?? []).find((i: any) => String(i.id) === id) ?? catalog.find((i: any) => String(i.id) === id);
  const body = () => ({
    type, date: f.date, narration: f.narration || undefined,
    ...(type === 'NAVIGATION' ? { from: { type: from.type, id: Number(from.id) }, to: { type: to.type, id: Number(to.id) } } : {}),
    ...(buying ? { to: { type: 'WAREHOUSE', id: Number(to.id) } } : {}),
    ...(['PURCHASE_RETURN', 'ISSUE', 'ADJUSTMENT', 'PARTS_REPLACEMENT'].includes(type) ? { from: { type: 'WAREHOUSE', id: Number(from.id) } } : {}),
    ...(['PURCHASE', 'PURCHASE_RETURN'].includes(type) ? { vendorId: f.vendorId ? Number(f.vendorId) : undefined, payMode: f.payMode, bankId: f.payMode === 'BANK' && f.bankId ? Number(f.bankId) : undefined } : {}),
    ...(['ISSUE', 'PARTS_REPLACEMENT'].includes(type) ? { vehicleId: f.vehicleId ? Number(f.vehicleId) : undefined } : {}),
    lines: lines.filter((l) => l.itemId).map((l) => ({
      itemId: Number(l.itemId), qty: Number(l.qty), unitCost: l.unitCost === '' ? undefined : Number(l.unitCost), serialNo: l.serialNo || undefined, position: l.position || undefined, reason: l.reason || undefined,
      ...(type === 'PARTS_REPLACEMENT' && l.removeItemId ? { removeItemId: Number(l.removeItemId), removeQty: Number(l.removeQty || 1), removeSerialNo: l.removeSerialNo || undefined, removeDisposition: l.removeDisposition } : {}),
    })),
  });
  const m = useAction(() => post('/inventory/docs', body()), { invalidate: ['/inventory', '/finance', '/tyres', '/procurement', '/vendors'], success: (r: any) => `${STOCK_LABELS[type]} ${r.doc.doc_no} posted.`, onSuccess: (r) => { onSaved?.(r.doc); onClose(); } });
  const fe = fieldErrors(m.error);
  const total = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unitCost || 0), 0);
  const title = STOCK_LABELS[type];
  const desc = { PURCHASE: 'Stock in from a vendor; posts to inventory and payables', PURCHASE_RETURN: 'Send stock back to a vendor', NAVIGATION: 'Move items between stores and bowzers (e.g. a camera from one bowzer to another)', PARTS_REPLACEMENT: 'Fit new parts on a bowzer and record what was removed', ISSUE: 'Consumables used on a bowzer (oil, filters, bulbs)', ADJUSTMENT: 'Stock count correction — use a negative quantity for a loss', OPENING: 'Opening stock' }[type];
  return (
    <Modal open onClose={onClose} size="xl" title={title} description={desc} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Post voucher (F10)</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        {m.error && <div className="sm:col-span-3"><Alert tone="danger">{m.error.message}</Alert></div>}
        <TextInput label="Date" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} error={fe.date} />
        {['PURCHASE', 'PURCHASE_RETURN'].includes(type) && <SelectInput label="Vendor" required value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })} placeholder="Select vendor" error={fe.vendorId} options={(vendors.data?.data ?? []).map((v: any) => ({ value: v.id, label: v.name }))} />}
        {['PURCHASE', 'PURCHASE_RETURN'].includes(type) && <SelectInput label={type === 'PURCHASE' ? 'Paid by' : 'Refund by'} value={f.payMode} onChange={(e) => setF({ ...f, payMode: e.target.value })} options={[{ value: 'CREDIT', label: 'On credit (vendor payable)' }, { value: 'CASH', label: 'Cash' }, { value: 'BANK', label: 'Bank' }]} />}
        {f.payMode === 'BANK' && ['PURCHASE', 'PURCHASE_RETURN'].includes(type) && <SelectInput label="Bank account" required value={f.bankId} onChange={(e) => setF({ ...f, bankId: e.target.value })} placeholder="Select bank" error={fe.bankId} options={(banks.data?.data ?? []).map((b: any) => ({ value: b.id, label: b.name }))} />}
        {buying && <div><SelectInput label="Receive into store" required value={to.id} onChange={(e) => setTo({ type: 'WAREHOUSE', id: e.target.value })} placeholder="Select store" error={fe.warehouse} options={(wh.data?.data ?? []).map((w: any) => ({ value: w.id, label: w.name }))} /></div>}
        {type === 'NAVIGATION' && <><HolderSelect label="From" value={from} onChange={setFrom} allow={['WAREHOUSE', 'VEHICLE']} error={fe.from} /><HolderSelect label="To" value={to} onChange={setTo} allow={['WAREHOUSE', 'VEHICLE']} error={fe.to} /></>}
        {['PURCHASE_RETURN', 'ISSUE', 'ADJUSTMENT', 'PARTS_REPLACEMENT'].includes(type) && <SelectInput label="From store" required value={from.id} onChange={(e) => setFrom({ type: 'WAREHOUSE', id: e.target.value })} placeholder="Select store" error={fe.warehouse} options={(wh.data?.data ?? []).map((w: any) => ({ value: w.id, label: w.name }))} />}
        {['ISSUE', 'PARTS_REPLACEMENT'].includes(type) && <SelectInput label="Bowzer" required value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })} placeholder="Select bowzer" error={fe.vehicleId} options={(veh.data?.data ?? []).map((v: any) => ({ value: v.id, label: v.code }))} />}
        <TextInput label="Narration" value={f.narration} onChange={(e) => setF({ ...f, narration: e.target.value })} wrapperClassName={type === 'NAVIGATION' ? 'sm:col-span-3' : 'sm:col-span-1'} />
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr><th className="th min-w-[15rem]">{type === 'PARTS_REPLACEMENT' ? 'New part fitted' : 'Item'}</th><th className="th">Qty</th>{buying || type === 'PURCHASE_RETURN' ? <th className="th">Unit cost</th> : null}<th className="th">Serial / position</th>{type === 'PARTS_REPLACEMENT' && <th className="th min-w-[14rem]">Old part removed</th>}<th className="th" /></tr></thead>
          <tbody className="divide-y divide-line">
            {lines.map((l, i) => {
              const it = itemOf(l.itemId); const old = (onVeh.data?.data ?? []).find((x: any) => String(x.id) === l.removeItemId);
              return (
                <tr key={i} className="align-top">
                  <td className="td"><select aria-label={`Item ${i + 1}`} className="input" value={l.itemId} onChange={(e) => { const x = catalog.find((c: any) => String(c.id) === e.target.value); setLine(i, { itemId: e.target.value, unitCost: buying && x ? String(x.avg_cost || '') : l.unitCost, qty: it?.serialized || x?.serialized ? '1' : l.qty }); }}><option value="">Select item…</option>{catalog.map((c: any) => <option key={c.id} value={c.id}>{c.code} · {c.name}{c.qty != null ? ` (${c.qty} ${c.unit} available)` : ''}</option>)}</select>{fe.qty && i === 0 && <p className="mt-1 text-xs text-red-600">{fe.qty}</p>}</td>
                  <td className="td"><input aria-label={`Qty ${i + 1}`} type="number" step="0.001" className="input w-24" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                  {buying || type === 'PURCHASE_RETURN' ? <td className="td"><input aria-label={`Unit cost ${i + 1}`} type="number" min="0" step="0.01" className="input w-28" value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} /></td> : null}
                  <td className="td space-y-1">{it?.serialized && <input aria-label={`Serial ${i + 1}`} className="input w-36" placeholder="Serial no." value={l.serialNo} onChange={(e) => setLine(i, { serialNo: e.target.value })} />}
                    {it?.serialized && (type === 'PARTS_REPLACEMENT' || (type === 'NAVIGATION' && to.type === 'VEHICLE')) && <input aria-label={`Position ${i + 1}`} className="input w-36" placeholder="Wheel position e.g. W3" value={l.position} onChange={(e) => setLine(i, { position: e.target.value })} />}{fe.serialNo && i === 0 && <p className="text-xs text-red-600">{fe.serialNo}</p>}</td>
                  {type === 'PARTS_REPLACEMENT' && <td className="td space-y-1"><select aria-label={`Removed item ${i + 1}`} className="input" value={l.removeItemId} onChange={(e) => setLine(i, { removeItemId: e.target.value })}><option value="">— nothing removed —</option>{(onVeh.data?.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.code} · {c.name} ({c.qty} on bowzer)</option>)}</select>
                    {l.removeItemId && <div className="flex gap-1"><input aria-label={`Removed qty ${i + 1}`} type="number" className="input w-16" value={l.removeQty} onChange={(e) => setLine(i, { removeQty: e.target.value })} /><select aria-label={`Disposition ${i + 1}`} className="input" value={l.removeDisposition} onChange={(e) => setLine(i, { removeDisposition: e.target.value })}><option value="SCRAP">Scrap</option><option value="RETURN">Return to store</option>{old?.serialized && <option value="RETREAD">Send for retread</option>}</select></div>}
                    {old?.serialized && <input aria-label={`Removed serial ${i + 1}`} className="input" placeholder="Serial of removed tyre" value={l.removeSerialNo} onChange={(e) => setLine(i, { removeSerialNo: e.target.value })} />}{fe.removeSerialNo && i === 0 && <p className="text-xs text-red-600">{fe.removeSerialNo}</p>}</td>}
                  <td className="td w-8">{lines.length > 1 && <button type="button" aria-label={`Remove line ${i + 1}`} className="rounded p-1 text-slate-400 hover:text-red-600" onClick={() => setLines(lines.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></button>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-slate-50"><tr><td className="td" colSpan={2}><button type="button" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline" onClick={() => setLines([...lines, blank()])}><Plus className="h-4 w-4" />Add line</button></td><td className="td font-semibold tabular-nums" colSpan={4}>{(buying || type === 'PURCHASE_RETURN') && `Total PKR ${money(total)}`}</td></tr></tfoot>
        </table>
      </div>
      {outgoing && (source.id ? null : <p className="mt-2 text-xs text-slate-500">Choose the source first — only items actually available there are offered.</p>)}
    </Modal>
  );
}

export function StockDocDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/inventory/docs', id], queryFn: () => get(`/inventory/docs/${id}`) });
  const d = data?.doc;
  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={d ? d.doc_no : 'Stock voucher'} description={d ? `${data.label} · ${fmtDate(d.doc_date)}` : undefined}>
      {isLoading ? <PageLoader /> : error || !d ? <ErrorState error={error} onRetry={() => refetch()} /> : (
        <div className="space-y-4">
          <KVGrid cols={3}><KV label="Status"><StatusPill status={d.status} /></KV><KV label="Value">PKR {money(d.total_value)}</KV><KV label="Entered by">{d.created_by_name ?? 'System'}</KV>
            {d.vendor_name && <KV label="Vendor">{d.vendor_name}</KV>}{d.vehicle_code && <KV label="Bowzer">{d.vehicle_code}</KV>}{d.from_name && <KV label="From">{d.from_name}</KV>}{d.to_name && <KV label="To">{d.to_name}</KV>}{d.voucher_no && <KV label="Accounting voucher">{d.voucher_no}</KV>}
            {d.narration && <KV label="Narration" className="col-span-3">{d.narration}</KV>}</KVGrid>
          <div className="overflow-x-auto rounded-lg border border-line"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Item</th><th className="th text-right">Qty</th><th className="th text-right">Unit cost</th><th className="th text-right">Value</th><th className="th">Details</th></tr></thead>
            <tbody className="divide-y divide-line">{data.lines.map((l: any) => <tr key={l.id}><td className="td"><p className="font-medium">{l.code}</p><p className="text-xs text-slate-500">{l.name}</p></td><td className="td text-right tabular-nums">{Number(l.qty)} {l.unit}</td><td className="td text-right tabular-nums">{money(l.unit_cost)}</td><td className="td text-right tabular-nums">{money(l.line_value)}</td>
              <td className="td text-xs">{[l.serial_no && `Serial ${l.serial_no}`, l.position && `at ${l.position}`, l.remove_name && `removed ${Number(l.remove_qty)} × ${l.remove_name} (${(l.remove_disposition ?? '').toLowerCase()})`, l.reason].filter(Boolean).join(' · ')}</td></tr>)}</tbody></table></div>
        </div>
      )}
    </Drawer>
  );
}

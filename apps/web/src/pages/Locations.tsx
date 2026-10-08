import { Building2, Pencil, Plus, Warehouse } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LOCATION_TYPES, REGIONS } from '@gasman/shared';
import { get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtMt, regionLabel, titleCase } from '../lib/format';
import { fieldErrors, useAction, useList, useQueryState } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert, EmptyState, ErrorState, PageLoader } from '../ui/Feedback';
import { FilterSelect, SelectInput, TextInput } from '../ui/Form';
import { Modal } from '../ui/Overlay';
import { KV, KVGrid, PageHeader, Section } from '../ui/Page';
import { Pill, StatusPill } from '../ui/Pill';
import { MapView } from '../map/MapView';

export default function Locations() {
  const { can } = useAuth(); const { state, set } = useQueryState();
  const [form, setForm] = useState<any | null | undefined>(undefined); const [openId, setOpenId] = useState<number | null>(null);
  const { data, isLoading, error, refetch } = useList('/locations', { pageSize: 50, type: state.type ?? 'PLANT,TERMINAL,DEPOT', region: state.region }, {});
  const rows: any[] = data?.data ?? [];
  return (
    <>
      <PageHeader title="Plants & Locations" subtitle="LPG plants, import terminals and depots (distributors have their own module)" breadcrumbs={[{ label: 'Resources' }, { label: 'Plants & Locations' }]}
        actions={<><FilterSelect label="Type" value={state.type ?? 'ALL'} onChange={(v) => set({ type: v === 'ALL' ? undefined : v })} options={[{ value: 'ALL', label: 'Plants, terminals & depots' }, { value: 'PLANT', label: 'Plants only' }, { value: 'TERMINAL', label: 'Terminals only' }, { value: 'DEPOT', label: 'Depots only' }]} />
          {can('locations:manage') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setForm(null)}>Add location</Button>}</>} />
      {isLoading && <PageLoader />}{error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && (
        <div className="grid gap-5 xl:grid-cols-[1fr_520px]">
          <div className="grid gap-4 sm:grid-cols-2">
            {rows.map((l) => (
              <article key={l.id} className="card p-4">
                <div className="flex items-start justify-between gap-2"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">{l.type === 'PLANT' ? <Building2 className="h-5 w-5" /> : <Warehouse className="h-5 w-5" />}</div><div><h3 className="font-semibold">{l.name}</h3><p className="text-xs text-slate-500">{l.code} · {l.city} · {regionLabel(l.region)}</p></div></div><Pill tone={l.type === 'PLANT' ? 'blue' : 'slate'} dot={false}>{titleCase(l.type)}</Pill></div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center"><Mini label="Storage" value={l.storage_capacity_mt ? `${Number(l.storage_capacity_mt).toLocaleString()} MT` : '—'} /><Mini label="Vehicles" value={l.vehicles} /><Mini label="Trips out" value={`${l.active_trips_out} live · ${l.upcoming_trips} next`} /></div>
                <div className="mt-4 flex justify-between"><Button size="sm" variant="ghost" onClick={() => setOpenId(l.id)}>View details</Button>{can('locations:manage') && <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setForm(l)}>Edit</Button>}</div>
              </article>
            ))}
            {!rows.length && <div className="sm:col-span-2"><EmptyState title="No locations" /></div>}
          </div>
          <div className="xl:sticky xl:top-20 xl:self-start"><MapView height={420} markers={rows.map((l) => ({ id: l.id, lat: l.lat, lng: l.lng, kind: 'plant', tone: l.type === 'PLANT' ? 'blue' : 'slate', label: l.name, onClick: () => setOpenId(l.id) }))} className="overflow-hidden rounded-xl border border-line" /></div>
        </div>
      )}
      {form !== undefined && <LocationForm loc={form} onClose={() => setForm(undefined)} />}
      {openId && <LocationDetail id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
const Mini = ({ label, value }: any) => <div className="rounded-lg bg-slate-50 px-2 py-2"><p className="text-[11px] text-slate-500">{label}</p><p className="text-sm font-semibold">{value}</p></div>;

function LocationDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['/locations', id], queryFn: () => get(`/locations/${id}`) });
  return (
    <Modal open onClose={onClose} size="lg" title={data?.location.name ?? 'Location'} description={data ? `${data.location.code} · ${data.location.address ?? ''}` : ''}>
      {isLoading || !data ? <PageLoader /> : (
        <div className="space-y-5">
          <KVGrid cols={4}><KV label="Type">{titleCase(data.location.type)}</KV><KV label="Storage">{data.location.storage_capacity_mt ? fmtMt(data.location.storage_capacity_mt, 0) : '—'}</KV><KV label="Dispatched (30d)">{data.stats.dispatched_30d} trips</KV><KV label="LPG out (30d)">{fmtMt(data.stats.lpg_mt_30d, 0)}</KV></KVGrid>
          <div><h3 className="mb-2 text-sm font-semibold">Based vehicles ({data.vehicles.length})</h3><div className="flex flex-wrap gap-2">{data.vehicles.map((v: any) => <span key={v.id} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs">{v.code}<StatusPill status={v.status} /></span>)}{!data.vehicles.length && <span className="text-sm text-slate-500">None</span>}</div></div>
          <div><h3 className="mb-2 text-sm font-semibold">Recent trips from here</h3><ul className="divide-y divide-line rounded-lg border border-line">{data.trips.map((t: any) => <li key={t.id} className="flex items-center justify-between px-3 py-2 text-sm"><span><b>{t.code}</b> → {t.destination_name}</span><StatusPill status={t.status} /></li>)}{!data.trips.length && <li className="px-3 py-4 text-center text-sm text-slate-500">No trips.</li>}</ul></div>
        </div>
      )}
    </Modal>
  );
}

function LocationForm({ loc, onClose }: { loc: any | null; onClose: () => void }) {
  const [f, setF] = useState({ code: loc?.code ?? '', name: loc?.name ?? '', type: loc?.type ?? 'DEPOT', city: loc?.city ?? '', region: loc?.region ?? 'KPK', address: loc?.address ?? '', lat: String(loc?.lat ?? ''), lng: String(loc?.lng ?? ''), cap: String(loc?.storage_capacity_mt ?? ''), status: loc?.status ?? 'ACTIVE' });
  const set = (k: string) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  const body = () => ({ code: f.code, name: f.name, type: f.type, city: f.city || null, region: f.region, address: f.address || null, lat: f.lat === '' ? undefined : Number(f.lat), lng: f.lng === '' ? undefined : Number(f.lng), storageCapacityMt: f.cap ? Number(f.cap) : null, status: f.status });
  const m = useAction(() => (loc ? patch(`/locations/${loc.id}`, body()) : post('/locations', body())), { invalidate: ['/locations'], success: 'Location saved.', onSuccess: onClose });
  const fe = fieldErrors(m.error);
  return (
    <Modal open onClose={onClose} size="lg" title={loc ? `Edit ${loc.name}` : 'Add location'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {m.error && !m.error.fields && <div className="sm:col-span-2"><Alert tone="danger">{m.error.message}</Alert></div>}
        <TextInput label="Code" required value={f.code} onChange={set('code')} error={fe.code} disabled={!!loc} placeholder="DEP-ABC" /><TextInput label="Name" required value={f.name} onChange={set('name')} error={fe.name} />
        <SelectInput label="Type" value={f.type} onChange={set('type')} options={LOCATION_TYPES.filter((t) => t !== 'DISTRIBUTOR').map((t) => ({ value: t, label: titleCase(t) }))} /><SelectInput label="Region" value={f.region} onChange={set('region')} options={REGIONS.map((r) => ({ value: r, label: regionLabel(r) }))} />
        <TextInput label="City" value={f.city} onChange={set('city')} /><TextInput label="Storage capacity (MT)" type="number" value={f.cap} onChange={set('cap')} />
        <TextInput label="Latitude" required type="number" step="any" value={f.lat} onChange={set('lat')} error={fe.lat} /><TextInput label="Longitude" required type="number" step="any" value={f.lng} onChange={set('lng')} error={fe.lng} />
        <TextInput label="Address" value={f.address} onChange={set('address')} wrapperClassName="sm:col-span-2" />
        {loc && <SelectInput label="Status" value={f.status} onChange={set('status')} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} />}
      </div>
    </Modal>
  );
}

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDuration, fmtPkr } from '../lib/format';
import { fieldErrors, useAction, useList, useQueryState, useSort } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Feedback';
import { FilterSelect, SelectInput, TextInput } from '../ui/Form';
import { Modal } from '../ui/Overlay';
import { PageHeader } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';
import { usePlants } from '../features/common';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api';

export default function RoutesPage() {
  const { can } = useAuth(); const [form, setForm] = useState<any | null | undefined>(undefined);
  const { state, set, clear, page } = useQueryState(); const { sort, dir, onSort } = useSort(state, set as any, 'name');
  const { data, isLoading, error, refetch } = useList('/routes', { page, pageSize: 20, q: state.q, active: state.active, sort, dir: state.sort ? dir : 'asc' });
  const cols: Column<any>[] = [
    { key: 'name', header: 'Route', sortKey: 'name', render: (r) => <div><p className="font-semibold">{r.name}</p><p className="text-xs text-slate-500">{r.code}</p></div> },
    { key: 'from', header: 'From', hideBelow: 'md', render: (r) => r.origin_name }, { key: 'to', header: 'To', hideBelow: 'md', render: (r) => r.destination_name },
    { key: 'km', header: 'Distance', sortKey: 'distance', render: (r) => <span className="tabular-nums">{r.distance_km} km<span className="block text-xs text-slate-500">{fmtDuration(r.est_duration_min)}</span></span> },
    { key: 'fr', header: 'Freight / MT', sortKey: 'freight', render: (r) => <span className="tabular-nums font-medium">{fmtPkr(r.freight_per_mt)}</span> },
    { key: 'trips', header: 'Trips', sortKey: 'trips', hideBelow: 'lg', render: (r) => r.trips },
    { key: 'st', header: 'Status', render: (r) => <StatusPill status={r.active ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'a', header: '', render: (r) => can('routes:manage') && <div className="text-right"><Button size="sm" onClick={() => setForm(r)}>Edit</Button></div> },
  ];
  return (
    <>
      <PageHeader title="Route Definition" subtitle="Origin → destination routes with distance and freight rate per MT" breadcrumbs={[{ label: 'Setup' }, { label: 'Routes & freight' }]} actions={can('routes:manage') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setForm(null)}>New route</Button>} />
      <FilterBar active={!!(state.q || state.active)} onClear={() => clear()}>
        <SearchInput className="w-full sm:w-72" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search route, origin, destination…" />
        <FilterSelect label="Status" value={state.active ?? 'ALL'} onChange={(v) => set({ active: v })} options={[{ value: 'ALL', label: 'Active & inactive' }, { value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]} />
      </FilterBar>
      <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(r) => r.id} sort={sort} dir={state.sort ? dir : 'asc'} onSort={onSort} page={page} pageSize={20} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No routes yet', description: 'Routes are created automatically when a trip uses a new origin/destination pair, or define them here.' }} />
      {form !== undefined && <RouteForm route={form} onClose={() => { setForm(undefined); refetch(); }} />}
    </>
  );
}

function RouteForm({ route, onClose }: { route: any | null; onClose: () => void }) {
  const locs = usePlants(); const all = useQuery({ queryKey: ['/locations', 'all-routes'], queryFn: () => get('/locations?all=1'), staleTime: 60_000 });
  void locs;
  const [f, setF] = useState({ name: route?.name ?? '', o: String(route?.origin_location_id ?? ''), d: String(route?.destination_location_id ?? ''), km: String(route?.distance_km ?? ''), fr: String(route?.freight_per_mt ?? ''), active: route?.active ?? true });
  const set = (k: string) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  const m = useAction(() => (route ? patch(`/routes/${route.id}`, { name: f.name || undefined, distanceKm: f.km ? Number(f.km) : undefined, freightPerMt: Number(f.fr), active: f.active })
    : post('/routes', { name: f.name || undefined, originLocationId: Number(f.o), destinationLocationId: Number(f.d), distanceKm: f.km ? Number(f.km) : undefined, freightPerMt: Number(f.fr) })), { invalidate: ['/routes'], success: 'Route saved.', onSuccess: onClose });
  const fe = fieldErrors(m.error);
  const opts = (all.data?.data ?? []).map((l: any) => ({ value: l.id, label: `${l.name}${l.city ? ` (${l.city})` : ''}` }));
  return (
    <Modal open onClose={onClose} size="md" title={route ? `Edit route` : 'New route'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!f.fr || (!route && (!f.o || !f.d))} onClick={() => m.mutate(undefined as never)}>Save (F10)</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {m.error && !m.error.fields && <div className="sm:col-span-2"><Alert tone="danger">{m.error.message}</Alert></div>}
        <TextInput label="Route name" value={f.name} onChange={set('name')} error={fe.name} wrapperClassName="sm:col-span-2" placeholder="e.g. Nashpa – Osakai Plant" />
        <SelectInput label="From location" required value={f.o} onChange={set('o')} disabled={!!route} placeholder="Select" options={opts} error={fe.originLocationId} /><SelectInput label="To location" required value={f.d} onChange={set('d')} disabled={!!route} placeholder="Select" options={opts} error={fe.destinationLocationId} />
        <TextInput label="Distance (km)" type="number" step="0.1" value={f.km} onChange={set('km')} error={fe.distanceKm} hint="Leave blank to estimate from coordinates" /><TextInput label="Freight per MT (PKR)" required type="number" value={f.fr} onChange={set('fr')} error={fe.freightPerMt} />
        {route && <SelectInput label="Status" value={f.active ? 'true' : 'false'} onChange={(e) => setF({ ...f, active: e.target.value === 'true' })} options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]} />}
      </div>
    </Modal>
  );
}

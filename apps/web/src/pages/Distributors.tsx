import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { REGIONS } from '@gasman/shared';
import { patch, post } from '../lib/api';
import { CITIES } from '../lib/cities';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtMt, regionLabel } from '../lib/format';
import { fieldErrors, useAction, useList, useQueryState, useSort } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Feedback';
import { FilterSelect, SelectInput, TextInput } from '../ui/Form';
import { Modal } from '../ui/Overlay';
import { PageHeader } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';

export default function Distributors({ embedded = false }: { embedded?: boolean }) {
  const nav = useNavigate(); const { can } = useAuth(); const [adding, setAdding] = useState(false);
  const { state, set, clear, page } = useQueryState(); const { sort, dir, onSort } = useSort(state, set as any, 'name');
  const { data, isLoading, error, refetch } = useList('/distributors', { page, pageSize: 15, q: state.q, customerType: state.ctype, region: state.region, status: state.status, sort, dir: state.sort ? dir : 'asc' });
  const cols: Column<any>[] = [
    { key: 'name', header: 'Customer', sortKey: 'name', render: (d) => <div><p className="font-semibold text-brand-700">{d.name}</p><p className="text-xs text-slate-500">{d.code} · {d.customer_type === 'MARKETER' ? 'Marketer' : d.customer_type === 'OTHER' ? 'Other' : 'Distributor'}</p></div> },
    { key: 'city', header: 'City / region', sortKey: 'city', render: (d) => <div><p>{d.city}</p><p className="text-xs text-slate-500">{regionLabel(d.region)}</p></div> },
    { key: 'contact', header: 'Contact', hideBelow: 'md', render: (d) => <div><p>{d.contact_name}</p><p className="text-xs text-slate-500">{d.phone}</p></div> },
    { key: 'trips', header: 'Deliveries', sortKey: 'trips', hideBelow: 'lg', render: (d) => <span className="tabular-nums">{d.trips_total}</span> },
    { key: 'vol', header: 'Volume', sortKey: 'volume', hideBelow: 'lg', render: (d) => <span className="tabular-nums">{fmtMt(d.mt_total, 0)}</span> },
    { key: 'last', header: 'Last delivery', hideBelow: 'lg', render: (d) => fmtDate(d.last_delivery) },
    ...(can('sales:view') ? [{ key: 'bal', header: 'Balance due', sortKey: 'balance', render: (d: any) => <div><p className="tabular-nums">{Number(d.balance).toLocaleString('en-US')}</p>{Number(d.credit_limit_pkr) > 0 && <p className={Number(d.balance) >= Number(d.credit_limit_pkr) ? 'text-xs font-medium text-red-600' : 'text-xs text-slate-500'}>{Math.round((Number(d.balance) / Number(d.credit_limit_pkr)) * 100)}% of limit</p>}</div> }] : []),
    { key: 'credit', header: 'Credit', hideBelow: 'md', render: (d) => <StatusPill status={d.credit_status} /> },
    { key: 'status', header: 'Status', render: (d) => <StatusPill status={d.status} /> },
  ];
  return (
    <>
      {!embedded && <PageHeader title="Distributors" subtitle="Receiving customers across KPK, Punjab, AJK and Gilgit-Baltistan (synthetic demo data)" breadcrumbs={[{ label: 'Resources' }, { label: 'Distributors' }]} actions={can('distributors:manage') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add distributor</Button>} />}
      <FilterBar active={['q', 'region', 'status'].some((k) => state[k])} onClear={() => clear()}>
        <SearchInput className="w-full sm:w-72" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search name, city, code, contact…" />
        <FilterSelect label="Type" value={state.ctype ?? 'ALL'} onChange={(v) => set({ ctype: v })} options={[{ value: 'ALL', label: 'All customers' }, { value: 'DISTRIBUTOR', label: 'Distributors' }, { value: 'MARKETER', label: 'Marketers / OMCs' }]} />
        <FilterSelect label="Region" value={state.region ?? 'ALL'} onChange={(v) => set({ region: v })} options={[{ value: 'ALL', label: 'All regions' }, ...REGIONS.filter((r) => r !== 'SINDH').map((r) => ({ value: r, label: regionLabel(r) }))]} />
        <FilterSelect label="Status" value={state.status ?? 'ALL'} onChange={(v) => set({ status: v })} options={[{ value: 'ALL', label: 'Any status' }, { value: 'ACTIVE', label: 'Active' }, { value: 'ON_HOLD', label: 'On hold' }, { value: 'INACTIVE', label: 'Inactive' }]} />
        {embedded && can('distributors:manage') && <Button className="ml-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add customer</Button>}
      </FilterBar>
      <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(d) => d.id} onRowClick={(d) => nav(`/distributors/${d.id}`)} sort={sort} dir={state.sort ? dir : 'asc'} onSort={onSort}
        page={page} pageSize={15} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No distributors found' }} />
      {adding && <DistributorForm onClose={() => setAdding(false)} onSaved={(d) => nav(`/distributors/${d.id}`)} />}
    </>
  );
}

export function DistributorForm({ dist, onClose, onSaved }: { dist?: any; onClose: () => void; onSaved?: (d: any) => void }) {
  const [f, setF] = useState({ code: dist?.code ?? '', name: dist?.name ?? '', city: dist?.city ?? '', region: dist?.region ?? 'KPK', address: dist?.address ?? '', contactName: dist?.contact_name ?? '', phone: dist?.phone ?? '', lat: String(dist?.lat ?? ''), lng: String(dist?.lng ?? ''), status: dist?.status ?? 'ACTIVE', creditStatus: dist?.credit_status ?? 'GOOD' , customerType: dist?.customer_type ?? 'DISTRIBUTOR', creditLimit: String(dist?.credit_limit_pkr ?? 0), creditAlertPct: String(dist?.credit_alert_pct ?? 80), whatsapp: dist?.whatsapp ?? '', email: dist?.email ?? '', ntn: dist?.ntn ?? '' });
  const set = (k: string) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  const pick = (city: string) => { const c = CITIES.find((x) => x.name === city); setF((s) => ({ ...s, city, ...(c ? { region: c.region, lat: (c.lat + (Math.random() - 0.5) * 0.04).toFixed(4), lng: (c.lng + (Math.random() - 0.5) * 0.04).toFixed(4) } : {}) })); };
  const body = () => ({ customerType: f.customerType, creditLimitPkr: Number(f.creditLimit || 0), creditAlertPct: Number(f.creditAlertPct || 80), whatsapp: f.whatsapp || null, email: f.email || null, ntn: f.ntn || null, code: f.code, name: f.name, city: f.city, region: f.region, address: f.address || null, contactName: f.contactName || null, phone: f.phone || null, lat: f.lat === '' ? undefined : Number(f.lat), lng: f.lng === '' ? undefined : Number(f.lng), status: f.status, creditStatus: f.creditStatus });
  const m = useAction(() => (dist ? patch(`/distributors/${dist.id}`, body()) : post('/distributors', body())), { invalidate: ['/distributors'], success: 'Distributor saved.', onSuccess: (r: any) => { onSaved?.(r.distributor); onClose(); } });
  const fe = fieldErrors(m.error);
  return (
    <Modal open onClose={onClose} size="lg" title={dist ? `Edit ${dist.name}` : 'Add distributor'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {m.error && !m.error.fields && <div className="sm:col-span-2"><Alert tone="danger">{m.error.message}</Alert></div>}
        <TextInput label="Distributor code" required value={f.code} onChange={set('code')} error={fe.code} disabled={!!dist} placeholder="DEMO-KPK-033" /><TextInput label="Business name" required value={f.name} onChange={set('name')} error={fe.name} />
        <SelectInput label="City" required value={f.city} onChange={(e) => pick(e.target.value)} error={fe.city} placeholder="Select city" options={[...CITIES.map((c) => ({ value: c.name, label: c.name })), ...(f.city && !CITIES.some((c) => c.name === f.city) ? [{ value: f.city, label: f.city }] : [])]} hint="Selecting a city pre-fills region and map coordinates" />
        <SelectInput label="Region" value={f.region} onChange={set('region')} options={REGIONS.filter((r) => r !== 'SINDH').map((r) => ({ value: r, label: regionLabel(r) }))} />
        <TextInput label="Contact person" value={f.contactName} onChange={set('contactName')} /><TextInput label="Phone" value={f.phone} onChange={set('phone')} placeholder="0300-5551234" />
        <TextInput label="Latitude" required type="number" step="any" value={f.lat} onChange={set('lat')} error={fe.lat} /><TextInput label="Longitude" required type="number" step="any" value={f.lng} onChange={set('lng')} error={fe.lng} />
        <TextInput label="Address" value={f.address} onChange={set('address')} wrapperClassName="sm:col-span-2" />
        <SelectInput label="Customer type" value={f.customerType} onChange={set('customerType')} options={[{ value: 'DISTRIBUTOR', label: 'Distributor' }, { value: 'MARKETER', label: 'Marketer / OMC' }, { value: 'OTHER', label: 'Other' }]} />
        <TextInput label="NTN" value={f.ntn} onChange={set('ntn')} />
        <TextInput label="Credit limit (PKR)" type="number" min="0" value={f.creditLimit} onChange={set('creditLimit')} error={fe.creditLimitPkr} hint="0 = no limit" /><TextInput label="Alert at (% of limit)" type="number" min="1" max="100" value={f.creditAlertPct} onChange={set('creditAlertPct')} error={fe.creditAlertPct} />
        <TextInput label="WhatsApp" value={f.whatsapp} onChange={set('whatsapp')} /><TextInput label="Email" value={f.email} onChange={set('email')} />
        <SelectInput label="Status" value={f.status} onChange={set('status')} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'ON_HOLD', label: 'On hold' }, { value: 'INACTIVE', label: 'Inactive' }]} />
        <SelectInput label="Credit status" value={f.creditStatus} onChange={set('creditStatus')} options={[{ value: 'GOOD', label: 'Good' }, { value: 'WATCH', label: 'Watch' }, { value: 'BLOCKED', label: 'Blocked' }]} />
      </div>
    </Modal>
  );
}

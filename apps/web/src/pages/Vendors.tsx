import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fieldErrors, useAction, useList, useQueryState } from '../lib/hooks';
import { titleCase } from '../lib/format';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Feedback';
import { FilterSelect, SelectInput, TextInput } from '../ui/Form';
import { Modal } from '../ui/Overlay';
import { PageHeader } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';
import { money } from '../features/finance';

const CATS = ['SUPPLIER', 'TRANSPORTER', 'WORKSHOP', 'FUEL_STATION', 'REFINERY', 'SERVICE', 'OTHER'];

function VendorModal({ vendor, onClose }: { vendor?: any; onClose: () => void }) {
  const [f, setF] = useState({ name: vendor?.name ?? '', category: vendor?.category ?? 'SUPPLIER', contactName: vendor?.contact_name ?? '', phone: vendor?.phone ?? '', email: vendor?.email ?? '', city: vendor?.city ?? '', address: vendor?.address ?? '', ntn: vendor?.ntn ?? '', paymentTermsDays: String(vendor?.payment_terms_days ?? 0) });
  const set = (k: string) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  const body = () => ({ ...f, paymentTermsDays: Number(f.paymentTermsDays || 0) });
  const m = useAction(() => (vendor ? patch(`/vendors/${vendor.id}`, body()) : post('/vendors', body())), { invalidate: ['/vendors'], success: 'Vendor saved.', onSuccess: onClose }); const fe = fieldErrors(m.error);
  return <Modal open onClose={onClose} size="lg" title={vendor ? `Edit ${vendor.name}` : 'New vendor'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Save (F10)</Button></>}>
    <div className="grid gap-4 sm:grid-cols-2">{m.error && !m.error.fields && <div className="sm:col-span-2"><Alert tone="danger">{m.error.message}</Alert></div>}
      <TextInput label="Vendor name" required value={f.name} onChange={set('name')} error={fe.name} /><SelectInput label="Category" value={f.category} onChange={set('category')} options={CATS.map((c) => ({ value: c, label: titleCase(c) }))} />
      <TextInput label="Contact person" value={f.contactName} onChange={set('contactName')} /><TextInput label="Phone" value={f.phone} onChange={set('phone')} /><TextInput label="Email" value={f.email} onChange={set('email')} error={fe.email} /><TextInput label="City" value={f.city} onChange={set('city')} />
      <TextInput label="NTN" value={f.ntn} onChange={set('ntn')} /><TextInput label="Payment terms (days)" type="number" min="0" value={f.paymentTermsDays} onChange={set('paymentTermsDays')} error={fe.paymentTermsDays} /><TextInput label="Address" wrapperClassName="sm:col-span-2" value={f.address} onChange={set('address')} /></div></Modal>;
}

export default function Vendors() {
  const { can } = useAuth(); const nav = useNavigate(); const [edit, setEdit] = useState<any | null | false>(false);
  const { state, set, clear, page } = useQueryState();
  const { data, isLoading, error, refetch } = useList('/vendors', { page, pageSize: 20, q: state.q, category: state.category });
  const showBal = can('finance:view');
  const cols: Column<any>[] = [
    { key: 'name', header: 'Vendor', render: (v) => <div><p className="font-semibold text-brand-700">{v.name}</p><p className="text-xs text-slate-500">{v.code}</p></div> },
    { key: 'cat', header: 'Category', render: (v) => titleCase(v.category) }, { key: 'city', header: 'City', hideBelow: 'md', render: (v) => v.city }, { key: 'ph', header: 'Phone', hideBelow: 'lg', render: (v) => v.phone },
    { key: 'terms', header: 'Terms', hideBelow: 'lg', render: (v) => `${v.payment_terms_days} days` },
    ...(showBal ? [{ key: 'pay', header: 'Payable', render: (v: any) => <span className="tabular-nums">{money(v.payable)}</span> }] : []),
    { key: 'st', header: 'Status', render: (v) => <StatusPill status={v.active ? 'ACTIVE' : 'INACTIVE'} /> },
  ];
  return <>
    <PageHeader title="Vendors & Suppliers" subtitle="Fuel stations, workshops, parts and tyre suppliers, transporters and service providers" breadcrumbs={[{ label: 'Procurement' }, { label: 'Vendors' }]} actions={can('vendors:manage') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit(null)}>New vendor</Button>} />
    <FilterBar active={!!state.q || !!state.category} onClear={() => clear()}><SearchInput className="w-full sm:w-64" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search name, code, city…" />
      <FilterSelect label="Category" value={state.category ?? 'ALL'} onChange={(v) => set({ category: v })} options={[{ value: 'ALL', label: 'All categories' }, ...CATS.map((c) => ({ value: c, label: titleCase(c) }))]} /></FilterBar>
    <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(v) => v.id} onRowClick={(v) => (can('vendors:manage') ? setEdit(v) : showBal && nav(`/finance/reports/ledger?partyId=${v.id}&partyType=VENDOR`))} page={page} pageSize={20} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No vendors found' }} />
    {edit !== false && <VendorModal vendor={edit ?? undefined} onClose={() => setEdit(false)} />}
  </>;
}

import { useState } from 'react';
import { DOC_TYPES, DOC_TYPE_LABELS, DRIVER_STATUSES, INCIDENT_CATEGORIES, INCIDENT_SEVERITIES, MAINTENANCE_TYPES, REGIONS, VEHICLE_STATUSES } from '@gasman/shared';
import { patch, post } from '../lib/api';
import { fieldErrors, useAction } from '../lib/hooks';
import { regionLabel, titleCase } from '../lib/format';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Feedback';
import { SelectInput, TextArea, TextInput } from '../ui/Form';
import { Modal } from '../ui/Overlay';
import { useDriverOptions, usePlants, useVehicleOptions } from './common';

const err = (m: any) => <>{m.error && !m.error.fields && <div className="sm:col-span-2"><Alert tone="danger">{m.error.message}</Alert></div>}</>;

export function VehicleForm({ vehicle, onClose, onSaved }: { vehicle?: any; onClose: () => void; onSaved?: (v: any) => void }) {
  const plants = usePlants(); const drivers = useDriverOptions();
  const [f, setF] = useState({
    code: vehicle?.code ?? '', registrationNo: vehicle?.registration_no ?? '', fleetType: vehicle?.fleet_type ?? 'OWNED', capacityMt: String(vehicle?.capacity_mt ?? ''), make: vehicle?.make ?? '', model: vehicle?.model ?? '',
    year: String(vehicle?.year ?? ''), status: vehicle?.status ?? 'AVAILABLE', homePlantId: String(vehicle?.home_plant_id ?? ''), defaultDriverId: String(vehicle?.default_driver_id ?? ''), vendorName: vehicle?.vendor_name ?? '', odometerKm: String(vehicle?.odometer_km ?? 0),
  });
  const set = (k: string) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  const body = () => ({ code: f.code, registrationNo: f.registrationNo, fleetType: f.fleetType, capacityMt: f.capacityMt === '' ? undefined : Number(f.capacityMt), make: f.make || null, model: f.model || null, year: f.year ? Number(f.year) : null, homePlantId: f.homePlantId ? Number(f.homePlantId) : null, defaultDriverId: f.defaultDriverId ? Number(f.defaultDriverId) : null, vendorName: f.fleetType === 'HIRED' ? f.vendorName || null : null, odometerKm: Number(f.odometerKm || 0), ...(vehicle ? { status: f.status } : {}) });
  const m = useAction(() => (vehicle ? patch(`/vehicles/${vehicle.id}`, body()) : post('/vehicles', body())), { invalidate: ['/vehicles'], success: vehicle ? 'Vehicle updated.' : 'Vehicle added to the fleet.', onSuccess: (r) => { onSaved?.(r.vehicle); onClose(); } });
  const fe = fieldErrors(m.error);
  return (
    <Modal open onClose={onClose} size="lg" title={vehicle ? `Edit ${vehicle.code}` : 'Add vehicle'} description="Bowzer / tanker details" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>{vehicle ? 'Save changes' : 'Add vehicle'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {err(m)}
        <TextInput label="Fleet code" required value={f.code} onChange={set('code')} error={fe.code} placeholder="GAS-BZ-027" />
        <TextInput label="Registration number" required value={f.registrationNo} onChange={set('registrationNo')} error={fe.registrationNo} />
        <SelectInput label="Ownership" value={f.fleetType} onChange={set('fleetType')} options={[{ value: 'OWNED', label: 'Owned' }, { value: 'HIRED', label: 'Hired (third-party)' }]} />
        <TextInput label="Capacity (MT)" required type="number" step="0.1" value={f.capacityMt} onChange={set('capacityMt')} error={fe.capacityMt} />
        {f.fleetType === 'HIRED' && <TextInput label="Vendor / owner" value={f.vendorName} onChange={set('vendorName')} wrapperClassName="sm:col-span-2" />}
        <TextInput label="Make" value={f.make} onChange={set('make')} /><TextInput label="Model" value={f.model} onChange={set('model')} />
        <TextInput label="Year" type="number" value={f.year} onChange={set('year')} error={fe.year} /><TextInput label="Odometer (km)" type="number" value={f.odometerKm} onChange={set('odometerKm')} error={fe.odometerKm} />
        <SelectInput label="Home plant" value={f.homePlantId} onChange={set('homePlantId')} placeholder="—" options={(plants.data?.data ?? []).map((p: any) => ({ value: p.id, label: p.name }))} />
        <SelectInput label="Regular driver" value={f.defaultDriverId} onChange={set('defaultDriverId')} placeholder="—" options={(drivers.data?.data ?? []).map((d: any) => ({ value: d.id, label: `${d.full_name} (${d.employee_id})` }))} />
        {vehicle && <SelectInput label="Status" value={f.status} onChange={set('status')} error={fe.status} options={VEHICLE_STATUSES.map((s) => ({ value: s, label: titleCase(s), disabled: s === 'ON_TRIP' && vehicle.status !== 'ON_TRIP' }))} hint="On Trip is set automatically when a trip is dispatched." />}
      </div>
    </Modal>
  );
}

export function DriverForm({ driver, onClose, onSaved }: { driver?: any; onClose: () => void; onSaved?: (d: any) => void }) {
  const plants = usePlants();
  const [f, setF] = useState({ employeeId: driver?.employee_id ?? '', fullName: driver?.full_name ?? '', phone: driver?.phone ?? '', nationalIdDemo: driver?.national_id_demo ?? '', licenseNo: driver?.license_no ?? '', licenseClass: driver?.license_class ?? 'HTV', experienceYears: String(driver?.experience_years ?? 0), homePlantId: String(driver?.home_plant_id ?? ''), status: driver?.status ?? 'AVAILABLE', safetyScore: String(driver?.safety_score ?? 100) });
  const set = (k: string) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  const body = () => ({ employeeId: f.employeeId, fullName: f.fullName, phone: f.phone || null, nationalIdDemo: f.nationalIdDemo || null, licenseNo: f.licenseNo, licenseClass: f.licenseClass, experienceYears: Number(f.experienceYears || 0), homePlantId: f.homePlantId ? Number(f.homePlantId) : null, safetyScore: Number(f.safetyScore), ...(driver ? { status: f.status } : {}) });
  const m = useAction(() => (driver ? patch(`/drivers/${driver.id}`, body()) : post('/drivers', body())), { invalidate: ['/drivers'], success: driver ? 'Driver updated.' : 'Driver added.', onSuccess: (r) => { onSaved?.(r.driver); onClose(); } });
  const fe = fieldErrors(m.error);
  return (
    <Modal open onClose={onClose} size="lg" title={driver ? `Edit ${driver.full_name}` : 'Add driver'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>{driver ? 'Save changes' : 'Add driver'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {err(m)}
        <TextInput label="Employee ID" required value={f.employeeId} onChange={set('employeeId')} error={fe.employeeId} placeholder="GM-D-0037" />
        <TextInput label="Full name" required value={f.fullName} onChange={set('fullName')} error={fe.fullName} />
        <TextInput label="Phone" value={f.phone} onChange={set('phone')} error={fe.phone} placeholder="0300-5551234" />
        <TextInput label="National ID (demo)" value={f.nationalIdDemo} onChange={set('nationalIdDemo')} hint="Use a synthetic identifier in the demo" />
        <TextInput label="Licence number" required value={f.licenseNo} onChange={set('licenseNo')} error={fe.licenseNo} />
        <SelectInput label="Licence class" value={f.licenseClass} onChange={set('licenseClass')} options={[{ value: 'HTV', label: 'HTV' }, { value: 'HTV+HAZ', label: 'HTV + Hazmat' }]} />
        <TextInput label="Experience (years)" type="number" value={f.experienceYears} onChange={set('experienceYears')} error={fe.experienceYears} />
        <SelectInput label="Home plant" value={f.homePlantId} onChange={set('homePlantId')} placeholder="—" options={(plants.data?.data ?? []).map((p: any) => ({ value: p.id, label: p.name }))} />
        <TextInput label="Safety score (0–100)" type="number" min="0" max="100" value={f.safetyScore} onChange={set('safetyScore')} error={fe.safetyScore} />
        {driver && <SelectInput label="Status" value={f.status} onChange={set('status')} options={DRIVER_STATUSES.map((s) => ({ value: s, label: titleCase(s), disabled: s === 'ON_TRIP' && driver.status !== 'ON_TRIP' }))} />}
      </div>
    </Modal>
  );
}

export function DocumentModal({ owner, defaultType, onClose }: { owner: { kind: 'VEHICLE' | 'DRIVER'; id: number; label: string }; defaultType?: string; onClose: () => void }) {
  const types = owner.kind === 'VEHICLE' ? DOC_TYPES.VEHICLE : DOC_TYPES.DRIVER;
  const [f, setF] = useState({ docType: defaultType ?? types[0], docNumber: '', issuedOn: new Date().toISOString().slice(0, 10), expiresOn: '', issuer: '' });
  const set = (k: string) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  const m = useAction(() => post('/documents', { [owner.kind === 'VEHICLE' ? 'vehicleId' : 'driverId']: owner.id, docType: f.docType, docNumber: f.docNumber || null, issuedOn: f.issuedOn || null, expiresOn: f.expiresOn, issuer: f.issuer || null }),
    { invalidate: ['/documents', '/vehicles', '/drivers'], success: 'Document saved.', onSuccess: onClose });
  const fe = fieldErrors(m.error);
  return (
    <Modal open onClose={onClose} title="Add / renew document" description={owner.label} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!f.expiresOn} onClick={() => m.mutate(undefined as never)}>Save document</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {err(m)}
        <SelectInput label="Document type" value={f.docType} onChange={set('docType')} error={fe.docType} options={types.map((t) => ({ value: t, label: DOC_TYPE_LABELS[t] }))} wrapperClassName="sm:col-span-2" />
        <TextInput label="Document number" value={f.docNumber} onChange={set('docNumber')} /><TextInput label="Issuer" value={f.issuer} onChange={set('issuer')} />
        <TextInput label="Issued on" type="date" value={f.issuedOn} onChange={set('issuedOn')} /><TextInput label="Expires on" required type="date" value={f.expiresOn} onChange={set('expiresOn')} error={fe.expiresOn} />
        <p className="text-xs text-slate-500 sm:col-span-2">Adding a document with a later expiry renews it: the newest document of each type is the current one.</p>
      </div>
    </Modal>
  );
}

export function MaintenanceModal({ vehicleId, onClose }: { vehicleId?: number; onClose: () => void }) {
  const vehicles = useVehicleOptions();
  const [f, setF] = useState({ vehicleId: String(vehicleId ?? ''), type: 'PREVENTIVE', title: '', scheduledOn: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), vendor: '', description: '' });
  const set = (k: string) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  const m = useAction(() => post('/maintenance', { vehicleId: Number(f.vehicleId), type: f.type, title: f.title, scheduledOn: f.scheduledOn, vendor: f.vendor || null, description: f.description || null }), { invalidate: ['/maintenance', '/vehicles'], success: 'Maintenance scheduled.', onSuccess: onClose });
  const fe = fieldErrors(m.error);
  return (
    <Modal open onClose={onClose} title="Schedule maintenance" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!f.vehicleId} onClick={() => m.mutate(undefined as never)}>Schedule</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {err(m)}
        <SelectInput label="Vehicle" required value={f.vehicleId} onChange={set('vehicleId')} error={fe.vehicleId} placeholder="Select vehicle" options={(vehicles.data?.data ?? []).map((v: any) => ({ value: v.id, label: `${v.code} — ${v.registration_no}` }))} wrapperClassName="sm:col-span-2" disabled={!!vehicleId} />
        <SelectInput label="Type" value={f.type} onChange={set('type')} options={MAINTENANCE_TYPES.map((t) => ({ value: t, label: titleCase(t) }))} />
        <TextInput label="Scheduled date" required type="date" value={f.scheduledOn} onChange={set('scheduledOn')} error={fe.scheduledOn} />
        <TextInput label="Job title" required value={f.title} onChange={set('title')} error={fe.title} placeholder="e.g. Periodic service" wrapperClassName="sm:col-span-2" />
        <TextInput label="Workshop / vendor" value={f.vendor} onChange={set('vendor')} wrapperClassName="sm:col-span-2" />
        <TextArea label="Description" value={f.description} onChange={set('description')} wrapperClassName="sm:col-span-2" maxLength={500} />
      </div>
    </Modal>
  );
}

export function IncidentModal({ onClose, tripId, vehicleId }: { onClose: () => void; tripId?: number; vehicleId?: number }) {
  const [f, setF] = useState({ category: 'OTHER', severity: 'MEDIUM', description: '' });
  const set = (k: string) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  const m = useAction(() => post('/safety/incidents', { tripId, vehicleId, category: f.category, severity: f.severity, description: f.description }), { invalidate: ['/safety', '/trips'], success: 'Incident reported. Managers have been notified.', onSuccess: onClose });
  const fe = fieldErrors(m.error);
  return (
    <Modal open onClose={onClose} title="Report safety incident" description="Gas leaks, accidents, breakdowns and blockages" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Submit report</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {err(m)}
        <SelectInput label="Category" value={f.category} onChange={set('category')} options={INCIDENT_CATEGORIES.map((c) => ({ value: c, label: titleCase(c) }))} />
        <SelectInput label="Severity" value={f.severity} onChange={set('severity')} options={INCIDENT_SEVERITIES.map((c) => ({ value: c, label: titleCase(c) }))} />
        <TextArea label="What happened?" required value={f.description} onChange={set('description')} error={fe.description} wrapperClassName="sm:col-span-2" maxLength={1000} />
        {(f.severity === 'HIGH' || f.severity === 'CRITICAL') && <div className="sm:col-span-2"><Alert tone="warning" title="High-severity report">All operations and fleet managers are alerted immediately. For emergencies, call the emergency contact first.</Alert></div>}
      </div>
    </Modal>
  );
}
export const _r = { REGIONS, regionLabel };

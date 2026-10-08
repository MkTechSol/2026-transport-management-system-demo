import { ArrowLeft, ArrowRight, MapPin, Route as RouteIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { get, post, qs } from '../lib/api';
import { fmtDateTime, fmtDuration, fmtMt, fmtPkr, regionLabel, toLocalInput } from '../lib/format';
import { useAuth } from '../lib/auth';
import { fieldErrors, useAction } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Feedback';
import { SelectInput, TextArea, TextInput } from '../ui/Form';
import { KV, KVGrid, PageHeader, Section, Stepper } from '../ui/Page';
import { DistributorPicker, usePlants } from '../features/common';

const STEPS = [{ key: 'route', label: 'Route' }, { key: 'load', label: 'Load & schedule' }, { key: 'review', label: 'Review' }];

export default function TripNew() {
  const nav = useNavigate(); const plants = usePlants(); const { can } = useAuth();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ kind: 'DELIVERY' as 'DELIVERY' | 'UPLIFTING', destPlantId: '', originId: '', dist: null as any, load: '', source: 'LOCAL', priority: 'NORMAL', departure: toLocalInput(new Date(Date.now() + 3 * 3600_000 - ((Date.now() + 3 * 3600_000) % 900_000))), arrival: '', notes: '' });
  const [touched, setTouched] = useState<Record<string, string>>({});
  const all: any[] = plants.data?.data ?? [];
  const origins = all.filter((p) => (f.kind === 'UPLIFTING' ? p.type === 'FIELD' : p.type !== 'FIELD'));
  const destPlants = all.filter((p) => p.type === 'PLANT');
  useEffect(() => { if (all.length && !origins.some((o) => String(o.id) === f.originId)) setF((s) => ({ ...s, originId: String(origins.find((p) => p.type === 'PLANT')?.id ?? origins[0]?.id ?? '') })); }, [plants.data, f.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (f.kind === 'UPLIFTING' && !f.destPlantId && destPlants.length) setF((s) => ({ ...s, destPlantId: String(destPlants[0].id) })); }, [plants.data, f.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const destId = f.kind === 'UPLIFTING' ? f.destPlantId : f.dist?.location_id;
  const route = useQuery({ queryKey: ['/trips', 'route-preview', f.originId, destId], enabled: !!f.originId && !!destId, queryFn: () => get(`/trips/route-preview${qs({ originId: f.originId, destinationId: destId })}`), staleTime: 300_000 });
  const eta = route.data?.route ? new Date(new Date(f.departure).getTime() + route.data.route.estDurationMin * 60_000) : null;
  const origin = all.find((p: any) => String(p.id) === f.originId);
  const destPlant = all.find((p: any) => String(p.id) === f.destPlantId);
  const income = route.data?.route && f.load ? Math.round(Number(f.load) * Number(route.data.route.freightPerMt)) : null;
  const create = useAction((assignNext: boolean) => post('/trips', {
    originLocationId: Number(f.originId), ...(f.kind === 'UPLIFTING' ? { destinationLocationId: Number(f.destPlantId) } : { distributorId: f.dist.id }), lpgSource: f.source, plannedLoadMt: Number(f.load), priority: f.priority, notes: f.notes || undefined,
    scheduledDeparture: new Date(f.departure).toISOString(), plannedArrival: f.arrival ? new Date(f.arrival).toISOString() : undefined, submit: assignNext,
  }).then((r) => ({ r, assignNext })), { invalidate: ['/trips'], success: (x) => `Trip ${x.r.trip.code} created.`, onSuccess: (x) => nav(`/trips/${x.r.trip.id}${x.assignNext ? '?assign=1' : ''}`) });
  const fe = { ...fieldErrors(create.error), ...touched };

  const validate = (s: number) => {
    const e: Record<string, string> = {};
    if (s === 0) { if (!f.originId) e.originId = 'Choose a loading point.'; if (f.kind === 'DELIVERY' && !f.dist) e.dist = 'Choose the distributor receiving the LPG.'; if (f.kind === 'UPLIFTING' && !f.destPlantId) e.dist = 'Choose the receiving plant.'; }
    if (s >= 1) {
      const n = Number(f.load);
      if (!f.load || !(n > 0)) e.load = 'Enter the planned load in MT.'; else if (n > 60) e.load = 'Maximum is 60 MT.';
      if (!f.departure) e.departure = 'Choose a departure time.';
      if (f.arrival && new Date(f.arrival) <= new Date(f.departure)) e.arrival = 'Arrival must be after departure.';
    }
    setTouched(e); return Object.keys(e).length === 0;
  };
  const next = () => { if (validate(step === 0 ? 0 : 1)) setStep((s) => s + 1); };

  return (
    <>
      <PageHeader title="Create Trip" subtitle="Plan a new LPG delivery, then assign a vehicle and driver" breadcrumbs={[{ label: 'Operations' }, { label: 'Trips', to: '/trips' }, { label: 'New trip' }]} />
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="card px-4 py-5"><Stepper steps={STEPS} current={step} /></div>
        {create.error && !create.error.fields && <Alert tone="danger" title="Could not create trip">{create.error.message}</Alert>}
        {step === 0 && (
          <Section title="What kind of trip is this?" subtitle="Deliveries go from a plant to a distributor; uplifting trips bring LPG from a gas field to a plant">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Trip type">
                {([['DELIVERY', 'Delivery to distributor', 'Plant / terminal / depot → customer'], ['UPLIFTING', 'Uplifting to plant', 'Gas field (e.g. Nashpa, Makori) → plant']] as const).map(([k, t, d]) => (
                  <label key={k} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 ${f.kind === k ? 'border-brand-600 bg-brand-50' : 'border-line hover:bg-slate-50'}`}>
                    <input type="radio" name="kind" className="mt-1" checked={f.kind === k} onChange={() => setF({ ...f, kind: k, dist: null })} /><span><span className="block text-sm font-semibold">{t}</span><span className="block text-xs text-slate-500">{d}</span></span>
                  </label>
                ))}
              </div>
              <SelectInput label={f.kind === 'UPLIFTING' ? 'Uplift source (gas field)' : 'Origin (plant / terminal / depot)'} required value={f.originId} onChange={(e) => setF({ ...f, originId: e.target.value })} error={fe.originId} options={origins.map((p: any) => ({ value: p.id, label: `${p.name}${p.city ? ` (${p.city})` : ''}` }))} placeholder="Select origin" />
              {f.kind === 'DELIVERY'
                ? <div><p className="mb-1 text-xs font-medium text-slate-700">Destination distributor <span className="text-red-500">*</span></p><DistributorPicker value={f.dist} onChange={(d) => setF({ ...f, dist: d })} error={fe.dist} />{fe.dist && <p className="mt-1 text-xs text-red-600">{fe.dist}</p>}</div>
                : <SelectInput label="Receiving plant" required value={f.destPlantId} onChange={(e) => setF({ ...f, destPlantId: e.target.value })} error={fe.dist} options={destPlants.map((p: any) => ({ value: p.id, label: p.name }))} />}
              {route.data?.route && (
                <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-lg bg-slate-50 px-4 py-3 text-sm"><span className="flex items-center gap-2 font-medium"><RouteIcon className="h-4 w-4 text-brand-600" />Route</span>
                  <span><b>{route.data.route.distanceKm}</b> km</span><span><b>{fmtDuration(route.data.route.estDurationMin)}</b> driving time</span>
                  {can('routes:view') && <span>Freight <b>{fmtPkr(route.data.route.freightPerMt)}</b> / MT</span>}</div>
              )}
            </div>
          </Section>
        )}
        {step === 1 && (
          <Section title="Load and schedule" subtitle="Planned quantity and timing">
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectInput label="LPG source" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} options={[{ value: 'LOCAL', label: 'Local LPG' }, { value: 'IMPORTED', label: 'Imported LPG' }]} />
              <TextInput label="Planned load (MT)" required type="number" step="0.1" min="0" value={f.load} onChange={(e) => setF({ ...f, load: e.target.value })} error={fe.load ?? fe.plannedLoadMt} placeholder="e.g. 18" hint="Bowzer capacities in the fleet range 10–22 MT" />
              <TextInput label="Scheduled departure" required type="datetime-local" value={f.departure} onChange={(e) => setF({ ...f, departure: e.target.value })} error={fe.departure ?? fe.scheduledDeparture} />
              <TextInput label="Planned arrival" type="datetime-local" value={f.arrival} onChange={(e) => setF({ ...f, arrival: e.target.value })} error={fe.arrival ?? fe.plannedArrival} hint={eta ? `Left blank = estimated ${fmtDateTime(eta)}` : 'Leave blank to use the route estimate'} />
              <SelectInput label="Priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={[{ value: 'LOW', label: 'Low' }, { value: 'NORMAL', label: 'Normal' }, { value: 'HIGH', label: 'High' }, { value: 'URGENT', label: 'Urgent' }]} />
              <div className="sm:col-span-2"><TextArea label="Notes for dispatch (optional)" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={500} /></div>
            </div>
          </Section>
        )}
        {step === 2 && (
          <Section title="Review" subtitle="Confirm the details. Vehicle and driver are assigned next, with availability, capacity and document checks.">
            <KVGrid cols={2}>
              <KV label="Trip type">{f.kind === 'UPLIFTING' ? 'Uplifting to plant' : 'Delivery to distributor'}</KV>
              <KV label="Origin"><span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-slate-400" />{origin?.name}</span></KV>
              <KV label="Destination">{f.kind === 'UPLIFTING' ? destPlant?.name : f.dist?.name}{f.kind === 'DELIVERY' && <span className="block text-xs text-slate-500">{f.dist?.city} · {regionLabel(f.dist?.region)}</span>}</KV>
              {income !== null && can('finance:view') && <KV label="Expected freight income">{fmtPkr(income)}</KV>}
              <KV label="LPG source">{f.source === 'LOCAL' ? 'Local' : 'Imported'}</KV><KV label="Planned load">{fmtMt(Number(f.load))}</KV>
              <KV label="Departure">{fmtDateTime(f.departure)}</KV><KV label="Arrival">{fmtDateTime(f.arrival || eta)}</KV>
              <KV label="Priority">{f.priority}</KV><KV label="Route">{route.data?.route ? `${route.data.route.distanceKm} km · ${fmtDuration(route.data.route.estDurationMin)}` : '—'}</KV>
              {f.notes && <KV label="Notes" className="col-span-2">{f.notes}</KV>}
            </KVGrid>
          </Section>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button onClick={() => (step === 0 ? nav('/trips') : setStep(step - 1))} icon={<ArrowLeft className="h-4 w-4" />}>{step === 0 ? 'Cancel' : 'Back'}</Button>
          {step < 2 ? <Button variant="primary" onClick={next}>Continue <ArrowRight className="h-4 w-4" /></Button> : (
            <div className="flex flex-wrap gap-2"><Button loading={create.isPending} onClick={() => create.mutate(false)}>Save as draft</Button><Button variant="primary" loading={create.isPending} onClick={() => create.mutate(true)}>Create & assign vehicle</Button></div>
          )}
        </div>
      </div>
    </>
  );
}

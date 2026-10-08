import { useQuery } from '@tanstack/react-query';
import { Route as RouteIcon, Search, Truck, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { StatusPill } from '../ui/Pill';

export function GlobalSearch() {
  const { can } = useAuth(); const nav = useNavigate();
  const [text, setText] = useState(''); const [q, setQ] = useState(''); const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null); const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 250); return () => clearTimeout(t); }, [text]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); } };
    const c = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', k); document.addEventListener('mousedown', c);
    return () => { document.removeEventListener('keydown', k); document.removeEventListener('mousedown', c); };
  }, []);
  const enabled = q.length >= 2;
  const { data, isFetching } = useQuery({
    queryKey: ['/search', q], enabled,
    queryFn: async () => {
      const [t, v, d] = await Promise.all([
        can('trips:view') ? get(`/trips${qs({ q, pageSize: 4 })}`) : { data: [] },
        can('vehicles:view') ? get(`/vehicles${qs({ q, pageSize: 4 })}`) : { data: [] },
        can('drivers:view') ? get(`/drivers${qs({ q, pageSize: 4 })}`) : { data: [] },
      ]);
      return { trips: t.data as any[], vehicles: v.data as any[], drivers: d.data as any[] };
    },
  });
  const go = (to: string) => { setOpen(false); setText(''); nav(to); };
  const empty = data && !data.trips.length && !data.vehicles.length && !data.drivers.length;
  return (
    <div ref={box} className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/70" />
      <input ref={ref} value={text} onChange={(e) => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        placeholder="Search trips, vehicles, drivers…  (Ctrl/⌘ K)" aria-label="Global search"
        className="w-full rounded-lg border border-white/20 bg-white/15 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/70 focus:bg-white focus:text-ink focus:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-white/60" />
      {open && enabled && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-white p-2 text-ink shadow-pop">
          {isFetching && !data && <p className="px-3 py-4 text-sm text-slate-500">Searching…</p>}
          {empty && <p className="px-3 py-4 text-sm text-slate-500">No results for “{q}”.</p>}
          {!!data?.trips.length && <Group title="Trips" icon={<RouteIcon className="h-3.5 w-3.5" />}>{data.trips.map((t) => <Row key={t.id} onClick={() => go(`/trips/${t.id}`)} a={t.code} b={`${t.origin_name} → ${t.destination_name}`} right={<StatusPill status={t.status} />} />)}</Group>}
          {!!data?.vehicles.length && <Group title="Vehicles" icon={<Truck className="h-3.5 w-3.5" />}>{data.vehicles.map((v) => <Row key={v.id} onClick={() => go(`/fleet/${v.id}`)} a={v.code} b={`${v.registration_no} · ${v.capacity_mt} MT`} right={<StatusPill status={v.status} />} />)}</Group>}
          {!!data?.drivers.length && <Group title="Drivers" icon={<UserRound className="h-3.5 w-3.5" />}>{data.drivers.map((d) => <Row key={d.id} onClick={() => go(`/drivers/${d.id}`)} a={d.full_name} b={`${d.employee_id} · ${d.phone ?? ''}`} right={<StatusPill status={d.status} />} />)}</Group>}
        </div>
      )}
    </div>
  );
}
const Group = ({ title, icon, children }: any) => <div className="mb-1"><p className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{icon}{title}</p>{children}</div>;
const Row = ({ a, b, right, onClick }: any) => <button onClick={onClick} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-brand-50"><span className="min-w-0"><span className="block truncate text-sm font-medium">{a}</span><span className="block truncate text-xs text-slate-500">{b}</span></span>{right}</button>;

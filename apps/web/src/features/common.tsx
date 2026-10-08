import { useQuery } from '@tanstack/react-query';
import { Check, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get, qs } from '../lib/api';
import { regionLabel } from '../lib/format';

/** Cached small reference lists used by dropdown filters. */
export const usePlants = () => useQuery({ queryKey: ['/locations', 'plants'], queryFn: () => get('/locations?type=PLANT,TERMINAL,DEPOT,FIELD&all=1'), staleTime: 300_000 });
export const useVehicleOptions = () => useQuery({ queryKey: ['/vehicles', 'options'], queryFn: () => get('/vehicles?pageSize=100&sort=code&dir=asc'), staleTime: 60_000 });
export const useDriverOptions = () => useQuery({ queryKey: ['/drivers', 'options'], queryFn: () => get('/drivers?pageSize=100&sort=name&dir=asc'), staleTime: 60_000 });

/** Async typeahead for distributors (scales to thousands of customers; never loads the full list). */
export function DistributorPicker({ value, onChange, error }: { value: { id: number; name: string; city: string; region: string } | null; onChange: (d: any | null) => void; error?: string }) {
  const [text, setText] = useState(''); const [q, setQ] = useState(''); const [open, setOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQ(text), 200); return () => clearTimeout(t); }, [text]);
  const { data, isFetching } = useQuery({ queryKey: ['/distributors', 'pick', q], queryFn: () => get(`/distributors${qs({ compact: 1, q })}`), enabled: open, staleTime: 30_000 });
  if (value) return (
    <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5">
      <div><p className="text-sm font-semibold">{value.name}</p><p className="text-xs text-slate-600">{value.city} · {regionLabel(value.region)}</p></div>
      <button type="button" onClick={() => onChange(null)} aria-label="Change distributor" className="rounded p-1 text-slate-500 hover:bg-white"><X className="h-4 w-4" /></button>
    </div>
  );
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input className={`input pl-9 ${error ? 'input-error' : ''}`} placeholder="Search distributor by name, city or code…" value={text} onFocus={() => setOpen(true)} onChange={(e) => { setText(e.target.value); setOpen(true); }} aria-label="Distributor" aria-expanded={open} />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-pop" role="listbox">
          {isFetching && !data && <li className="px-3 py-2 text-sm text-slate-500">Searching…</li>}
          {data?.data.map((d: any) => (
            <li key={d.id}><button type="button" role="option" className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-brand-50" onClick={() => { onChange(d); setOpen(false); setText(''); }}>
              <span><span className="block text-sm font-medium">{d.name}</span><span className="block text-xs text-slate-500">{d.city} · {regionLabel(d.region)} · {d.code}</span></span><Check className="h-4 w-4 opacity-0" /></button></li>
          ))}
          {data && !data.data.length && <li className="px-3 py-3 text-sm text-slate-500">No active distributors match.</li>}
        </ul>
      )}
    </div>
  );
}

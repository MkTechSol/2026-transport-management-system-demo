import clsx from 'clsx';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search, X } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import { EmptyState, ErrorState, Skeleton } from './Feedback';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortKey?: string;
  className?: string;
  hideBelow?: 'md' | 'lg';
}

export function DataTable<T>({ columns, rows, loading, error, onRetry, sort, dir, onSort, onRowClick, empty, rowKey, page, pageSize, total, onPage, dense }: {
  columns: Column<T>[]; rows?: T[]; loading?: boolean; error?: unknown; onRetry?: () => void;
  sort?: string; dir?: 'asc' | 'desc'; onSort?: (key: string) => void; onRowClick?: (row: T) => void;
  empty?: { title: string; description?: string; action?: ReactNode }; rowKey: (row: T) => string | number;
  page?: number; pageSize?: number; total?: number; onPage?: (p: number) => void; dense?: boolean;
}) {
  const hide = (c: Column<T>) => (c.hideBelow === 'md' ? 'hidden md:table-cell' : c.hideBelow === 'lg' ? 'hidden lg:table-cell' : '');
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead className="border-b border-line bg-slate-50/70">
            <tr>
              {columns.map((c) => {
                const active = c.sortKey && sort === c.sortKey;
                return (
                  <th key={c.key} className={clsx('th', hide(c), c.className)} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sortKey && onSort ? (
                      <button onClick={() => onSort(c.sortKey!)} className="inline-flex items-center gap-1 uppercase hover:text-slate-800">
                        {c.header}{active ? (dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                      </button>
                    ) : c.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && !rows?.length && Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>{columns.map((c) => <td key={c.key} className={clsx('td', hide(c))}><Skeleton className="h-4 w-full max-w-[9rem]" /></td>)}</tr>
            ))}
            {rows?.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                  onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r); } : undefined} tabIndex={onRowClick ? 0 : undefined}
                  className={clsx('transition-colors', onRowClick && 'cursor-pointer hover:bg-brand-50/50 focus-visible:bg-brand-50/60', loading && 'opacity-60')}>
                {columns.map((c) => <td key={c.key} className={clsx('td', dense && 'py-2', hide(c), c.className)}>{c.render(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? <ErrorState error={error} onRetry={onRetry} /> : null}
      {!loading && !error && rows && rows.length === 0 && <EmptyState title={empty?.title ?? 'Nothing to show'} description={empty?.description ?? 'Try adjusting your search or filters.'} action={empty?.action} />}
      {page && pageSize && total !== undefined && onPage && <Pagination page={page} pageSize={pageSize} total={total} onPage={onPage} />}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const nums: (number | '…')[] = [];
  for (let p = 1; p <= pages; p++) if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p); else if (nums[nums.length - 1] !== '…') nums.push('…');
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-slate-600">
      <span>Showing <b className="font-semibold text-ink">{from}–{to}</b> of <b className="font-semibold text-ink">{total.toLocaleString()}</b></span>
      <nav className="flex items-center gap-1" aria-label="Pagination">
        <button aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-md border border-slate-300 p-1.5 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
        {nums.map((n, i) => n === '…' ? <span key={`e${i}`} className="px-1.5">…</span> : (
          <button key={n} onClick={() => onPage(n)} aria-current={n === page ? 'page' : undefined}
            className={clsx('min-w-[2rem] rounded-md border px-2 py-1 text-sm', n === page ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 hover:bg-slate-50')}>{n}</button>
        ))}
        <button aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)} className="rounded-md border border-slate-300 p-1.5 hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
      </nav>
    </div>
  );
}

/** Debounced search box used by every list. */
export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  useEffect(() => { if (v === value) return; const t = setTimeout(() => onChange(v), 300); return () => clearTimeout(t); }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={clsx('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input type="search" aria-label={placeholder} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="input pl-9 pr-8" />
      {v && <button aria-label="Clear search" onClick={() => { setV(''); onChange(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>}
    </div>
  );
}

export function FilterBar({ children, onClear, active }: { children: ReactNode; onClear?: () => void; active?: boolean }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {children}
      {active && onClear && <button onClick={onClear} className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"><X className="h-3.5 w-3.5" />Clear filters</button>}
    </div>
  );
}

import clsx from 'clsx';
import { ChevronRight, Home } from 'lucide-react';
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from './Feedback';

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
      <Link to="/" aria-label="Home" className="hover:text-brand-700"><Home className="h-3.5 w-3.5" /></Link>
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1"><ChevronRight className="h-3 w-3" />{it.to ? <Link to={it.to} className="hover:text-brand-700">{it.label}</Link> : <span className="font-medium text-brand-700">{it.label}</span>}</span>
      ))}
    </nav>
  );
}

export function PageHeader({ title, subtitle, breadcrumbs, actions, badge }: { title: ReactNode; subtitle?: ReactNode; breadcrumbs?: { label: string; to?: string }[]; actions?: ReactNode; badge?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
        <div className="flex flex-wrap items-center gap-3"><h1 className="truncate text-2xl font-semibold text-ink">{title}</h1>{badge}</div>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, subtitle, actions, children, className, padded = true }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <div><h2 className="text-sm font-semibold text-ink">{title}</h2>{subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}</div>
          {actions}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function KpiCard({ label, value, hint, icon, tone = 'blue', to, loading }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'slate'; to?: string; loading?: boolean }) {
  const t = { blue: 'bg-blue-50 text-blue-600', green: 'bg-green-50 text-green-600', amber: 'bg-amber-50 text-amber-600', red: 'bg-red-50 text-red-600', purple: 'bg-violet-50 text-violet-600', slate: 'bg-slate-100 text-slate-600' }[tone];
  const body = (
    <div className={clsx('card h-full p-4 transition-shadow', to && 'hover:shadow-md')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium leading-tight text-slate-500">{label}</p>
          {loading ? <Skeleton className="mt-2 h-8 w-16" /> : <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>}
          {hint && <p className="mt-1 text-[11px] leading-tight text-slate-500">{hint}</p>}
        </div>
        {icon && <div className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', t)}>{icon}</div>}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block rounded-xl focus-visible:ring-2">{body}</Link> : body;
}

export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: string; count?: number }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}
          className={clsx('-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors', value === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ steps, current }: { steps: { key: string; label: string }[]; current: number }) {
  return (
    <ol className="flex w-full items-start overflow-x-auto pb-1" aria-label="Trip progress">
      {steps.map((s, i) => {
        const done = i < current; const active = i === current;
        return (
          <li key={s.key} className="relative flex min-w-[5.2rem] flex-1 flex-col items-center text-center" aria-current={active ? 'step' : undefined}>
            {i > 0 && <span className={clsx('absolute left-[-50%] top-3.5 h-0.5 w-full', i <= current ? 'bg-green-600' : 'bg-slate-200')} aria-hidden />}
            <span className={clsx('relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ring-4 ring-white', done ? 'bg-green-600 text-white' : active ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500')}>{done ? '✓' : i + 1}</span>
            <span className={clsx('mt-1.5 px-1 text-[11px] font-medium uppercase tracking-wide', active ? 'text-brand-700' : done ? 'text-green-700' : 'text-slate-400')}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function KV({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div className={className}><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-0.5 text-sm text-ink">{children ?? '—'}</dd></div>;
}
export const KVGrid = ({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 | 4 }) => <dl className={clsx('grid gap-x-6 gap-y-4 grid-cols-2', cols === 3 && 'md:grid-cols-3', cols === 4 && 'md:grid-cols-4')}>{children}</dl>;

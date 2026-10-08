import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, Loader2, Inbox, XCircle } from 'lucide-react';
import { ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { Button } from './Button';

export function Spinner({ className }: { className?: string }) { return <Loader2 className={clsx('h-5 w-5 animate-spin text-brand-600', className)} aria-label="Loading" />; }
export const Skeleton = ({ className }: { className?: string }) => <div className={clsx('skeleton', className)} />;

export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex h-64 items-center justify-center gap-3 text-sm text-slate-500" role="status"><Spinner /> {label}</div>;
}

const A = {
  info: { c: 'border-blue-200 bg-blue-50 text-blue-900', i: Info },
  success: { c: 'border-green-200 bg-green-50 text-green-900', i: CheckCircle2 },
  warning: { c: 'border-amber-200 bg-amber-50 text-amber-900', i: AlertTriangle },
  danger: { c: 'border-red-200 bg-red-50 text-red-900', i: XCircle },
};
export function Alert({ tone = 'info', title, children, className }: { tone?: keyof typeof A; title?: string; children?: ReactNode; className?: string }) {
  const I = A[tone].i;
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={clsx('flex gap-3 rounded-lg border px-4 py-3 text-sm', A[tone].c, className)}>
      <I className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{title && <p className="font-semibold">{title}</p>}{children && <div className={clsx(title && 'mt-0.5', 'text-[13px] leading-relaxed')}>{children}</div>}</div>
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : 'Something went wrong while loading this data.';
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500"><XCircle className="h-6 w-6" /></div>
      <p className="text-sm font-semibold text-ink">We couldn’t load this</p>
      <p className="mt-1 max-w-md text-sm text-slate-500">{msg}</p>
      {onRetry && <Button className="mt-4" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function ProgressBar({ value, tone = 'blue', className }: { value: number; tone?: 'blue' | 'red' | 'green' | 'amber'; className?: string }) {
  const c = { blue: 'bg-brand-600', red: 'bg-red-500', green: 'bg-green-500', amber: 'bg-amber-500' }[tone];
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-slate-200', className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={clsx('h-full rounded-full transition-all duration-700', c)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

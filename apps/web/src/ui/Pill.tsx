import clsx from 'clsx';
import { TRIP_STATUS_LABELS } from '@gasman/shared';
import { titleCase } from '../lib/format';

type Tone = 'blue' | 'green' | 'amber' | 'red' | 'slate' | 'purple' | 'teal';
const TONES: Record<Tone, string> = {
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  green: 'bg-green-50 text-green-700 ring-green-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200',
  teal: 'bg-teal-50 text-teal-700 ring-teal-200',
};
const DOT: Record<Tone, string> = { blue: 'bg-blue-500', green: 'bg-green-500', amber: 'bg-amber-500', red: 'bg-red-500', slate: 'bg-slate-400', purple: 'bg-violet-500', teal: 'bg-teal-500' };

export function Pill({ tone = 'slate', children, dot = true, className }: { tone?: Tone; children: React.ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', TONES[tone], className)}>
      {dot && <span className={clsx('h-1.5 w-1.5 rounded-full', DOT[tone])} />}
      {children}
    </span>
  );
}

const TONE_MAP: Record<string, Tone> = {
  // trips
  DRAFT: 'slate', PLANNED: 'blue', ASSIGNED: 'purple', DISPATCHED: 'teal', IN_TRANSIT: 'blue', DELAYED: 'red', ON_HOLD: 'amber', ARRIVED: 'purple', DELIVERED: 'green', RETURNING: 'teal', COMPLETED: 'green', CANCELLED: 'slate',
  // vehicles / drivers
  AVAILABLE: 'green', ON_TRIP: 'blue', MAINTENANCE: 'amber', INACTIVE: 'slate', OFF_DUTY: 'slate', ON_LEAVE: 'amber', SUSPENDED: 'red',
  // docs
  ACTIVE: 'green', EXPIRING_SOON: 'amber', EXPIRED: 'red',
  // maintenance / incidents / generic
  SCHEDULED: 'blue', IN_PROGRESS: 'amber', OPEN: 'red', INVESTIGATING: 'amber', CLOSED: 'green', PASS: 'green', FAIL: 'red',
  LOW: 'slate', MEDIUM: 'amber', HIGH: 'red', CRITICAL: 'red', NORMAL: 'slate', URGENT: 'red',
  OWNED: 'blue', HIRED: 'purple', GOOD: 'green', WATCH: 'amber', BLOCKED: 'red', DISABLED: 'slate', ON_HOLD_DIST: 'amber',
};
export function StatusPill({ status, label }: { status?: string | null; label?: string }) {
  if (!status) return <span className="text-slate-400">—</span>;
  const text = label ?? (TRIP_STATUS_LABELS as Record<string, string>)[status] ?? titleCase(status);
  return <Pill tone={TONE_MAP[status] ?? 'slate'}>{text}</Pill>;
}

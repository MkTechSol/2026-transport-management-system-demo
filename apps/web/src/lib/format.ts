const TZ = 'Asia/Karachi';
const d = (v: string | Date | null | undefined) => (v ? new Date(v) : null);

export const fmtDate = (v?: string | Date | null) => {
  const x = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00Z') : d(v);
  return x ? x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: typeof v === 'string' && v.length === 10 ? 'UTC' : TZ }) : '—';
};
export const fmtTime = (v?: string | Date | null) => { const x = d(v); return x ? x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }) : '—'; };
export const fmtDateTime = (v?: string | Date | null) => { const x = d(v); return x ? `${fmtDate(x)}, ${fmtTime(x)}` : '—'; };
export const fmtShortDateTime = (v?: string | Date | null) => { const x = d(v); return x ? x.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }) : '—'; };

export const fmtMt = (v?: number | string | null, digits = 1) => (v == null ? '—' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: digits })} MT`);
export const fmtNum = (v?: number | string | null) => (v == null ? '—' : Number(v).toLocaleString('en-US'));
export const fmtPkr = (v?: number | string | null) => (v == null ? '—' : `PKR ${Number(v).toLocaleString('en-US')}`);

export function fmtDuration(minutes?: number | null) {
  if (minutes == null || Number.isNaN(minutes)) return '—';
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}
export function minutesUntil(v?: string | null) { return v ? (new Date(v).getTime() - Date.now()) / 60000 : null; }
export function fmtEta(v?: string | null) { const m = minutesUntil(v); return m == null ? '—' : m <= 0 ? 'Due' : fmtDuration(m); }

export function timeAgo(v?: string | Date | null) {
  const x = d(v); if (!x) return '—';
  const s = Math.max(0, Math.round((Date.now() - x.getTime()) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)} d ago`;
  return fmtDate(x);
}
export const titleCase = (s?: string | null) => (s ? s.toLowerCase().replace(/_/g, ' ').replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : '—');
export const regionLabel = (r?: string | null) => (r === 'KPK' ? 'KPK' : r === 'AJK' ? 'AJK' : r === 'GILGIT_BALTISTAN' ? 'Gilgit-Baltistan' : titleCase(r));
export const toLocalInput = (v: Date) => { const p = (n: number) => String(n).padStart(2, '0'); return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}T${p(v.getHours())}:${p(v.getMinutes())}`; };

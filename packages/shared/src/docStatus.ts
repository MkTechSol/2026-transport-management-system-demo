export type DocStatus = 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED';
export const EXPIRING_SOON_DAYS = 30;

const DAY = 86_400_000;

/** Calendar-day aware status. `expiry` is a YYYY-MM-DD string or Date. */
export function documentStatus(expiry: string | Date, now: Date = new Date()): DocStatus {
  const e = typeof expiry === 'string' ? Date.parse(expiry.slice(0, 10) + 'T00:00:00Z') : expiry.getTime();
  const today = Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00Z');
  const days = Math.round((e - today) / DAY);
  if (days < 0) return 'EXPIRED';
  if (days <= EXPIRING_SOON_DAYS) return 'EXPIRING_SOON';
  return 'ACTIVE';
}

export function daysUntil(expiry: string | Date, now: Date = new Date()): number {
  const e = typeof expiry === 'string' ? Date.parse(expiry.slice(0, 10) + 'T00:00:00Z') : expiry.getTime();
  const today = Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00Z');
  return Math.round((e - today) / DAY);
}

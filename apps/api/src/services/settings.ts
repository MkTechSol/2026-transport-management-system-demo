import { q, q1, exec } from '../db/sequelize';
import { TtlCache } from '../lib/cache';

/** Defaults are the demo assumptions; every one can be changed by an admin in Settings → Transportation. */
export const SETTING_DEFAULTS: Record<string, { value: unknown; label: string; description: string; group: string }> = {
  'trip.requirePretripCheck': { value: true, label: 'Require pre-trip safety check', description: 'A passed pre-trip checklist is required before a trip can depart.', group: 'Trips' },
  'trip.delayThresholdMin': { value: 30, label: 'Delay alert threshold (minutes)', description: 'A trip is flagged delayed when its projected arrival is this far behind plan.', group: 'Trips' },
  'trip.onTimeToleranceMin': { value: 15, label: 'On-time tolerance (minutes)', description: 'Arrivals within this tolerance of plan count as on time.', group: 'Trips' },
  'trip.turnaroundHours': { value: 2, label: 'Turnaround time (hours)', description: 'Added to the round trip when checking vehicle / driver availability windows.', group: 'Trips' },
  'trip.stopDwellMin': { value: 45, label: 'Time per delivery stop (minutes)', description: 'Unloading / paperwork time added to the ETA for every drop on a multi-stop trip.', group: 'Trips' },
  'expense.autoApproveLimit': { value: 5000, label: 'Expense auto-approval limit (PKR)', description: 'Trip expenses at or below this amount are approved automatically.', group: 'Expenses' },
  'fuel.varianceThresholdPct': { value: 20, label: 'Fuel variance threshold (%)', description: 'Fuel entries more than this % above the expected litres are flagged for review.', group: 'Fuel' },
  'fuel.defaultKmpl': { value: 2.6, label: 'Default bowzer fuel norm (km/litre)', description: 'Used when a vehicle has no specific norm.', group: 'Fuel' },
  'docs.expiringSoonDays': { value: 30, label: 'Document "expiring soon" window (days)', description: 'Documents expiring within this window raise alerts.', group: 'Compliance' },
  'finance.paymentTermsDays': { value: 30, label: 'Default customer payment terms (days)', description: 'Invoice due date = invoice date + terms.', group: 'Finance' },
  'finance.freightTaxPct': { value: 0, label: 'Freight sales tax (%)', description: 'Added to freight invoices. Confirm the applicable rate with GasMan finance.', group: 'Finance' },
  'inventory.lowStockAlert': { value: true, label: 'Low-stock alerts', description: 'Raise exceptions when stock falls below the item minimum level.', group: 'Inventory' },
};

const cache = new TtlCache<Record<string, unknown>>(5000);

export async function allSettings(): Promise<Record<string, unknown>> {
  return cache.get('all', async () => {
    const rows = await q<{ key: string; value: unknown }>('SELECT key, value FROM settings');
    const out: Record<string, unknown> = {};
    for (const [k, d] of Object.entries(SETTING_DEFAULTS)) out[k] = d.value;
    for (const r of rows) out[r.key] = r.value;
    return out;
  });
}
export async function setting<T = number>(key: string): Promise<T> { return (await allSettings())[key] as T; }
export const bustSettings = () => cache.clear();

export async function seedSettings() {
  for (const [key, d] of Object.entries(SETTING_DEFAULTS))
    await exec(`INSERT INTO settings (key, value, label, description, group_name) VALUES (:k, :v, :l, :d, :g) ON CONFLICT (key) DO NOTHING`, { k: key, v: JSON.stringify(d.value), l: d.label, d: d.description, g: d.group });
}
export const _q1 = q1;

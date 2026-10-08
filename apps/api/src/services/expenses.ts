import type { Request } from 'express';
import { EXPENSE_CATEGORY_LABELS } from '@gasman/shared';
import { q1, exec } from '../db/sequelize';
import { badRequest, forbidden, notFound, unprocessable } from '../lib/errors';
import type { AuthUser } from '../middleware/auth';
import { audit } from './audit';
import { registerApprovalHandler, requestApproval } from './approvals';
import { setting } from './settings';
import { postHooks } from './hooks';

export interface ExpenseInput {
  tripId: number; category: string; amount: number; nights?: number; description?: string; receiptNo?: string; incurredOn?: string; fuelEntryId?: number; forceApproval?: boolean;
}

/** Records a trip expense. Amounts <= the auto-approval limit are approved immediately; larger ones go through the approval workflow. */
export async function createExpense(user: AuthUser | null, req: Request | undefined, input: ExpenseInput, tx?: any) {
  const t = await q1<any>('SELECT id, code, status, vehicle_id, driver_id FROM trips WHERE id = :id', { id: input.tripId }, tx);
  if (!t) throw notFound('Trip');
  if (user?.role === 'DRIVER' && t.driver_id !== user.driverId) throw forbidden('You can only record expenses for your own trips.');
  if (['DRAFT', 'PLANNED', 'ASSIGNED', 'CANCELLED'].includes(t.status)) throw unprocessable(`Expenses can be recorded once the trip is dispatched (Trip ${t.code} is ${t.status.toLowerCase()}).`);
  if (input.category === 'TOUR_STAY' && !(input.nights && input.nights > 0)) throw badRequest('Enter the number of nights for a tour stay.', { fields: { nights: 'Required for tour stay' } });
  const limit = await setting<number>('expense.autoApproveLimit');
  const auto = !input.forceApproval && input.amount <= limit;
  const row = await q1<any>(
    `INSERT INTO trip_expenses (trip_id, vehicle_id, driver_id, category, amount, nights, description, receipt_no, incurred_on, status, submitted_by, decided_at, decision_note, fuel_entry_id)
     VALUES (:t, :v, :d, :c, :a, :n, :desc, :rc, COALESCE(:on, CURRENT_DATE), :st, :u, :da, :dn, :fe) RETURNING *`,
    { t: t.id, v: t.vehicle_id, d: t.driver_id, c: input.category, a: Math.round(input.amount), n: input.nights ?? null, desc: input.description ?? null, rc: input.receiptNo ?? null, on: input.incurredOn ?? null,
      st: auto ? 'APPROVED' : 'SUBMITTED', u: user?.id ?? null, da: auto ? new Date().toISOString() : null, dn: auto ? 'Auto-approved (within limit)' : null, fe: input.fuelEntryId ?? null }, tx);
  await audit(req, { action: 'EXPENSE_RECORDED', entityType: 'TRIP', entityId: t.id, entityLabel: `${t.code}: ${EXPENSE_CATEGORY_LABELS[input.category]} PKR ${input.amount}`, tx });
  if (auto) await postHooks.expenseApproved?.(row, tx);
  else await requestApproval({ entityType: 'TRIP_EXPENSE', entityId: row.id, title: `${t.code} · ${EXPENSE_CATEGORY_LABELS[input.category] ?? input.category}`, amount: row.amount, requestedBy: user?.id, tx });
  return row;
}

registerApprovalHandler('TRIP_EXPENSE', {
  async onApproved(id, { tx, user }) {
    const e = await q1<any>(`UPDATE trip_expenses SET status = 'APPROVED', decided_by = :u, decided_at = now(), updated_at = now() WHERE id = :id RETURNING *`, { u: user.id, id }, tx);
    await postHooks.expenseApproved?.(e, tx);
  },
  async onRejected(id, { tx, user, note }) {
    await exec(`UPDATE trip_expenses SET status = 'REJECTED', decided_by = :u, decided_at = now(), decision_note = :n, updated_at = now() WHERE id = :id`, { u: user.id, n: note ?? null, id }, tx);
  },
});

/** Totals for a trip, used by trip detail and profitability reports. */
export async function tripEconomics(tripId: number, tx?: any) {
  const t = await q1<any>(
    `SELECT t.id, t.status, t.freight_per_mt, t.planned_load_mt, t.loaded_mt, t.delivered_mt, t.odometer_start, t.odometer_end, r.distance_km,
            COALESCE(e.approved, 0)::float AS expenses_approved, COALESCE(e.pending, 0)::float AS expenses_pending
       FROM trips t LEFT JOIN routes r ON r.id = t.route_id
       LEFT JOIN LATERAL (SELECT sum(amount) FILTER (WHERE status IN ('APPROVED','REIMBURSED')) AS approved, sum(amount) FILTER (WHERE status = 'SUBMITTED') AS pending FROM trip_expenses WHERE trip_id = t.id) e ON true
      WHERE t.id = :id`, { id: tripId }, tx);
  if (!t) throw notFound('Trip');
  const actual = t.delivered_mt != null;
  const mt = Number(t.delivered_mt ?? t.loaded_mt ?? t.planned_load_mt);
  const income = Math.round(mt * Number(t.freight_per_mt));
  const profit = income - t.expenses_approved;
  const km = t.odometer_start != null && t.odometer_end != null ? t.odometer_end - t.odometer_start : null;
  return { freightPerMt: Number(t.freight_per_mt), billableMt: mt, incomeBasis: actual ? 'ACTUAL' : 'EXPECTED', income, expensesApproved: t.expenses_approved, expensesPending: t.expenses_pending, profit, marginPct: income > 0 ? Math.round((profit / income) * 1000) / 10 : null, km };
}

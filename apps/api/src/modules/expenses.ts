import { Router } from 'express';
import { z } from 'zod';
import { EXPENSE_CATEGORIES, EXPENSE_STATUSES } from '@gasman/shared';
import { q, q1, exec } from '../db/sequelize';
import { forbidden, notFound, conflict } from '../lib/errors';
import { id, likeTerm, listResponse, orderBy, paging, parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';
import { createExpense } from '../services/expenses';

export const expensesRouter = Router();

expensesRouter.get('/', requirePerm('expenses:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ status: z.string().optional(), category: z.string().optional(), tripId: z.coerce.number().optional(), vehicleId: z.coerce.number().optional(), from: z.string().optional(), to: z.string().optional() }), req.query);
  const where = ['1=1']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (f.status) { where.push('x.status IN (:st)'); r.st = f.status.split(','); }
  if (f.category) { where.push('x.category = :cat'); r.cat = f.category; }
  if (f.tripId) { where.push('x.trip_id = :t'); r.t = f.tripId; }
  if (f.vehicleId) { where.push('x.vehicle_id = :v'); r.v = f.vehicleId; }
  if (f.from) { where.push('x.incurred_on >= :from'); r.from = f.from; }
  if (f.to) { where.push('x.incurred_on <= :to'); r.to = f.to; }
  if (req.user!.role === 'DRIVER') { where.push('x.driver_id = :me'); r.me = req.user!.driverId ?? -1; }
  if (p.q) { where.push('(t.code ILIKE :q OR v.code ILIKE :q OR x.description ILIKE :q OR dr.full_name ILIKE :q)'); r.q = likeTerm(p.q); }
  const w = where.join(' AND ');
  const from = `FROM trip_expenses x JOIN trips t ON t.id = x.trip_id LEFT JOIN vehicles v ON v.id = x.vehicle_id LEFT JOIN drivers dr ON dr.id = x.driver_id LEFT JOIN users u ON u.id = x.submitted_by WHERE ${w}`;
  const [rows, [{ total }], [sum]] = await Promise.all([
    q(`SELECT x.*, t.code AS trip_code, v.code AS vehicle_code, dr.full_name AS driver_name, u.full_name AS submitted_by_name
         ${from} ORDER BY ${orderBy(p.sort, p.dir, { date: 'x.incurred_on', amount: 'x.amount', status: 'x.status', trip: 't.code' }, 'x.created_at DESC')} LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total ${from}`, r),
    q(`SELECT COALESCE(sum(x.amount) FILTER (WHERE x.status = 'SUBMITTED'), 0)::float AS pending_amount, count(*) FILTER (WHERE x.status = 'SUBMITTED')::int AS pending_count,
              COALESCE(sum(x.amount) FILTER (WHERE x.status IN ('APPROVED','REIMBURSED')), 0)::float AS approved_amount, COALESCE(sum(x.amount) FILTER (WHERE x.status = 'REJECTED'), 0)::float AS rejected_amount
         ${from}`, r),
  ]);
  const byCategory = await q(`SELECT x.category, sum(x.amount)::float AS amount, count(*)::int AS n ${from} AND x.status IN ('APPROVED','REIMBURSED','SUBMITTED') GROUP BY x.category ORDER BY amount DESC`, r);
  res.json({ ...listResponse(rows, total, p.page, p.pageSize), summary: sum, byCategory });
}));

const body = z.object({
  tripId: z.coerce.number().int().positive(),
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.coerce.number().positive('Enter an amount greater than zero.').max(5_000_000),
  nights: z.coerce.number().int().min(1).max(30).optional(),
  description: z.string().trim().max(250).optional(),
  receiptNo: z.string().trim().max(40).optional(),
  incurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

expensesRouter.post('/', requirePerm('expenses:record'), wrap(async (req, res) => {
  const b = parse(body, req.body);
  const row = await createExpense(req.user!, req, b);
  res.status(201).json({ expense: row });
}));

expensesRouter.delete('/:id', requirePerm('expenses:record'), wrap(async (req, res) => {
  const eid = id(req);
  const e = await q1<any>('SELECT x.*, t.code AS trip_code FROM trip_expenses x JOIN trips t ON t.id = x.trip_id WHERE x.id = :id', { id: eid });
  if (!e) throw notFound('Expense');
  if (e.status !== 'SUBMITTED') throw conflict('Only expenses that are still awaiting approval can be removed.');
  if (req.user!.role !== 'SUPER_ADMIN' && req.user!.role !== 'TRANSPORT_MANAGER' && e.submitted_by !== req.user!.id) throw forbidden('You can only remove expenses you submitted.');
  await exec(`UPDATE approvals SET status = 'CANCELLED' WHERE entity_type = 'TRIP_EXPENSE' AND entity_id = :id AND status = 'PENDING'`, { id: eid });
  await exec('DELETE FROM trip_expenses WHERE id = :id', { id: eid });
  await audit(req, { action: 'EXPENSE_REMOVED', entityType: 'TRIP', entityId: e.trip_id, entityLabel: e.trip_code });
  res.json({ ok: true });
}));
export const _s = EXPENSE_STATUSES;

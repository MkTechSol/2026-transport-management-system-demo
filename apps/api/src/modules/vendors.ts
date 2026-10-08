import { Router } from 'express';
import { z } from 'zod';
import { q, q1 } from '../db/sequelize';
import { conflict, notFound } from '../lib/errors';
import { id, likeTerm, listResponse, paging, parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';
import { can } from '@gasman/shared';

export const vendorsRouter = Router();
const CATS = ['SUPPLIER', 'TRANSPORTER', 'WORKSHOP', 'FUEL_STATION', 'REFINERY', 'SERVICE', 'OTHER'] as const;

vendorsRouter.get('/', requirePerm('vendors:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const cat = typeof req.query.category === 'string' ? req.query.category : undefined;
  const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset }; const where = ['1=1'];
  if (cat) { where.push('v.category = :cat'); r.cat = cat; }
  if (req.query.active === '1') where.push('v.active');
  if (p.q) { where.push('(v.name ILIKE :q OR v.code ILIKE :q OR v.city ILIKE :q)'); r.q = likeTerm(p.q); }
  const from = `FROM vendors v WHERE ${where.join(' AND ')}`;
  const canFinance = can(req.user!.role, 'finance:view');
  const [rows, [{ total }]] = await Promise.all([
    q(`SELECT v.*${canFinance ? `, COALESCE((SELECT sum(l.credit - l.debit) FROM voucher_lines l JOIN vouchers x ON x.id = l.voucher_id AND x.status = 'POSTED' WHERE l.party_type = 'VENDOR' AND l.party_id = v.id AND l.account_id = (SELECT id FROM accounts WHERE system_key = 'payable')), 0)::float AS payable` : ''}
        ${from} ORDER BY v.name LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total ${from}`, r),
  ]);
  res.json(listResponse(rows, total, p.page, p.pageSize));
}));

const body = z.object({
  name: z.string().trim().min(2).max(150), category: z.enum(CATS).default('SUPPLIER'), contactName: z.string().trim().max(120).optional(), phone: z.string().trim().max(30).optional(), email: z.string().trim().email().max(120).optional().or(z.literal('')),
  city: z.string().trim().max(80).optional(), address: z.string().trim().max(250).optional(), ntn: z.string().trim().max(30).optional(), paymentTermsDays: z.coerce.number().int().min(0).max(365).default(0),
});
vendorsRouter.post('/', requirePerm('vendors:manage'), wrap(async (req, res) => {
  const b = parse(body, req.body);
  const n = await q1<{ n: number }>(`SELECT count(*)::int + 1 AS n FROM vendors`);
  const row = await q1<any>(`INSERT INTO vendors (code, name, category, contact_name, phone, email, city, address, ntn, payment_terms_days) VALUES (:c, :n, :cat, :cn, :ph, :em, :ci, :ad, :ntn, :pt) RETURNING *`,
    { c: `VND-${String(n!.n).padStart(4, '0')}`, n: b.name, cat: b.category, cn: b.contactName ?? null, ph: b.phone ?? null, em: b.email || null, ci: b.city ?? null, ad: b.address ?? null, ntn: b.ntn ?? null, pt: b.paymentTermsDays });
  await audit(req, { action: 'VENDOR_CREATED', entityType: 'VENDOR', entityId: row.id, entityLabel: row.name });
  res.status(201).json({ vendor: row });
}));
vendorsRouter.patch('/:id', requirePerm('vendors:manage'), wrap(async (req, res) => {
  const b = parse(body.partial().extend({ active: z.boolean().optional() }), req.body);
  const row = await q1<any>(`UPDATE vendors SET name = COALESCE(:n, name), category = COALESCE(:cat, category), contact_name = COALESCE(:cn, contact_name), phone = COALESCE(:ph, phone), email = COALESCE(:em, email), city = COALESCE(:ci, city),
      address = COALESCE(:ad, address), ntn = COALESCE(:ntn, ntn), payment_terms_days = COALESCE(:pt, payment_terms_days), active = COALESCE(:act, active) WHERE id = :id RETURNING *`,
    { n: b.name ?? null, cat: b.category ?? null, cn: b.contactName ?? null, ph: b.phone ?? null, em: b.email || null, ci: b.city ?? null, ad: b.address ?? null, ntn: b.ntn ?? null, pt: b.paymentTermsDays ?? null, act: b.active ?? null, id: id(req) });
  if (!row) throw notFound('Vendor');
  await audit(req, { action: 'VENDOR_UPDATED', entityType: 'VENDOR', entityId: row.id, entityLabel: row.name });
  res.json({ vendor: row });
}));
void conflict;

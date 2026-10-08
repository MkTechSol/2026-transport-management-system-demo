import { Router } from 'express';
import { z } from 'zod';
import { DOC_TYPES } from '@gasman/shared';
import { q, q1, exec } from '../db/sequelize';
import { badRequest, notFound } from '../lib/errors';
import { id, likeTerm, listResponse, orderBy, paging, parse, wrap } from '../lib/http';
import { docStatusSql } from '../lib/sql';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';

export const documentsRouter = Router();
const ALL_TYPES = [...DOC_TYPES.VEHICLE, ...DOC_TYPES.DRIVER] as string[];

documentsRouter.get('/', requirePerm('documents:view'), wrap(async (req, res) => {
  const p = paging(req.query);
  const f = parse(z.object({ owner: z.enum(['VEHICLE', 'DRIVER']).optional(), docType: z.string().optional(), status: z.string().optional(), ownerId: z.coerce.number().optional() }), req.query);
  const where = ['COALESCE(v.archived_at, dr.archived_at) IS NULL']; const r: Record<string, unknown> = { lim: p.pageSize, off: p.offset };
  if (f.owner === 'VEHICLE') where.push('d.vehicle_id IS NOT NULL'); if (f.owner === 'DRIVER') where.push('d.driver_id IS NOT NULL');
  if (f.docType) { where.push('d.doc_type = :dt'); r.dt = f.docType; }
  if (f.ownerId) { where.push('(d.vehicle_id = :oid OR d.driver_id = :oid)'); r.oid = f.ownerId; }
  if (f.status) { where.push(`${docStatusSql('d')} IN (:st)`); r.st = f.status.split(','); }
  if (req.user!.role === 'DRIVER') { where.push('d.driver_id = :me'); r.me = req.user!.driverId ?? -1; }
  if (p.q) { where.push('(v.code ILIKE :q OR dr.full_name ILIKE :q OR d.doc_number ILIKE :q)'); r.q = likeTerm(p.q); }
  // Only the latest document of each type per owner counts as "current".
  where.push(`NOT EXISTS (SELECT 1 FROM documents n WHERE n.doc_type = d.doc_type AND n.expires_on > d.expires_on AND n.vehicle_id IS NOT DISTINCT FROM d.vehicle_id AND n.driver_id IS NOT DISTINCT FROM d.driver_id)`);
  const w = where.join(' AND ');
  const from = `FROM documents d LEFT JOIN vehicles v ON v.id = d.vehicle_id LEFT JOIN drivers dr ON dr.id = d.driver_id WHERE ${w}`;
  const [rows, [{ total }], [summary]] = await Promise.all([
    q(`SELECT d.id, d.doc_type, d.doc_number, d.issued_on, d.expires_on, d.issuer, ${docStatusSql('d')} AS status, (d.expires_on - CURRENT_DATE)::int AS days_left,
              d.vehicle_id, v.code AS vehicle_code, d.driver_id, dr.full_name AS driver_name
         ${from} ORDER BY ${orderBy(p.sort, p.dir, { expiry: 'd.expires_on', type: 'd.doc_type' }, 'd.expires_on ASC')} LIMIT :lim OFFSET :off`, r),
    q(`SELECT count(*)::int AS total ${from}`, r),
    q(`SELECT count(*) FILTER (WHERE d.expires_on < CURRENT_DATE)::int AS expired, count(*) FILTER (WHERE d.expires_on >= CURRENT_DATE AND d.expires_on <= CURRENT_DATE + 30)::int AS expiring,
              count(*) FILTER (WHERE d.expires_on > CURRENT_DATE + 30)::int AS active FROM documents d LEFT JOIN vehicles v ON v.id = d.vehicle_id LEFT JOIN drivers dr ON dr.id = d.driver_id
        WHERE COALESCE(v.archived_at, dr.archived_at) IS NULL AND NOT EXISTS (SELECT 1 FROM documents n WHERE n.doc_type = d.doc_type AND n.expires_on > d.expires_on AND n.vehicle_id IS NOT DISTINCT FROM d.vehicle_id AND n.driver_id IS NOT DISTINCT FROM d.driver_id)`),
  ]);
  res.json({ ...listResponse(rows, total, p.page, p.pageSize), summary });
}));

const body = z.object({
  vehicleId: z.coerce.number().int().positive().optional(),
  driverId: z.coerce.number().int().positive().optional(),
  docType: z.string().refine((s) => ALL_TYPES.includes(s), 'Unknown document type'),
  docNumber: z.string().trim().max(60).optional().nullable(),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  issuer: z.string().trim().max(120).optional().nullable(),
});

/** Create a document or renew an existing one (renewal = newer document of the same type becomes current). */
documentsRouter.post('/', requirePerm('documents:manage'), wrap(async (req, res) => {
  const b = parse(body, req.body);
  if (!!b.vehicleId === !!b.driverId) throw badRequest('Choose either a vehicle or a driver.');
  const allowed = b.vehicleId ? (DOC_TYPES.VEHICLE as readonly string[]) : (DOC_TYPES.DRIVER as readonly string[]);
  if (!allowed.includes(b.docType)) throw badRequest('This document type does not apply to the selected owner.', { fields: { docType: 'Not valid for this owner' } });
  if (b.issuedOn && b.issuedOn > b.expiresOn) throw badRequest('Expiry must be after the issue date.', { fields: { expiresOn: 'Must be after issue date' } });
  const owner = b.vehicleId ? await q1<any>('SELECT code AS label FROM vehicles WHERE id = :id', { id: b.vehicleId }) : await q1<any>('SELECT full_name AS label FROM drivers WHERE id = :id', { id: b.driverId });
  if (!owner) throw notFound(b.vehicleId ? 'Vehicle' : 'Driver');
  const row = await q1(`INSERT INTO documents (vehicle_id, driver_id, doc_type, doc_number, issued_on, expires_on, issuer) VALUES (:v, :d, :t, :n, :i, :e, :is) RETURNING *`,
    { v: b.vehicleId ?? null, d: b.driverId ?? null, t: b.docType, n: b.docNumber ?? null, i: b.issuedOn ?? null, e: b.expiresOn, is: b.issuer ?? null });
  await audit(req, { action: 'DOCUMENT_ADDED', entityType: b.vehicleId ? 'VEHICLE' : 'DRIVER', entityId: (b.vehicleId ?? b.driverId)!, entityLabel: `${owner.label}: ${b.docType}`, meta: { expiresOn: b.expiresOn } });
  res.status(201).json({ document: row });
}));

documentsRouter.patch('/:id', requirePerm('documents:manage'), wrap(async (req, res) => {
  const did = id(req);
  const b = parse(body.pick({ docNumber: true, issuedOn: true, expiresOn: true, issuer: true }).partial(), req.body);
  if (!(await q1('SELECT 1 AS x FROM documents WHERE id = :id', { id: did }))) throw notFound('Document');
  const cols: Record<string, string> = { docNumber: 'doc_number', issuedOn: 'issued_on', expiresOn: 'expires_on', issuer: 'issuer' };
  const sets: string[] = []; const r: Record<string, unknown> = { id: did };
  for (const [k, c] of Object.entries(cols)) if ((b as any)[k] !== undefined) { sets.push(`${c} = :${c}`); r[c] = (b as any)[k]; }
  if (sets.length) await exec(`UPDATE documents SET ${sets.join(', ')}, updated_at = now() WHERE id = :id`, r);
  await audit(req, { action: 'DOCUMENT_UPDATED', entityType: 'DOCUMENT', entityId: did });
  res.json({ document: await q1('SELECT * FROM documents WHERE id = :id', { id: did }) });
}));

documentsRouter.delete('/:id', requirePerm('documents:manage'), wrap(async (req, res) => {
  const did = id(req);
  if (!(await q1('SELECT 1 AS x FROM documents WHERE id = :id', { id: did }))) throw notFound('Document');
  await exec('DELETE FROM documents WHERE id = :id', { id: did });
  await audit(req, { action: 'DELETE', entityType: 'DOCUMENT', entityId: did });
  res.json({ ok: true });
}));

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, ZodError, ZodTypeAny } from 'zod';
import { badRequest } from './errors';

export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next).catch(next);

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  try {
    return schema.parse(data);
  } catch (e) {
    if (e instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const i of e.issues) fields[i.path.join('.') || '_'] = i.message;
      throw badRequest('Please correct the highlighted fields.', { fields });
    }
    throw e;
  }
}

export const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  sort: z.string().max(40).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
});

export interface Page {
  page: number;
  pageSize: number;
  offset: number;
}
export function paging(query: unknown): Page & { q?: string; sort?: string; dir?: 'asc' | 'desc' } {
  const p = parse(pagingSchema, query);
  return { ...p, offset: (p.page - 1) * p.pageSize };
}

/** Builds a safe ORDER BY from a whitelist map { apiKey: 'sql expression' }. */
export function orderBy(sort: string | undefined, dir: string | undefined, map: Record<string, string>, fallback: string) {
  const col = sort && map[sort] ? map[sort] : fallback;
  const d = dir === 'asc' ? 'ASC' : sort ? 'DESC' : '';
  return `${col} ${d}`.trim();
}

export const likeTerm = (q: string) => `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;

export function listResponse<T>(data: T[], total: number, page: number, pageSize: number) {
  return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

export const idParam = z.coerce.number().int().positive();
export function id(req: Request, name = 'id'): number {
  return parse(idParam, req.params[name]);
}

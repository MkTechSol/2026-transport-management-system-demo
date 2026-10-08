import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';
import { logger } from '../logger';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} does not exist.` } });
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  // Sequelize unique / FK violations -> friendly messages
  const pgCode = err?.parent?.code ?? err?.original?.code;
  if (pgCode === '23505') {
    const c = String(err.parent?.constraint ?? '');
    const msg = c.includes('vehicle_active')
      ? 'This vehicle is already committed to another active trip.'
      : c.includes('driver_active')
        ? 'This driver is already committed to another active trip.'
        : 'A record with the same unique value already exists.';
    return res.status(409).json({ error: { code: 'CONFLICT', message: msg } });
  }
  if (pgCode === '23503') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'This record is referenced by other data and cannot be changed this way.' } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON body.' } });
  }
  logger.error({ err, path: req.path, method: req.method, user: req.user?.id }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } });
}

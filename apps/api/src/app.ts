import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config';
import { logger } from './logger';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './modules/auth';
import { auditRouter } from './modules/audit';
import { dashboardCache, dashboardRouter } from './modules/dashboard';
import { demoRouter } from './modules/demo';
import { documentsRouter } from './modules/documents';
import { driversRouter } from './modules/drivers';
import { distributorsRouter, locationsRouter } from './modules/locations';
import { maintenanceRouter } from './modules/maintenance';
import { meRouter } from './modules/me';
import { notificationsRouter } from './modules/notifications';
import { reportsRouter } from './modules/reports';
import { safetyRouter } from './modules/safety';
import { trackingRouter } from './modules/tracking';
import { tripsRouter } from './modules/trips';
import { usersRouter } from './modules/users';
import { vehiclesRouter } from './modules/vehicles';
import { sequelize } from './db/sequelize';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind nginx
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false })); // API only serves JSON; web app sets its own CSP via nginx
  app.use(cors({ origin: config.corsOrigins, credentials: true, maxAge: 600 }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (config.NODE_ENV !== 'test') app.use(pinoHttp({ logger, autoLogging: { ignore: (r) => r.url === '/health' } }));

  app.get('/health', async (_req, res) => {
    try { await sequelize.query('SELECT 1'); res.json({ status: 'ok', time: new Date().toISOString() }); }
    catch { res.status(503).json({ status: 'db_unreachable' }); }
  });

  const api = express.Router();
  api.use(rateLimit({ windowMs: 60_000, limit: config.RATE_LIMIT_API_PER_MIN, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } } }));
  // CSRF: the API authenticates with bearer tokens (not cookies); the one cookie (refresh) is SameSite=Strict and path-scoped.
  api.use('/auth', authRouter);
  api.use(authenticate);
  // Any successful write invalidates cached dashboard aggregates so users never see stale counts after acting.
  api.use((req, res, next) => {
    if (req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 400) dashboardCache.clear(); });
    next();
  });
  api.use('/me', meRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/vehicles', vehiclesRouter);
  api.use('/drivers', driversRouter);
  api.use('/locations', locationsRouter);
  api.use('/distributors', distributorsRouter);
  api.use('/trips', tripsRouter);
  api.use('/tracking', trackingRouter);
  api.use('/maintenance', maintenanceRouter);
  api.use('/documents', documentsRouter);
  api.use('/safety', safetyRouter);
  api.use('/reports', reportsRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/audit-logs', auditRouter);
  api.use('/users', usersRouter);
  api.use('/demo', demoRouter);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

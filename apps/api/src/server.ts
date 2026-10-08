import { createApp } from './app';
import { config } from './config';
import { checkDb, sequelize } from './db/sequelize';
import { migrate } from './db/migrate';
import { logger } from './logger';
import { generateComplianceAlerts } from './services/alerts';
import { startSimulator } from './services/simulator';

async function main() {
  await checkDb();
  await migrate(); // idempotent; production-safe (only applies pending files, never drops anything)
  const app = createApp();
  const server = app.listen(config.PORT, () => logger.info(`GasMan TMS API listening on :${config.PORT} (${config.APP_ENV})`));
  server.keepAliveTimeout = 65_000;
  if (config.simEnabled) startSimulator();
  generateComplianceAlerts().catch((e) => logger.error({ err: e }, 'alert generation failed'));
  setInterval(() => generateComplianceAlerts().catch((e) => logger.error({ err: e }, 'alert generation failed')), 30 * 60_000).unref();

  const shutdown = (sig: string) => {
    logger.info(`${sig} received, shutting down`);
    server.close(async () => { await sequelize.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((e) => { console.error(e); process.exit(1); });

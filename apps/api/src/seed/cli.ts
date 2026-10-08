import { config } from '../config';
import { sequelize, q1 } from '../db/sequelize';
import { migrate } from '../db/migrate';
import { logger } from '../logger';
import { seedDemo } from './seedDemo';
import { seedLoad, seedLoadFinance } from './seedLoad';

/**
 * Safety guard for destructive seed commands.
 * - Refuses outright when APP_ENV=production (or when NODE_ENV=production and APP_ENV is not explicitly 'demo').
 * - On a shared/demo server (APP_ENV=demo) requires --yes.
 * - Refuses databases whose name contains "prod".
 */
function guard(args: string[]) {
  const dbName = new URL(config.DATABASE_URL).pathname.replace('/', '');
  if (config.APP_ENV === 'production' || (config.NODE_ENV === 'production' && config.APP_ENV !== 'demo')) {
    console.error(`REFUSED: destructive demo commands are disabled when APP_ENV=${config.APP_ENV} / NODE_ENV=${config.NODE_ENV}.`);
    process.exit(2);
  }
  if (/prod/i.test(dbName)) { console.error(`REFUSED: database "${dbName}" looks like a production database.`); process.exit(2); }
  if (config.APP_ENV === 'demo' && !args.includes('--yes')) { console.error('This will ERASE all data in database "' + dbName + '" and re-seed the demo. Re-run with --yes to confirm.'); process.exit(2); }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'seed' || cmd === 'reset') {
    guard(args);
    await migrate(false);
    const s = await seedDemo();
    console.log('Demo data ready:', s);
  } else if (cmd === 'load') {
    guard(args);
    await migrate(false);
    const get = (k: string, d: number) => Number(args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
    await seedDemo({ log: false });
    const r = await seedLoad({ users: get('users', 1000), drivers: get('drivers', 1000), vehicles: get('vehicles', 300), trips: get('trips', 60000) });
    const f = await seedLoadFinance({ vouchers: get('vouchers', 200000), invoices: 0 });
    console.log('Load data ready:', r, f);
  } else {
    console.error('usage: cli.ts <seed|reset|load> [--yes]');
    process.exit(1);
  }
  await sequelize.close();
}
main().catch((e) => { logger.error(e); process.exit(1); });
export { q1 };

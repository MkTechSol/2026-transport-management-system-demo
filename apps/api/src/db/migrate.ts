import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sequelize } from './sequelize';
import { logger } from '../logger';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Applies pending .sql migrations in filename order. Each runs in its own transaction. Safe for production. */
export async function migrate(log = true): Promise<string[]> {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name varchar(120) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const [rows] = await sequelize.query('SELECT name FROM schema_migrations');
  const done = new Set((rows as { name: string }[]).map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await sequelize.transaction(async (t) => {
      await sequelize.query(sql, { transaction: t });
      await sequelize.query('INSERT INTO schema_migrations (name) VALUES (:f)', { replacements: { f }, transaction: t });
    });
    applied.push(f);
    if (log) logger.info(`migration applied: ${f}`);
  }
  if (log && !applied.length) logger.info('database is up to date');
  return applied;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).includes('migrate');
if (isMain) {
  migrate()
    .then(() => sequelize.close())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

import { Sequelize, QueryTypes } from 'sequelize';

// Sequelize registers its own per-connection type parsers; override so numerics are numbers, dates stay strings.
const pgTypes = (Sequelize as any).postgres;
pgTypes.DECIMAL.parse = (v: string) => parseFloat(v);
pgTypes.BIGINT.parse = (v: string) => Number(v);
pgTypes.DATEONLY.parse = (v: string) => v;
import { config } from '../config';
import { logger } from '../logger';

export const sequelize = new Sequelize(config.DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  pool: { max: config.DB_POOL_MAX, min: 2, idle: 10_000, acquire: 15_000 },
  define: { underscored: true, timestamps: false, freezeTableName: true },
  dialectOptions: {
    // Return DATE as 'YYYY-MM-DD' string and numeric as JS number
    useUTC: true,
  },
});

// pg returns int8/numeric as strings by default; convert for API consumers.
import pg from 'pg';
pg.types.setTypeParser(20, (v: string) => Number(v)); // int8
pg.types.setTypeParser(1700, (v: string) => Number(v)); // numeric
pg.types.setTypeParser(1082, (v: string) => v); // date -> 'YYYY-MM-DD'

export async function q<T = any>(sql: string, replacements: Record<string, unknown> = {}, tx?: any): Promise<T[]> {
  return sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction: tx }) as Promise<T[]>;
}
export async function q1<T = any>(sql: string, replacements: Record<string, unknown> = {}, tx?: any): Promise<T | undefined> {
  return (await q<T>(sql, replacements, tx))[0];
}
export async function exec(sql: string, replacements: Record<string, unknown> = {}, tx?: any): Promise<void> {
  await sequelize.query(sql, { replacements, transaction: tx });
}

export async function checkDb(): Promise<void> {
  await sequelize.authenticate();
  logger.debug('database connection ok');
}

import path from 'node:path';
import knexFactory, { type Knex } from 'knex';
import { env } from './env';

/**
 * Single shared MySQL pool.
 *
 * `typeCast` normalises MySQL's TINYINT(1) into real booleans and DATE into a
 * plain `YYYY-MM-DD` string. Leave dates are calendar dates, not instants —
 * letting the driver hand back a JS `Date` would silently shift them by the
 * container's UTC offset, which is exactly how "my leave starts a day early"
 * bugs happen.
 */
const baseConnection: Knex.MySql2ConnectionConfig = {
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  charset: 'utf8mb4',
  timezone: 'Z',
  supportBigNumbers: true,
  // mysql2 accepts a list of column types here; knex's typings only declare boolean.
  dateStrings: ['DATE'] as unknown as boolean,
};

export const knexConfig: Knex.Config = {
  client: 'mysql2',
  connection: baseConnection,
  pool: {
    min: env.DB_POOL_MIN,
    max: env.DB_POOL_MAX,
    acquireTimeoutMillis: 30_000,
    idleTimeoutMillis: 30_000,
  },
  migrations: {
    directory: path.join(__dirname, '..', 'db', 'migrations'),
    tableName: 'knex_migrations',
    extension: 'ts',
    loadExtensions: ['.ts', '.js'],
  },
  seeds: {
    directory: path.join(__dirname, '..', 'db', 'seeds'),
    loadExtensions: ['.ts', '.js'],
  },
  asyncStackTraces: !env.isProduction,
  debug: false,
};

export const db: Knex = knexFactory(knexConfig);

/** Used by the readiness probe and the smoke-test stage of the pipeline. */
export async function pingDatabase(): Promise<boolean> {
  const result = await db.raw('SELECT 1 AS ok');
  const rows = result?.[0] as Array<{ ok: number }> | undefined;
  return rows?.[0]?.ok === 1;
}

export async function closeDatabase(): Promise<void> {
  await db.destroy();
}

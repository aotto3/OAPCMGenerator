/**
 * Postgres connection and our own migration. Better Auth manages its own
 * tables (user/session/account/verification) via the Better Auth CLI — see
 * README; this module owns only the `contests` table.
 *
 * The pool is a lazily-created singleton so importing this module never opens a
 * connection until something actually needs one (node-postgres connects on
 * first query, not on construction).
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'pg';
import { requireEnv } from './env';

const { Pool } = pkg;
export type Pool = InstanceType<typeof Pool>;

let pool: Pool | undefined;

/** Shared connection pool, built from DATABASE_URL on first use. */
export function getPool(): Pool {
  pool ??= new Pool({ connectionString: requireEnv('DATABASE_URL') });
  return pool;
}

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Applies our contests-table migration. Idempotent (CREATE TABLE IF NOT
 * EXISTS), so it is safe to run on every boot. Better Auth's tables are
 * applied separately by its CLI (`npm run migrate:auth`).
 */
export async function migrate(target: Pool): Promise<void> {
  const sql = await readFile(join(here, '..', 'db', 'contests.sql'), 'utf8');
  await target.query(sql);
}

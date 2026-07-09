/**
 * Postgres connection and our own migrations. Better Auth manages its own
 * tables (user/session/account/verification) via the Better Auth CLI — see
 * README; this module owns the `contests` and `events` tables.
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
 * Applies our own migrations. Each is idempotent (CREATE TABLE / INDEX IF NOT
 * EXISTS), so running the whole set on every boot is safe. Better Auth's tables
 * are applied separately by its CLI (`npm run migrate:auth`).
 *
 * Ordering is not significant — the migrations are self-contained and declare
 * no cross-table foreign keys — but they are applied one at a time so a syntax
 * error names the offending file.
 */
export async function migrate(target: Pool): Promise<void> {
  for (const file of ['contests.sql', 'events.sql']) {
    const sql = await readFile(join(here, '..', 'db', file), 'utf8');
    await target.query(sql);
  }
}

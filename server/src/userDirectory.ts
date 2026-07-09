/**
 * Read-only access to the account directory for the admin panel. This is the
 * one place that reads Better Auth's own tables (`"user"`, `session`) — every
 * other module treats auth as opaque. Injected like the contest repo and event
 * log so the admin routes depend on the interface, not on Better Auth being
 * present: production wires the Postgres implementation, tests pass an in-memory
 * one (Better Auth's tables do not exist in the integration suite's pg-mem, and
 * we never want the admin tests to depend on them).
 *
 * It is strictly read-only and never touches contest payloads — the admin panel
 * observes accounts, it does not act on them.
 */
import type { Pool } from './db';

export interface UserRecord {
  id: string;
  email: string;
  /** ISO 8601 account-creation instant. */
  createdAt: string;
  /** ISO 8601 of the user's most recent session activity; absent if never seen. */
  lastSeenAt?: string;
}

export interface UserDirectory {
  /** Every account, newest sign-up first. */
  listUsers(): Promise<UserRecord[]>;
  /** One account by id, or undefined if unknown. */
  getUser(id: string): Promise<UserRecord | undefined>;
}

/** Coerces a pg timestamp (Date, or ISO string under some drivers) to ISO 8601. */
function toIso(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(String(value));
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

function mapUserRow(r: Record<string, unknown>): UserRecord {
  const lastSeenAt = toIso(r.last_seen_at);
  return {
    id: String(r.id),
    email: String(r.email),
    createdAt: toIso(r.created_at) ?? '',
    ...(lastSeenAt ? { lastSeenAt } : {}),
  };
}

// Better Auth's table and column names are camelCase, so in Postgres they must
// be quoted to preserve case ("user" is also a reserved word). Last-seen is the
// most recent session row's updatedAt for the user.
const USER_COLUMNS = `
  u.id,
  u.email,
  u."createdAt" as created_at,
  (select max(s."updatedAt") from session s where s."userId" = u.id) as last_seen_at`;

/** Postgres-backed directory over Better Auth's tables (production). */
export function createUserDirectory(pool: Pool): UserDirectory {
  return {
    async listUsers() {
      const { rows } = await pool.query(
        `select ${USER_COLUMNS} from "user" u order by u."createdAt" desc`,
      );
      return rows.map(mapUserRow);
    },

    async getUser(id) {
      const { rows } = await pool.query(
        `select ${USER_COLUMNS} from "user" u where u.id = $1`,
        [id],
      );
      return rows[0] ? mapUserRow(rows[0]) : undefined;
    },
  };
}

/**
 * In-memory directory for the integration tests — the admin equivalent of
 * handing the contest repo a pg-mem pool. Given a fixed set of accounts, it
 * answers the same interface the Postgres one does.
 */
export function createInMemoryUserDirectory(users: readonly UserRecord[]): UserDirectory {
  const sorted = [...users].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return {
    async listUsers() {
      return sorted.map((u) => ({ ...u }));
    },
    async getUser(id) {
      const found = sorted.find((u) => u.id === id);
      return found ? { ...found } : undefined;
    },
  };
}

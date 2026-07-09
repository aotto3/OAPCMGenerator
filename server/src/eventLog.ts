/**
 * Data access for the append-only `events` table — the account activity log.
 * Like the contest repo this is pool-injected so the integration tests hand it
 * an in-memory Postgres, and it is the single place that knows the events
 * schema. It only ever appends (`recordEvent`) and reads (`queryEvents`); there
 * is deliberately no update or delete, so the trail is immutable.
 *
 * The server never joins this against Better Auth's user table or the contests
 * table: user_email and contest_name are denormalized into each row at record
 * time, so a query stays owner-scopable and a deleted contest's name survives.
 */
import type { Pool } from './db';

/** A single activity-log entry as it is written. */
export interface EventInput {
  /** ISO 8601 UTC instant the action occurred (server clock at record time). */
  occurredAt: string;
  userId: string;
  /** Denormalized so the row is readable without touching the user table. */
  userEmail: string;
  /** Dotted action name, e.g. `contest.created`. */
  type: string;
  /** Set when the event targets a contest. */
  contestId?: string;
  /** Denormalized so a delete event outlives the contest row it names. */
  contestName?: string;
  /** Optional structured context; stored as JSON. */
  detail?: unknown;
}

/** A stored event: an input plus its monotonic surrogate key. */
export interface EventRecord extends EventInput {
  seq: number;
}

/** Filters + paging for {@link EventLog.queryEvents}. Newest-first always. */
export interface EventQuery {
  /** Restrict to one user's events. Omit for all users. */
  userId?: string;
  /** Max rows to return. Defaults to 50. */
  limit?: number;
  /** Rows to skip for paging. Defaults to 0. */
  offset?: number;
}

/** Filters for {@link EventLog.countEvents}. All optional; omit for a grand total. */
export interface EventCountFilter {
  userId?: string;
  type?: string;
}

export interface EventLog {
  /** Appends one event. Callers treat this as best-effort (see contest routes). */
  recordEvent(event: EventInput): Promise<void>;
  /** Returns a newest-first page of events, optionally scoped to one user. */
  queryEvents(query?: EventQuery): Promise<EventRecord[]>;
  /** Counts events matching the filter (admin stats, e.g. documents generated). */
  countEvents(filter?: EventCountFilter): Promise<number>;
}

/** Clamp paging to sane bounds so a caller can never ask for a runaway page. */
function pageBounds(query: EventQuery): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
  return { limit, offset };
}

/** Postgres-backed event log (production, and the tests' in-memory pg). */
export function createEventLog(pool: Pool): EventLog {
  return {
    async recordEvent(event) {
      await pool.query(
        `insert into events (occurred_at, user_id, user_email, type, contest_id, contest_name, detail)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          event.occurredAt,
          event.userId,
          event.userEmail,
          event.type,
          event.contestId ?? null,
          event.contestName ?? null,
          event.detail === undefined ? null : JSON.stringify(event.detail),
        ],
      );
    },

    async queryEvents(query = {}) {
      const { limit, offset } = pageBounds(query);
      // seq desc gives insertion order (== occurred_at order for our appends)
      // newest-first, and is a stable tiebreaker for equal timestamps.
      const where = query.userId !== undefined ? 'where user_id = $3' : '';
      const params: unknown[] =
        query.userId !== undefined ? [limit, offset, query.userId] : [limit, offset];
      const { rows } = await pool.query(
        `select seq, occurred_at, user_id, user_email, type, contest_id, contest_name, detail
         from events
         ${where}
         order by seq desc
         limit $1 offset $2`,
        params,
      );
      return rows.map(mapRow);
    },

    async countEvents(filter = {}) {
      const conds: string[] = [];
      const params: unknown[] = [];
      if (filter.userId !== undefined) {
        params.push(filter.userId);
        conds.push(`user_id = $${params.length}`);
      }
      if (filter.type !== undefined) {
        params.push(filter.type);
        conds.push(`type = $${params.length}`);
      }
      const where = conds.length ? `where ${conds.join(' and ')}` : '';
      const { rows } = await pool.query(
        `select count(*)::int as n from events ${where}`,
        params,
      );
      return rows[0]?.n ?? 0;
    },
  };
}

/** Shapes one DB row into an {@link EventRecord}, undoing the null-for-optional. */
function mapRow(r: Record<string, unknown>): EventRecord {
  return {
    seq: Number(r.seq),
    occurredAt: r.occurred_at as string,
    userId: r.user_id as string,
    userEmail: r.user_email as string,
    type: r.type as string,
    ...(r.contest_id != null ? { contestId: r.contest_id as string } : {}),
    ...(r.contest_name != null ? { contestName: r.contest_name as string } : {}),
    ...(r.detail != null ? { detail: parseDetail(r.detail) } : {}),
  };
}

/**
 * jsonb round-trips as a parsed value through node-postgres, but pg-mem and a
 * raw text column both hand back a string — accept either.
 */
function parseDetail(detail: unknown): unknown {
  if (typeof detail !== 'string') return detail;
  try {
    return JSON.parse(detail);
  } catch {
    return detail;
  }
}

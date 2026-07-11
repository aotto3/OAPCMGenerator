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

/**
 * The shared filter shape for reading the log. Every field is optional and ANDed
 * together; omit them all for an unfiltered read. Both {@link EventLog.queryEvents}
 * and {@link EventLog.countEvents} honor the exact same filter so a feed page and
 * its total always agree.
 */
export interface EventFilter {
  /** Restrict to one user's events. Omit for all users. */
  userId?: string;
  /** Restrict to one dotted event type, e.g. `client.error`. */
  type?: string;
  /** Restrict to one contest's events. */
  contestId?: string;
  /** Inclusive lower bound on `occurred_at` (an ISO 8601 UTC instant). */
  from?: string;
  /** Inclusive upper bound on `occurred_at` (an ISO 8601 UTC instant). */
  to?: string;
  /**
   * Case-insensitive substring match across `user_email`, `contest_name`, and
   * the client-error message in `detail`. Empty string is treated as unset.
   */
  text?: string;
}

/** Filters + paging for {@link EventLog.queryEvents}. Newest-first always. */
export interface EventQuery extends EventFilter {
  /** Max rows to return. Defaults to 50. */
  limit?: number;
  /** Rows to skip for paging. Defaults to 0. */
  offset?: number;
}

/** Filters for {@link EventLog.countEvents}. All optional; omit for a grand total. */
export interface EventCountFilter extends EventFilter {}

export interface EventLog {
  /** Appends one event. Callers treat this as best-effort (see contest routes). */
  recordEvent(event: EventInput): Promise<void>;
  /** Returns a newest-first page of events, optionally scoped to one user. */
  queryEvents(query?: EventQuery): Promise<EventRecord[]>;
  /** Counts events matching the filter (admin stats, e.g. documents generated). */
  countEvents(filter?: EventCountFilter): Promise<number>;
  /**
   * Returns EVERY event matching a filter, newest-first and unpaged — for the
   * windowed reads (analytics, error triage) that must see the whole set, not a
   * page. The row set stays bounded because callers always pass a date range.
   */
  listEvents(filter?: EventFilter): Promise<EventRecord[]>;
}

/** Clamp paging to sane bounds so a caller can never ask for a runaway page. */
function pageBounds(query: EventQuery): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
  return { limit, offset };
}

/**
 * Builds the shared `where` clause for a filter, pushing bound parameters onto
 * `params` (so the caller can append its own, e.g. limit/offset, afterwards).
 * Returns the clause including the `where` keyword, or `''` when nothing is set.
 *
 * occurred_at is an ISO 8601 UTC string in a fixed format (always `…Z`), so a
 * lexicographic `>=`/`<=` on it is a chronological range. Free-text is a simple
 * ILIKE substring across the two denormalized text columns plus the client-error
 * message inside `detail` — no wildcard escaping, which is fine at this scale.
 */
function buildWhere(filter: EventFilter, params: unknown[]): string {
  const conds: string[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filter.userId !== undefined) conds.push(`user_id = ${bind(filter.userId)}`);
  if (filter.type !== undefined) conds.push(`type = ${bind(filter.type)}`);
  if (filter.contestId !== undefined) conds.push(`contest_id = ${bind(filter.contestId)}`);
  if (filter.from !== undefined) conds.push(`occurred_at >= ${bind(filter.from)}`);
  if (filter.to !== undefined) conds.push(`occurred_at <= ${bind(filter.to)}`);
  if (filter.text !== undefined && filter.text !== '') {
    const p = bind(`%${filter.text}%`);
    conds.push(`(user_email ILIKE ${p} OR contest_name ILIKE ${p} OR detail->>'message' ILIKE ${p})`);
  }
  return conds.length ? `where ${conds.join(' and ')}` : '';
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
      const params: unknown[] = [];
      const where = buildWhere(query, params);
      const limitParam = `$${params.push(limit)}`;
      const offsetParam = `$${params.push(offset)}`;
      // seq desc gives insertion order (== occurred_at order for our appends)
      // newest-first, and is a stable tiebreaker for equal timestamps.
      const { rows } = await pool.query(
        `select seq, occurred_at, user_id, user_email, type, contest_id, contest_name, detail
         from events
         ${where}
         order by seq desc
         limit ${limitParam} offset ${offsetParam}`,
        params,
      );
      return rows.map(mapRow);
    },

    async countEvents(filter = {}) {
      const params: unknown[] = [];
      const where = buildWhere(filter, params);
      const { rows } = await pool.query(
        `select count(*)::int as n from events ${where}`,
        params,
      );
      return rows[0]?.n ?? 0;
    },

    async listEvents(filter = {}) {
      const params: unknown[] = [];
      const where = buildWhere(filter, params);
      const { rows } = await pool.query(
        `select seq, occurred_at, user_id, user_email, type, contest_id, contest_name, detail
         from events
         ${where}
         order by seq desc`,
        params,
      );
      return rows.map(mapRow);
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

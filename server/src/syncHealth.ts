/**
 * Per-user sync-health — a PURE module (no I/O; "now" is injected). The admin
 * user drill-down composes a user's contest summaries and their recent events
 * and hands them here for a simple, HONEST health signal.
 *
 * "Honest" is the whole point (PRD user story 20): the server only sees contests
 * that were pushed to it and the events that were logged. It does NOT see pulls,
 * merge conflicts, or how many devices a user has — so this module deliberately
 * claims none of that. It reports only: when the account last pushed (the newest
 * stored contest), how stale that is, how many contests are stored, and how many
 * recent client errors the account hit.
 *
 * Depends only on record shapes, so it unit-tests in isolation like the contest
 * model / critique.ts pure suites.
 */
import type { ContestSummary } from './contestRepo';
import type { EventRecord } from './eventLog';
import { TELEMETRY_EVENTS } from './eventTypes';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A stored copy older than this many days reads as "stale". OAP usage is
 * seasonal, so this is a coarse freshness hint, not an alarm — read it with the
 * season in mind.
 */
export const STALE_AFTER_DAYS = 14;

export type SyncStatus = 'healthy' | 'stale' | 'never-pushed';

export interface SyncHealth {
  /** ISO instant of the newest stored contest (the last push the server saw), or null. */
  lastPushAt: string | null;
  /** Whole days since lastPushAt relative to the injected "now"; null if never pushed. */
  staleDays: number | null;
  /** Contests currently stored for the account. */
  contestCount: number;
  /** client.error events among the recent events handed in. */
  recentErrorCount: number;
  status: SyncStatus;
}

export interface SyncHealthInput {
  contests: readonly ContestSummary[];
  /** A recent slice of the user's events (the route decides the window). */
  events: readonly EventRecord[];
  /** Injected clock, so the derivation is deterministic in tests. */
  now: string | number | Date;
}

function toMs(value: string | number | Date): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Derives a user's sync-health from server-visible facts only. `lastPushAt` is
 * the newest stored-contest `updatedAt` (the freshness of the server's copy);
 * staleness is measured off the injected `now`.
 */
export function computeSyncHealth(input: SyncHealthInput): SyncHealth {
  const { contests, events } = input;
  const nowMs = toMs(input.now);

  let lastPushMs: number | null = null;
  for (const c of contests) {
    const t = Date.parse(c.updatedAt);
    if (!Number.isNaN(t) && (lastPushMs === null || t > lastPushMs)) lastPushMs = t;
  }

  const recentErrorCount = events.reduce(
    (n, e) => (e.type === TELEMETRY_EVENTS.clientError ? n + 1 : n),
    0,
  );

  if (lastPushMs === null) {
    return {
      lastPushAt: null,
      staleDays: null,
      contestCount: contests.length,
      recentErrorCount,
      status: 'never-pushed',
    };
  }

  const staleDays = Math.max(0, Math.floor((nowMs - lastPushMs) / DAY_MS));
  return {
    lastPushAt: new Date(lastPushMs).toISOString(),
    staleDays,
    contestCount: contests.length,
    recentErrorCount,
    status: staleDays > STALE_AFTER_DAYS ? 'stale' : 'healthy',
  };
}

/**
 * Unit tests for the pure sync-health module — inputs → outputs, no I/O, "now"
 * injected. Covers the status thresholds (never-pushed vs fresh vs stale), the
 * staleness math off an injected clock, and the recent-error count.
 */
import { describe, expect, it } from 'vitest';
import { computeSyncHealth, STALE_AFTER_DAYS, type SyncHealthInput } from '../src/syncHealth';
import type { ContestSummary } from '../src/contestRepo';
import type { EventRecord } from '../src/eventLog';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-04-01T00:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW - d * DAY).toISOString();

const contest = (id: string, updatedAt: string): ContestSummary => ({ id, name: id, updatedAt });
let seq = 0;
const errorEvent = (userId = 'u'): EventRecord => ({
  seq: ++seq,
  occurredAt: daysAgo(1),
  userId,
  userEmail: `${userId}@x.test`,
  type: 'client.error',
  detail: { message: 'boom', appVersion: '1' },
});
const otherEvent = (): EventRecord => ({
  seq: ++seq,
  occurredAt: daysAgo(1),
  userId: 'u',
  userEmail: 'u@x.test',
  type: 'contest.updated',
});

const build = (over: Partial<SyncHealthInput>): SyncHealthInput => ({
  contests: [],
  events: [],
  now: NOW,
  ...over,
});

describe('computeSyncHealth', () => {
  it('reports never-pushed when the account has no stored contests', () => {
    const h = computeSyncHealth(build({ events: [errorEvent()] }));
    expect(h).toMatchObject({
      status: 'never-pushed',
      lastPushAt: null,
      staleDays: null,
      contestCount: 0,
      recentErrorCount: 1,
    });
  });

  it('is healthy when the newest contest was pushed recently', () => {
    const h = computeSyncHealth(build({ contests: [contest('a', daysAgo(3))] }));
    expect(h.status).toBe('healthy');
    expect(h.staleDays).toBe(3);
    expect(h.lastPushAt).toBe(daysAgo(3));
    expect(h.contestCount).toBe(1);
  });

  it('is stale past the threshold', () => {
    const h = computeSyncHealth(build({ contests: [contest('a', daysAgo(STALE_AFTER_DAYS + 1))] }));
    expect(h.status).toBe('stale');
    expect(h.staleDays).toBe(STALE_AFTER_DAYS + 1);
  });

  it('treats exactly the threshold as healthy (only strictly past is stale)', () => {
    const h = computeSyncHealth(build({ contests: [contest('a', daysAgo(STALE_AFTER_DAYS))] }));
    expect(h.status).toBe('healthy');
    expect(h.staleDays).toBe(STALE_AFTER_DAYS);
  });

  it('uses the newest contest as the last push', () => {
    const h = computeSyncHealth(
      build({ contests: [contest('old', daysAgo(30)), contest('new', daysAgo(2)), contest('mid', daysAgo(10))] }),
    );
    expect(h.lastPushAt).toBe(daysAgo(2));
    expect(h.staleDays).toBe(2);
    expect(h.contestCount).toBe(3);
  });

  it('counts only client.error among the recent events', () => {
    const h = computeSyncHealth(
      build({ contests: [contest('a', daysAgo(1))], events: [errorEvent(), errorEvent(), otherEvent()] }),
    );
    expect(h.recentErrorCount).toBe(2);
  });

  it('clamps a future push (clock skew) to zero stale days, still healthy', () => {
    const h = computeSyncHealth(build({ contests: [contest('a', new Date(NOW + 5 * DAY).toISOString())] }));
    expect(h.staleDays).toBe(0);
    expect(h.status).toBe('healthy');
  });
});

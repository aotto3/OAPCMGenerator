/**
 * Unit tests for the pure analytics module — inputs → outputs at the module
 * boundary, no I/O, like the contest-model / critique.ts suites. Fixture events
 * and account lists over a fixed window exercise the bucketing/windowing math,
 * distinct active-user counting, adoption/activation ratios, retention counts,
 * and per-type volume — including empty and single-bucket edges.
 */
import { describe, expect, it } from 'vitest';
import {
  bucketForDays,
  computeAnalytics,
  DAILY_BUCKET_MAX_DAYS,
  type AnalyticsWindow,
} from '../src/eventAnalytics';
import type { EventRecord } from '../src/eventLog';
import type { UserRecord } from '../src/userDirectory';

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.parse('2026-01-01T00:00:00.000Z');
const at = (dayOffset: number, hours = 0) => new Date(BASE + dayOffset * DAY + hours * 3600_000).toISOString();

let seq = 0;
function ev(dayOffset: number, userId: string, type: string, extra: Partial<EventRecord> = {}): EventRecord {
  return {
    seq: ++seq,
    occurredAt: at(dayOffset),
    userId,
    userEmail: `${userId}@x.test`,
    type,
    ...extra,
  };
}
function user(id: string, createdDayOffset: number): UserRecord {
  return { id, email: `${id}@x.test`, createdAt: at(createdDayOffset) };
}

/** A 7-day daily window: [2026-01-01, 2026-01-08). */
const week: AnalyticsWindow = { from: at(0), to: at(7), bucket: 'day' };

describe('bucketForDays', () => {
  it('buckets short windows daily and long windows weekly', () => {
    expect(bucketForDays(7)).toBe('day');
    expect(bucketForDays(30)).toBe('day');
    expect(bucketForDays(DAILY_BUCKET_MAX_DAYS)).toBe('day');
    expect(bucketForDays(DAILY_BUCKET_MAX_DAYS + 1)).toBe('week');
    expect(bucketForDays(90)).toBe('week');
  });
});

describe('daily bucketing', () => {
  it('produces one bucket per day with correct starts and per-type counts', () => {
    const events = [
      ev(0, 'alice', 'contest.created'),
      ev(0, 'alice', 'documents.generated'),
      ev(2, 'bob', 'contest.created'),
      ev(2, 'bob', 'client.error', { detail: { message: 'boom', appVersion: '1' } }),
      ev(6, 'alice', 'contest.exported'),
    ];
    const report = computeAnalytics(events, [user('alice', 0), user('bob', 2)], week);

    expect(report.series).toHaveLength(7);
    expect(report.series[0].start).toBe(at(0));
    expect(report.series[6].start).toBe(at(6));

    expect(report.series[0]).toMatchObject({ contestsCreated: 1, documentsGenerated: 1, errors: 0 });
    expect(report.series[2]).toMatchObject({ contestsCreated: 1, errors: 1 });
    expect(report.series[1]).toMatchObject({ contestsCreated: 0, documentsGenerated: 0, errors: 0 });

    expect(report.totals).toMatchObject({
      contestsCreated: 2,
      documentsGenerated: 1,
      errors: 1,
      activeUsers: 2, // alice + bob distinct across the window
    });
  });

  it('counts signups into the bucket of the account createdAt', () => {
    const users = [user('a', 0), user('b', 0), user('c', 3)];
    const report = computeAnalytics([], users, week);
    expect(report.series[0].signups).toBe(2);
    expect(report.series[3].signups).toBe(1);
    expect(report.totals.signups).toBe(3);
  });
});

describe('distinct active-user counting', () => {
  it('counts a user once per bucket no matter how many events', () => {
    const events = [
      ev(0, 'alice', 'contest.created'),
      ev(0, 'alice', 'documents.generated'),
      ev(0, 'alice', 'contest.exported'),
      ev(0, 'bob', 'contest.created'),
    ];
    const report = computeAnalytics(events, [], week);
    expect(report.series[0].activeUsers).toBe(2);
    expect(report.retention.activeUsers).toBe(2);
  });
});

describe('adoption/activation ratios', () => {
  it('is distinct users who took each action over all accounts', () => {
    const users = [user('a', 0), user('b', 0), user('c', 0), user('d', 0)]; // 4 accounts
    const events = [
      ev(0, 'a', 'contest.created'),
      ev(1, 'b', 'contest.created'),
      ev(1, 'a', 'documents.generated'),
      ev(2, 'a', 'contest.exported'),
    ];
    const report = computeAnalytics(events, users, week);
    expect(report.adoption.totalUsers).toBe(4);
    expect(report.adoption.createdContest).toEqual({ users: 2, ratio: 0.5 }); // a, b
    expect(report.adoption.generatedDocuments).toEqual({ users: 1, ratio: 0.25 }); // a
    expect(report.adoption.exported).toEqual({ users: 1, ratio: 0.25 }); // a
  });

  it('yields a zero ratio (not NaN) when there are no accounts', () => {
    const report = computeAnalytics([ev(0, 'ghost', 'contest.created')], [], week);
    expect(report.adoption.totalUsers).toBe(0);
    expect(report.adoption.createdContest).toEqual({ users: 1, ratio: 0 });
  });
});

describe('retention', () => {
  it('counts users active in two or more buckets as returning', () => {
    const events = [
      ev(0, 'loyal', 'contest.created'),
      ev(4, 'loyal', 'documents.generated'), // active in two buckets
      ev(1, 'oneshot', 'contest.created'), // active in one bucket
    ];
    const report = computeAnalytics(events, [], week);
    expect(report.retention.activeUsers).toBe(2);
    expect(report.retention.returningUsers).toBe(1);
  });
});

describe('per-type volume', () => {
  it('tallies each type in the window, most frequent first', () => {
    const events = [
      ev(0, 'a', 'contest.created'),
      ev(1, 'b', 'contest.created'),
      ev(2, 'c', 'contest.created'),
      ev(0, 'a', 'documents.generated'),
      ev(1, 'b', 'documents.generated'),
      ev(3, 'a', 'client.error', { detail: { message: 'x', appVersion: '1' } }),
    ];
    const report = computeAnalytics(events, [], week);
    expect(report.volumeByType).toEqual([
      { type: 'contest.created', count: 3 },
      { type: 'documents.generated', count: 2 },
      { type: 'client.error', count: 1 },
    ]);
  });
});

describe('weekly bucketing', () => {
  it('splits a two-week window into two weekly buckets', () => {
    const window: AnalyticsWindow = { from: at(0), to: at(14), bucket: 'week' };
    const events = [
      ev(1, 'a', 'contest.created'), // week 1
      ev(3, 'b', 'contest.created'), // week 1
      ev(9, 'c', 'contest.created'), // week 2
    ];
    const report = computeAnalytics(events, [], window);
    expect(report.series).toHaveLength(2);
    expect(report.series[0].contestsCreated).toBe(2);
    expect(report.series[1].contestsCreated).toBe(1);
    expect(report.series[1].start).toBe(at(7));
  });
});

describe('window boundaries and edges', () => {
  it('excludes events and signups outside [from, to)', () => {
    const events = [
      ev(-1, 'before', 'contest.created'), // before window
      ev(0, 'inside', 'contest.created'),
      ev(7, 'onEnd', 'contest.created'), // exactly `to`, exclusive → excluded
      ev(8, 'after', 'contest.created'),
    ];
    const users = [user('inside', 0), user('after', 10)];
    const report = computeAnalytics(events, users, week);
    expect(report.totals.contestsCreated).toBe(1);
    expect(report.totals.signups).toBe(1); // only 'inside'
    expect(report.volumeByType).toEqual([{ type: 'contest.created', count: 1 }]);
  });

  it('handles an empty window with a single zeroed bucket', () => {
    const halfDay: AnalyticsWindow = { from: at(0), to: at(0, 12), bucket: 'day' };
    const report = computeAnalytics([], [], halfDay);
    expect(report.series).toHaveLength(1);
    expect(report.series[0]).toMatchObject({ signups: 0, activeUsers: 0, contestsCreated: 0, errors: 0 });
    expect(report.totals.activeUsers).toBe(0);
    expect(report.adoption.createdContest).toEqual({ users: 0, ratio: 0 });
    expect(report.retention).toEqual({ activeUsers: 0, returningUsers: 0 });
    expect(report.volumeByType).toEqual([]);
  });
});

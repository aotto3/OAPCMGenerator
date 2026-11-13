import { describe, expect, it } from 'vitest';
import { createContest, withDetails, type Contest } from '../model/contest';
import { setJudge } from '../model/judgePanel';
import { ApiHttpError, ApiNetworkError } from '../api/http';
import type { SyncStatus } from '../storage/syncEngine';
import type { JudgeRoster } from './roster';
import { localToday, publishFailureReason, startRosterPublisher, type RosterPublishStatus } from './rosterPublisher';

const NOW = '2026-11-01T12:00:00.000Z';

function judgedContest(id: string, email: string): Contest {
  let c = createContest({ id, now: NOW });
  c = withDetails(c, { contestDate: '2027-03-25' }, NOW);
  return setJudge(c, 0, { name: 'Jane', email }, NOW);
}

function harness(initial: Contest[], failPublish = false) {
  let listener: (s: SyncStatus) => void = () => {};
  let contests = initial;
  const published: JudgeRoster[] = [];
  let fail = failPublish;
  let clock = new Date('2027-03-01T15:00:00.000Z');
  const publisher = startRosterPublisher({
    subscribe: (l) => {
      listener = l;
      l('synced'); // the engine reports its resting status immediately
      return () => (listener = () => {});
    },
    loadContests: async () => contests,
    publish: async (r) => {
      if (fail) throw new Error('offline');
      published.push(r);
    },
    today: () => '2027-03-01',
    now: () => clock,
  });
  const reports: RosterPublishStatus[] = [];
  publisher.onStatus((s) => reports.push(s));
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    published,
    publisher,
    reports,
    stop: () => publisher.stop(),
    setClock: (iso: string) => (clock = new Date(iso)),
    async settle() {
      listener('syncing');
      listener('synced');
      await flush();
    },
    setContests: (c: Contest[]) => (contests = c),
    setFail: (f: boolean) => (fail = f),
    status: (s: SyncStatus) => listener(s),
    flush,
  };
}

describe('startRosterPublisher', () => {
  it('does not publish before a sync pass has run (a fresh device must not wipe the roster)', async () => {
    const h = harness([]);
    await h.flush();
    expect(h.published).toEqual([]);
  });

  it('publishes the roster once sync settles after a pass', async () => {
    const h = harness([judgedContest('c1', 'jane@x.org')]);
    await h.settle();
    expect(h.published).toHaveLength(1);
    expect(h.published[0].judges.map((j) => j.email)).toEqual(['jane@x.org']);
  });

  it('skips a publish when nothing in the roster changed', async () => {
    const h = harness([judgedContest('c1', 'jane@x.org')]);
    await h.settle();
    await h.settle();
    expect(h.published).toHaveLength(1);
  });

  it('publishes again when the roster changes', async () => {
    const h = harness([judgedContest('c1', 'jane@x.org')]);
    await h.settle();
    h.setContests([judgedContest('c1', 'sam@x.org')]);
    await h.settle();
    expect(h.published.map((r) => r.judges[0].email)).toEqual(['jane@x.org', 'sam@x.org']);
  });

  it('retries a failed publish at the next settle', async () => {
    const h = harness([judgedContest('c1', 'jane@x.org')], true);
    await h.settle();
    expect(h.published).toHaveLength(0);
    h.setFail(false);
    await h.settle();
    expect(h.published).toHaveLength(1);
  });

  it('ignores pending and offline statuses', async () => {
    const h = harness([judgedContest('c1', 'jane@x.org')]);
    h.status('syncing');
    h.status('pending');
    h.status('offline');
    await h.flush();
    expect(h.published).toHaveLength(0);
  });

  it('stops listening when disposed', async () => {
    const h = harness([judgedContest('c1', 'jane@x.org')]);
    h.stop();
    await h.settle();
    expect(h.published).toHaveLength(0);
  });
});

describe('roster publish status', () => {
  it('is idle before anything is published', () => {
    const h = harness([judgedContest('c1', 'jane@x.org')]);
    expect(h.publisher.status()).toEqual({ kind: 'idle' });
  });

  it('reports success with a timestamp from the injected clock', async () => {
    const h = harness([judgedContest('c1', 'jane@x.org')]);
    await h.settle();
    expect(h.publisher.status()).toEqual({ kind: 'published', at: '2027-03-01T15:00:00.000Z' });
    expect(h.reports).toEqual([{ kind: 'published', at: '2027-03-01T15:00:00.000Z' }]);
  });

  it('keeps the last publish time when an unchanged roster is skipped', async () => {
    const h = harness([judgedContest('c1', 'jane@x.org')]);
    await h.settle();
    h.setClock('2027-03-01T16:00:00.000Z');
    await h.settle();
    expect(h.publisher.status()).toEqual({ kind: 'published', at: '2027-03-01T15:00:00.000Z' });
  });

  it('reports failure with a reason when the client throws', async () => {
    const h = harness([judgedContest('c1', 'jane@x.org')], true);
    await h.settle();
    expect(h.publisher.status()).toEqual({ kind: 'failed', at: '2027-03-01T15:00:00.000Z', reason: 'offline' });
  });

  it('reports success again once a retry goes through', async () => {
    const h = harness([judgedContest('c1', 'jane@x.org')], true);
    await h.settle();
    h.setFail(false);
    h.setClock('2027-03-01T15:05:00.000Z');
    await h.settle();
    expect(h.publisher.status()).toEqual({ kind: 'published', at: '2027-03-01T15:05:00.000Z' });
  });

  it('goes back to published when the roster returns to what the server already holds', async () => {
    const h = harness([judgedContest('c1', 'jane@x.org')]);
    await h.settle();
    h.setFail(true);
    h.setContests([judgedContest('c1', 'sam@x.org')]);
    await h.settle();
    expect(h.publisher.status().kind).toBe('failed');
    h.setContests([judgedContest('c1', 'jane@x.org')]);
    await h.settle();
    expect(h.publisher.status()).toEqual({ kind: 'published', at: '2027-03-01T15:00:00.000Z' });
  });

  it('stops reporting once stopped', async () => {
    const h = harness([judgedContest('c1', 'jane@x.org')]);
    h.stop();
    await h.settle();
    expect(h.reports).toEqual([]);
  });
});

describe('publishFailureReason', () => {
  it('names the common causes plainly', () => {
    expect(publishFailureReason(new ApiNetworkError())).toBe('no connection');
    expect(publishFailureReason(new ApiHttpError(401, { error: 'Unauthorized' }))).toBe('signed out');
    expect(publishFailureReason(new ApiHttpError(400, { error: 'Roster too large' }))).toBe('the roster is too large');
    expect(publishFailureReason(new ApiHttpError(400, { error: 'Invalid roster' }))).toBe('the server refused the roster');
    expect(publishFailureReason(new ApiHttpError(500))).toBe('server error 500');
    expect(publishFailureReason('???')).toBe('unknown error');
  });
});

describe('localToday', () => {
  it('formats the local calendar date', () => {
    expect(localToday(new Date(2027, 2, 4, 23, 30))).toBe('2027-03-04');
  });
});

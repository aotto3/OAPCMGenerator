/**
 * The roster publisher as a contest-library follower (slice A3 #279), on a real
 * library over fake-indexeddb. `pass()` is a completed server pass (the event
 * the sync engine reports); `setContests` writes through the library. The
 * publish-status cases are #275's, ported to this boundary.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createContest, withDetails, type Contest } from '../model/contest';
import { setJudge } from '../model/judgePanel';
import { ApiHttpError, ApiNetworkError } from '../api/http';
import { followerKit } from '../storage/followerTestKit';
import type { JudgeRoster } from './roster';
import { localToday, publishFailureReason, startRosterPublisher, type RosterPublishStatus } from './rosterPublisher';

const NOW = '2026-11-01T12:00:00.000Z';
let edits = 0;

function judgedContest(id: string, email: string): Contest {
  // Each copy is stamped later than the last, so a save always lands.
  const at = new Date(Date.parse(NOW) + ++edits * 1000).toISOString();
  let c = createContest({ id, now: NOW });
  c = withDetails(c, { contestDate: '2027-03-25' }, at);
  return setJudge(c, 0, { name: 'Jane', email }, at);
}

async function harness(initial: Contest[], failPublish = false) {
  const kit = followerKit();
  const { library } = kit;
  for (const contest of initial) await library.add(contest);
  const published: JudgeRoster[] = [];
  let fail = failPublish;
  let clock = new Date('2027-03-01T15:00:00.000Z');
  const publisher = startRosterPublisher({
    follow: (name, handler) => library.follow(name, handler),
    publish: async (r) => {
      if (fail) throw new Error('offline');
      published.push(r);
    },
    today: () => '2027-03-01',
    now: () => clock,
  });
  const reports: RosterPublishStatus[] = [];
  publisher.onStatus((s) => reports.push(s));
  return {
    published,
    publisher,
    reports,
    kit,
    stop: () => publisher.stop(),
    setClock: (iso: string) => (clock = new Date(iso)),
    /** A completed server pass, then everything settles. */
    async pass() {
      library.noteReconciled();
      await kit.settle();
    },
    async setContests(contests: Contest[]) {
      for (const contest of contests) await library.save(contest);
      await kit.settle();
    },
    setFail: (f: boolean) => (fail = f),
  };
}

const emails = (r: JudgeRoster) => r.judges.map((j) => j.email).sort();

describe('startRosterPublisher', () => {
  it('does not publish before a server pass has completed (a fresh device must not wipe the roster)', async () => {
    const h = await harness([judgedContest('c1', 'jane@x.org')]);
    await h.setContests([judgedContest('c1', 'sam@x.org')]);
    expect(h.published).toEqual([]);
  });

  it('publishes the roster from every stored contest after the first pass', async () => {
    const h = await harness([judgedContest('c1', 'jane@x.org'), judgedContest('c2', 'kim@x.org')]);
    await h.pass();
    expect(h.published.map(emails)).toEqual([['jane@x.org', 'kim@x.org']]);
  });

  it('skips a publish when nothing in the roster changed', async () => {
    const h = await harness([judgedContest('c1', 'jane@x.org')]);
    await h.pass();
    await h.pass();
    expect(h.published).toHaveLength(1);
  });

  it('publishes again when an edit changes the roster, from its cache plus the change', async () => {
    const h = await harness([judgedContest('c1', 'jane@x.org'), judgedContest('c2', 'kim@x.org')]);
    await h.pass();
    await h.setContests([judgedContest('c1', 'sam@x.org')]);
    expect(h.published.map(emails)).toEqual([
      ['jane@x.org', 'kim@x.org'],
      ['kim@x.org', 'sam@x.org'],
    ]);
  });

  it('drops a removed contest from the roster', async () => {
    const h = await harness([judgedContest('c1', 'jane@x.org'), judgedContest('c2', 'kim@x.org')]);
    await h.pass();
    await h.kit.library.remove('c2');
    await h.kit.settle();
    expect(h.published.map(emails)[1]).toEqual(['jane@x.org']);
  });

  it('retries a failed publish at the next wake', async () => {
    const h = await harness([judgedContest('c1', 'jane@x.org')], true);
    await h.pass();
    expect(h.published).toHaveLength(0);
    h.setFail(false);
    h.kit.wake();
    await h.kit.settle();
    expect(h.published).toHaveLength(1);
  });

  it('stops listening when disposed', async () => {
    const h = await harness([judgedContest('c1', 'jane@x.org')]);
    h.stop();
    await h.pass();
    expect(h.published).toHaveLength(0);
  });
});

describe('roster publish status', () => {
  it('is idle before anything is published', async () => {
    const h = await harness([judgedContest('c1', 'jane@x.org')]);
    expect(h.publisher.status()).toEqual({ kind: 'idle' });
  });

  it('reports success with a timestamp from the injected clock', async () => {
    const h = await harness([judgedContest('c1', 'jane@x.org')]);
    await h.pass();
    expect(h.publisher.status()).toEqual({ kind: 'published', at: '2027-03-01T15:00:00.000Z' });
    expect(h.reports).toEqual([{ kind: 'published', at: '2027-03-01T15:00:00.000Z' }]);
  });

  it('keeps the last publish time when an unchanged roster is skipped', async () => {
    const h = await harness([judgedContest('c1', 'jane@x.org')]);
    await h.pass();
    h.setClock('2027-03-01T16:00:00.000Z');
    await h.pass();
    expect(h.publisher.status()).toEqual({ kind: 'published', at: '2027-03-01T15:00:00.000Z' });
  });

  it('reports failure with a reason when the client throws', async () => {
    const h = await harness([judgedContest('c1', 'jane@x.org')], true);
    await h.pass();
    expect(h.publisher.status()).toEqual({ kind: 'failed', at: '2027-03-01T15:00:00.000Z', reason: 'offline' });
  });

  it('reports success again once a retry goes through', async () => {
    const h = await harness([judgedContest('c1', 'jane@x.org')], true);
    await h.pass();
    h.setFail(false);
    h.setClock('2027-03-01T15:05:00.000Z');
    await h.pass();
    expect(h.publisher.status()).toEqual({ kind: 'published', at: '2027-03-01T15:05:00.000Z' });
  });

  it('goes back to published when the roster returns to what the server already holds', async () => {
    const h = await harness([judgedContest('c1', 'jane@x.org')]);
    await h.pass();
    h.setFail(true);
    await h.setContests([judgedContest('c1', 'sam@x.org')]);
    expect(h.publisher.status().kind).toBe('failed');
    await h.setContests([judgedContest('c1', 'jane@x.org')]);
    expect(h.publisher.status()).toEqual({ kind: 'published', at: '2027-03-01T15:00:00.000Z' });
  });

  it('stops reporting once stopped', async () => {
    const h = await harness([judgedContest('c1', 'jane@x.org')]);
    h.stop();
    await h.pass();
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

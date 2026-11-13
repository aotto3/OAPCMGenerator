/**
 * Boundary tests for contest-library followers (RFC #276, slice A3 #279): a
 * real library on fake-indexeddb with manual timers and a manual wake port.
 * `noteReconciled()` stands in for the sync engine's completed server pass,
 * except in the last test, which runs the real engine against a fake server.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ContestLibrary, FollowBatch } from './contestLibrary';
import { followerKit, type FollowerKit } from './followerTestKit';
import { createSyncEngine } from './syncEngine';
import { createLibrarySyncStore } from './syncStore';
import { SyncNetworkError, type RemoteContest, type SyncClient } from './syncClient';
import { createContest, withDetails, withIdentity, type Contest } from '../model/contest';
import { setJudge } from '../model/judgePanel';
import { serializeSyncBundle } from '../model/syncBundle';
import { startRosterPublisher } from '../questionnaire/rosterPublisher';
import type { JudgeRoster } from '../questionnaire/roster';
import { blankAnswers, type JudgeSubmission } from '../questionnaire/submission';
import { startSubmissionSync } from '../questionnaire/submissionSync';

const T0 = '2026-11-01T12:00:00.000Z';
const T1 = '2026-11-02T12:00:00.000Z';

let kit: FollowerKit;
let library: ContestLibrary;

beforeEach(() => {
  kit = followerKit();
  library = kit.library;
});

function contest(id: string, host = 'Westlake HS'): Contest {
  return withIdentity(createContest({ id, now: T0 }), { hostSchoolName: host }, T1);
}

function judged(id: string, email: string, at = T1): Contest {
  let c = createContest({ id, now: T0 });
  c = withDetails(c, { contestDate: '2027-03-25' }, at);
  return setJudge(c, 0, { name: 'Jane', email }, at);
}

/** A follower that records each batch (contests reduced to ids). */
function recorder(name: string, run: (batch: FollowBatch) => Promise<void> = async () => {}) {
  const batches: { first: boolean; reconciled: boolean; changed: string[]; removed: string[] }[] = [];
  const stop = library.follow(name, async (batch) => {
    batches.push({
      first: batch.first,
      reconciled: batch.reconciled,
      changed: batch.changed.map((c) => c.id).sort(),
      removed: [...batch.removed].sort(),
    });
    await run(batch);
  });
  return { batches, stop };
}

describe('library.follow', () => {
  it('runs no follower before the first completed server pass', async () => {
    const f = recorder('r');
    await library.add(contest('c1'));
    await kit.settle();
    expect(f.batches).toEqual([]);

    library.noteReconciled();
    await kit.settle();
    // What arrived before the pass is in the first batch.
    expect(f.batches).toEqual([{ first: true, reconciled: true, changed: ['c1'], removed: [] }]);
  });

  it('coalesces a burst of edits into one batch with the latest copy', async () => {
    const seen: string[] = [];
    const f = recorder('r', async (b) => {
      for (const c of b.changed) seen.push(c.identity.hostSchoolName);
    });
    library.noteReconciled();
    await kit.settle();
    for (const host of ['A HS', 'B HS', 'C HS', 'D HS']) await library.save(contest('c1', host));
    await kit.settle();
    expect(f.batches).toHaveLength(2);
    expect(f.batches[1]).toEqual({ first: false, reconciled: false, changed: ['c1'], removed: [] });
    expect(seen).toEqual(['D HS']);
  });

  it('reports removed contests', async () => {
    await library.add(contest('c1'));
    const f = recorder('r');
    library.noteReconciled();
    await kit.settle();
    await library.remove('c1');
    await kit.settle();
    expect(f.batches[1]).toEqual({ first: false, reconciled: false, changed: [], removed: ['c1'] });
  });

  it('does not re-trigger a follower with its own writes; others see them', async () => {
    await library.add(contest('c1'));
    const own = recorder('own', async (b) => {
      if (b.first) await b.transform('c1', (c) => withIdentity(c, { hostSchoolName: 'Own HS' }, '2026-11-03T00:00:00.000Z'));
    });
    const other = recorder('other');
    library.noteReconciled();
    await kit.settle();
    expect(own.batches).toHaveLength(1);
    expect(other.batches.flatMap((b) => b.changed)).toContain('c1');
    expect((await library.read('c1'))?.identity.hostSchoolName).toBe('Own HS');
  });

  it('runs one batch at a time and reruns for what arrived meanwhile', async () => {
    let release: () => void = () => {};
    let active = 0;
    let maxActive = 0;
    const f = recorder('r', async (b) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (b.first) await new Promise<void>((resolve) => (release = resolve));
      active -= 1;
    });
    library.noteReconciled();
    await kit.settle(); // the first run is now blocked
    await library.add(contest('c2'));
    await kit.settle(); // its debounce fires while the first run is still going
    expect(f.batches).toHaveLength(1);
    release();
    await kit.settle();
    expect(maxActive).toBe(1);
    expect(f.batches[1]).toEqual({ first: false, reconciled: false, changed: ['c2'], removed: [] });
  });

  it('keeps a failed batch and retries it on the next wake', async () => {
    let fail = true;
    const f = recorder('r', async () => {
      if (fail) throw new Error('offline');
    });
    await library.add(contest('c1'));
    library.noteReconciled();
    await kit.settle();
    expect(f.batches).toHaveLength(1);
    await kit.settle();
    expect(f.batches).toHaveLength(1); // no retry loop on its own

    fail = false;
    kit.wake();
    await kit.settle();
    expect(f.batches).toHaveLength(2);
    expect(f.batches[1]).toEqual({ first: true, reconciled: true, changed: ['c1'], removed: [] });

    kit.wake(); // nothing failed now: a wake alone is not a run
    await kit.settle();
    expect(f.batches).toHaveLength(2);
  });

  it('stops running once stopped', async () => {
    const f = recorder('r');
    f.stop();
    library.noteReconciled();
    await library.add(contest('c1'));
    await kit.settle();
    expect(f.batches).toEqual([]);
  });
});

describe('the roster and submission followers together', () => {
  const SUB: JudgeSubmission = {
    email: 'jane@x.org',
    submittedAt: '2026-11-10T00:00:00.000Z',
    answers: { ...blankAnswers(['c1']), dietary: 'vegan' },
  };

  function wire() {
    const published: JudgeRoster[] = [];
    let fetches = 0;
    const roster = startRosterPublisher({
      follow: (name, handler) => library.follow(name, handler),
      publish: async (r) => void published.push(r),
      today: () => '2027-03-01',
      now: () => new Date('2027-03-01T15:00:00.000Z'),
    });
    const stopSubs = startSubmissionSync({
      follow: (name, handler) => library.follow(name, handler),
      fetchSubmissions: async () => {
        fetches += 1;
        return [SUB];
      },
      contestIds: async () => (await library.list()).map((s) => s.id),
      now: () => '2026-11-20T00:00:00.000Z',
    });
    return {
      published,
      fetches: () => fetches,
      stop() {
        roster.stop();
        stopSubs();
      },
    };
  }

  it('a burst of device edits makes zero submission fetches and at most one roster publish', async () => {
    await library.add(judged('c1', 'jane@x.org'));
    const w = wire();
    library.noteReconciled();
    await kit.settle();
    expect(w.fetches()).toBe(1);
    expect(w.published).toHaveLength(1);
    expect((await library.read('c1'))?.adjudicators[0].dietary).toBe('vegan');

    // The CM types a new judge email, saved several times over a burst.
    const base = (await library.read('c1'))!;
    for (const [i, email] of ['s', 'sa', 'sam', 'sam@x.org'].entries()) {
      await library.save(setJudge(base, 1, { name: 'Sam', email }, `2026-11-21T00:00:0${i}.000Z`));
    }
    await kit.settle();
    expect(w.fetches()).toBe(1);
    expect(w.published).toHaveLength(2);
    expect(w.published[1].judges.map((j) => j.email).sort()).toEqual(['jane@x.org', 'sam@x.org']);
    w.stop();
  });

  it('a server pass brings new answers into an open contest without any edit', async () => {
    await library.add(judged('c1', 'jane@x.org'));
    const open = library.open('c1');
    const w = wire();
    library.noteReconciled();
    await kit.settle();
    const state = open.getState();
    expect(state.status === 'ready' && state.contest.adjudicators[0].dietary).toBe('vegan');
    w.stop();
    await open.close();
  });
});

describe('a fresh device (with the real sync engine)', () => {
  it('cannot publish an empty roster before its first pull completes', async () => {
    // The account's server copy has a judged contest; this device has nothing yet.
    const remote = judged('c1', 'jane@x.org');
    const record: RemoteContest = {
      id: 'c1',
      name: 'Contest',
      updatedAt: remote.updatedAt,
      payload: serializeSyncBundle(remote, []),
    };
    const state = { reachable: false };
    const guard = () => {
      if (!state.reachable) throw new SyncNetworkError();
    };
    const client: SyncClient = {
      list: async () => (guard(), [{ id: 'c1', name: 'Contest', updatedAt: record.updatedAt }]),
      get: async () => (guard(), record),
      create: async () => guard(),
      update: async () => guard(),
      remove: async () => guard(),
    };
    const tasks: (() => void | Promise<void>)[] = [];
    const drain = async () => {
      while (tasks.length) await tasks.shift()!();
    };
    const engine = createSyncEngine({
      client,
      store: createLibrarySyncStore(library),
      isOnline: () => true,
      schedule: (fn) => void tasks.push(fn),
      flushDelayMs: 0,
      backoff: () => 0,
    });
    const published: JudgeRoster[] = [];
    const roster = startRosterPublisher({
      follow: (name, handler) => library.follow(name, handler),
      publish: async (r) => void published.push(r),
      today: () => '2027-03-01',
      now: () => new Date('2027-03-01T15:00:00.000Z'),
    });

    // Start-up with the server unreachable: the pass fails, so nothing publishes.
    engine.start();
    await drain();
    await kit.settle();
    expect(published).toEqual([]);

    // The server comes back (a reconnect or wake reconciles): the pull lands first.
    state.reachable = true;
    await engine.reconcile();
    await kit.settle();
    expect(published).toHaveLength(1);
    expect(published[0].judges.map((j) => j.email)).toEqual(['jane@x.org']);
    roster.stop();
    engine.stop();
  });
});

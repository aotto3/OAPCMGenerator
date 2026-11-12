/**
 * Boundary tests for open-contest sessions (RFC #276, slice A2 #278), run
 * against fake-indexeddb with a manual clock and manual timers. A second
 * library on the same IDBFactory models a reload of the same device.
 */
// The globals (IDBRequest and friends) that idb checks against.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createContestLibrary,
  type ContestEvent,
  type ContestLibrary,
  type OpenContest,
  type OpenState,
  type Timers,
} from './contestLibrary';
import { createContest, withDetails, withIdentity, type Contest } from '../model/contest';
import { serializeSyncBundle } from '../model/syncBundle';

const T0 = '2026-07-05T12:00:00.000Z';
const T1 = '2026-07-06T12:00:00.000Z';
const T2 = '2026-07-07T12:00:00.000Z';
const T3 = '2026-07-08T12:00:00.000Z';
const T4 = '2026-07-09T12:00:00.000Z';

/** Timers the test fires by hand; nothing runs on its own. */
function manualTimers() {
  const pending = new Map<number, () => void>();
  let next = 0;
  const timers: Timers = {
    set(fn) {
      pending.set(++next, fn);
      return next;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    get pending() {
      return pending.size;
    },
    runAll() {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
    },
  };
}

let factory: IDBFactory;
let clock: ReturnType<typeof manualTimers>;
let now: string;
let library: ContestLibrary;
let events: ContestEvent[];

function makeLibrary(): ContestLibrary {
  return createContestLibrary({ idb: factory, clock: () => now, timers: clock.timers });
}

beforeEach(() => {
  factory = new IDBFactory();
  clock = manualTimers();
  now = T4;
  library = makeLibrary();
  events = [];
  library.subscribe((e) => events.push(e));
});

function sampleContest(id = 'c1'): Contest {
  return withIdentity(createContest({ id, now: T0 }), { hostSchoolName: 'Westlake HS' }, T1);
}

/** Waits for the session to leave `loading`. */
async function ready(open: OpenContest): Promise<Extract<OpenState, { status: 'ready' }>> {
  await vi.waitFor(() => expect(open.getState().status).not.toBe('loading'));
  const state = open.getState();
  if (state.status !== 'ready') throw new Error(`expected ready, got ${state.status}`);
  return state;
}

function live(open: OpenContest): Contest {
  const state = open.getState();
  if (state.status !== 'ready') throw new Error(`expected ready, got ${state.status}`);
  return state.contest;
}

/** A pulled copy as the sync engine hands it to the library. */
function remoteCopy(contest: Contest, version = contest.updatedAt) {
  return { updatedAt: version, payload: serializeSyncBundle(contest, []) };
}

/** What a fresh library (a reload) reads from the same IndexedDB. */
async function readAfterReload(id: string): Promise<Contest | undefined> {
  return makeLibrary().read(id);
}

describe('editing an open contest', () => {
  it('writes an edit after the debounce, with nothing written before the timer fires', async () => {
    await library.add(sampleContest());
    const open = library.open('c1');
    await ready(open);
    events.length = 0;

    open.set(withDetails(live(open), { contestDate: '2026-03-14' }, T2));
    expect(clock.pending).toBe(1);
    expect((await readAfterReload('c1'))?.details.contestDate).toBe('');
    expect(events).toEqual([]);

    clock.runAll();
    await vi.waitFor(async () => expect((await readAfterReload('c1'))?.details.contestDate).toBe('2026-03-14'));
    expect(events.map((e) => [e.type, e.type === 'changed' && e.origin])).toEqual([['changed', 'device']]);
  });

  it('collapses a burst of edits into one write', async () => {
    await library.add(sampleContest());
    const open = library.open('c1');
    await ready(open);
    events.length = 0;

    open.update((c) => withDetails(c, { contestDate: '2026-03-14' }, T2));
    open.update((c) => withIdentity(c, { hostSchoolName: 'Burst HS' }, T3));
    expect(clock.pending).toBe(1);
    clock.runAll();
    await vi.waitFor(() => expect(events).toHaveLength(1));
    const stored = await readAfterReload('c1');
    expect(stored?.details.contestDate).toBe('2026-03-14');
    expect(stored?.identity.hostSchoolName).toBe('Burst HS');
  });

  it('close and flush write the pending edit at once, without the timer', async () => {
    await library.add(sampleContest());
    const a = library.open('c1');
    await ready(a);
    a.set(withDetails(live(a), { contestDate: '2026-03-14' }, T2));
    await library.flush();
    expect((await readAfterReload('c1'))?.details.contestDate).toBe('2026-03-14');

    a.set(withDetails(live(a), { contestDate: '2026-04-01' }, T3));
    await a.close();
    expect((await readAfterReload('c1'))?.details.contestDate).toBe('2026-04-01');
    expect(clock.pending).toBe(0);
  });

  it('shares one live copy between two handles on the same contest', async () => {
    await library.add(sampleContest());
    const a = library.open('c1');
    const b = library.open('c1');
    await ready(a);
    a.set(withDetails(live(a), { contestDate: '2026-03-14' }, T2));
    expect(live(b).details.contestDate).toBe('2026-03-14');
    await a.close();
    expect(b.getState().status).toBe('ready');
    await b.close();
  });

  it('reports missing for an id that is not stored', async () => {
    const open = library.open('nope');
    await vi.waitFor(() => expect(open.getState()).toEqual({ status: 'missing' }));
  });
});

describe('drafts', () => {
  it('never stores an unedited draft, even when closed or flushed', async () => {
    const draft = createContest({ id: 'd1', now: T0 });
    const open = library.open('d1', { draft });
    expect(open.getState()).toEqual({ status: 'ready', contest: draft, notice: null });
    await library.flush();
    await open.close();
    expect(await library.list()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('stores a draft after its first edit', async () => {
    const draft = createContest({ id: 'd1', now: T0 });
    const open = library.open('d1', { draft });
    open.set(withIdentity(draft, { hostSchoolName: 'New HS' }, T1));
    clock.runAll();
    await vi.waitFor(async () => expect((await readAfterReload('d1'))?.identity.hostSchoolName).toBe('New HS'));
  });

  it('transform on an unsaved draft returns undefined and writes nothing', async () => {
    const draft = createContest({ id: 'd1', now: T0 });
    library.open('d1', { draft });
    expect(await library.transform('d1', (c) => withIdentity(c, { hostSchoolName: 'X' }, T2))).toBeUndefined();
    expect(await library.list()).toEqual([]);
  });
});

describe('outside writes to an open contest', () => {
  it('a pull swaps the session and sets the notice; the next save keeps the pulled data', async () => {
    const contest = sampleContest();
    await library.add(contest);
    const open = library.open('c1');
    await ready(open);

    await library.applyRemote(remoteCopy(withIdentity(contest, { hostSchoolName: 'Remote HS' }, T2)));
    const state = await ready(open);
    expect(state.contest.identity.hostSchoolName).toBe('Remote HS');
    expect(state.notice).toEqual({ origin: 'remote', at: T4 });

    open.set(withDetails(live(open), { contestDate: '2026-03-14' }, T3));
    await open.close();
    const stored = await readAfterReload('c1');
    expect(stored?.identity.hostSchoolName).toBe('Remote HS');
    expect(stored?.details.contestDate).toBe('2026-03-14');
  });

  it('dismissNotice clears the notice and keeps the contest', async () => {
    const contest = sampleContest();
    await library.add(contest);
    const open = library.open('c1');
    await ready(open);
    await library.applyRemote(remoteCopy(withIdentity(contest, { hostSchoolName: 'Remote HS' }, T2)));
    open.dismissNotice();
    const state = await ready(open);
    expect(state.notice).toBeNull();
    expect(state.contest.identity.hostSchoolName).toBe('Remote HS');
  });

  it('a pending session edit newer than the pulled copy survives, is written, and sets no notice', async () => {
    const contest = sampleContest();
    await library.add(contest);
    const open = library.open('c1');
    await ready(open);
    events.length = 0;

    open.set(withDetails(live(open), { contestDate: '2026-03-14' }, T3));
    await library.applyRemote(remoteCopy(withIdentity(contest, { hostSchoolName: 'Older Remote HS' }, T2)));

    const state = await ready(open);
    expect(state.notice).toBeNull();
    expect(state.contest.details.contestDate).toBe('2026-03-14');
    expect(state.contest.identity.hostSchoolName).toBe('Westlake HS');
    const stored = await readAfterReload('c1');
    expect(stored?.details.contestDate).toBe('2026-03-14');
    expect(stored?.identity.hostSchoolName).toBe('Westlake HS');
    // A device write, so the engine pushes it; no remote event.
    expect(events.map((e) => e.type === 'changed' && e.origin)).toEqual(['device']);
    expect(clock.pending).toBe(0);
  });

  it('a pending session edit older than the pulled copy loses to it, with the notice', async () => {
    const contest = sampleContest();
    await library.add(contest);
    const open = library.open('c1');
    await ready(open);

    open.set(withDetails(live(open), { contestDate: '2026-03-14' }, T2));
    await library.applyRemote(remoteCopy(withIdentity(contest, { hostSchoolName: 'Newer Remote HS' }, T3)));

    const state = await ready(open);
    expect(state.notice?.origin).toBe('remote');
    expect(state.contest.identity.hostSchoolName).toBe('Newer Remote HS');
    expect(clock.pending).toBe(0);
    await open.close();
    expect((await readAfterReload('c1'))?.identity.hostSchoolName).toBe('Newer Remote HS');
  });

  it('transform on an open contest runs on the unflushed live copy and loses no edit', async () => {
    await library.add(sampleContest());
    const open = library.open('c1');
    await ready(open);

    open.set(withDetails(live(open), { contestDate: '2026-03-14' }, T2));
    const result = await library.transform('c1', (fresh) => withIdentity(fresh, { hostSchoolName: 'Applied HS' }, T3));

    expect(result?.details.contestDate).toBe('2026-03-14');
    const state = await ready(open);
    expect(state.notice).toBeNull();
    expect(state.contest.identity.hostSchoolName).toBe('Applied HS');
    expect(state.contest.details.contestDate).toBe('2026-03-14');
    // Written at once, with both changes.
    const stored = await readAfterReload('c1');
    expect(stored?.identity.hostSchoolName).toBe('Applied HS');
    expect(stored?.details.contestDate).toBe('2026-03-14');
  });

  it('an identity transform on an open contest writes nothing and emits nothing', async () => {
    await library.add(sampleContest());
    const open = library.open('c1');
    await ready(open);
    events.length = 0;
    const before = live(open);
    expect(await library.transform('c1', (c) => c)).toBe(before);
    expect(events).toEqual([]);
  });

  it('a contest deleted while open puts the session in removed and drops its pending edit', async () => {
    await library.add(sampleContest());
    const open = library.open('c1');
    await ready(open);
    open.set(withDetails(live(open), { contestDate: '2026-03-14' }, T2));

    await library.remove('c1');
    expect(open.getState()).toEqual({ status: 'removed', origin: 'device' });
    await open.close();
    expect(await readAfterReload('c1')).toBeUndefined();
  });

  it('a write that lands while the session is loading is what the session opens with', async () => {
    const contest = sampleContest();
    await library.add(contest);
    const open = library.open('c1');
    expect(open.getState().status).toBe('loading');
    await library.applyRemote(remoteCopy(withIdentity(contest, { hostSchoolName: 'Remote HS' }, T2)));
    expect((await ready(open)).contest.identity.hostSchoolName).toBe('Remote HS');
  });
});

describe("the session's own changes never set the notice", () => {
  it('saves, checkpoint saves and checkpoint restores leave notice null', async () => {
    await library.add(sampleContest());
    const open = library.open('c1');
    await ready(open);

    open.set(withDetails(live(open), { contestDate: '2026-03-14' }, T2));
    const checkpoint = await open.checkpoints.save('Before change');
    expect(checkpoint.payload).toContain('2026-03-14');
    expect(clock.pending).toBe(0); // the save wrote the pending edit first

    open.set(withDetails(live(open), { contestDate: '2026-05-01' }, T3));
    clock.runAll();
    await vi.waitFor(async () => expect((await readAfterReload('c1'))?.details.contestDate).toBe('2026-05-01'));

    await open.checkpoints.restore(checkpoint.id);
    const state = await ready(open);
    expect(state.notice).toBeNull();
    expect(state.contest.details.contestDate).toBe('2026-03-14');
    expect((await readAfterReload('c1'))?.details.contestDate).toBe('2026-03-14');
    // The pre-restore state was auto-checkpointed.
    expect(await open.checkpoints.list()).toHaveLength(2);
  });
});

describe('pulls that are no longer newer', () => {
  it('a pull older than a local write that landed after it was planned is dropped', async () => {
    const contest = sampleContest();
    await library.add(withDetails(contest, { contestDate: '2026-03-14' }, T3));
    events.length = 0;
    await library.applyRemote(remoteCopy(withIdentity(contest, { hostSchoolName: 'Stale HS' }, T2)));
    const stored = await library.read('c1');
    expect(stored?.identity.hostSchoolName).toBe('Westlake HS');
    expect(stored?.details.contestDate).toBe('2026-03-14');
    expect(events).toEqual([]);
  });
});

/**
 * Reproductions of two data-loss bugs in the sync layer that were inferred by
 * reading code (#263, part of #262). Both run against the real store on
 * fake-indexeddb with the real library-backed sync store and a fake server, the
 * same way the app wires them in browserSync.ts.
 */
// The globals (IDBRequest and friends) for idb; each test still gets its own factory.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContestLibrary, type ContestLibrary } from './contestLibrary';
import { createSyncEngine, type SyncEngine } from './syncEngine';
import { createLibrarySyncStore } from './syncStore';
import { SyncHttpError, SyncNetworkError, type RemoteContest, type SyncClient } from './syncClient';
import { createContest, withDetails, withIdentity, type Contest } from '../model/contest';
import { serializeSyncBundle } from '../model/syncBundle';

const T0 = '2026-07-05T12:00:00.000Z';
const T1 = '2026-07-06T12:00:00.000Z';
const T2 = '2026-07-07T12:00:00.000Z';
const T3 = '2026-07-08T12:00:00.000Z';

let library: ContestLibrary;
beforeEach(() => {
  library = createContestLibrary({ idb: new IDBFactory(), clock: () => T0 });
});

/** A fake server holding contests in memory; `reachable` toggles network failure. */
function fakeServer() {
  const records = new Map<string, RemoteContest>();
  const removed: string[] = [];
  const state = { reachable: true };
  const guard = () => {
    if (!state.reachable) throw new SyncNetworkError();
  };
  const client: SyncClient = {
    async list() {
      guard();
      return [...records.values()].map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));
    },
    async get(id) {
      guard();
      const record = records.get(id);
      if (!record) throw new SyncHttpError(404);
      return record;
    },
    async create(body) {
      guard();
      records.set(body.id, { ...body });
    },
    async update(id, body) {
      guard();
      if (!records.has(id)) throw new SyncHttpError(404);
      records.set(id, { id, ...body });
    },
    async remove(id) {
      guard();
      removed.push(id);
      records.delete(id);
    },
  };
  const put = (contest: Contest) =>
    records.set(contest.id, {
      id: contest.id,
      name: 'Contest',
      updatedAt: contest.updatedAt,
      payload: serializeSyncBundle(contest, []),
    });
  return { client, records, removed, state, put };
}

/** A scheduler the test drains by hand; retries never fire on their own. */
function manualScheduler() {
  const tasks: Array<() => void | Promise<void>> = [];
  return {
    schedule(fn: () => void | Promise<void>) {
      tasks.push(fn);
    },
    async drain(max = 20) {
      let n = 0;
      while (tasks.length && n++ < max) await tasks.shift()!();
    },
    clear() {
      tasks.length = 0;
    },
  };
}

/** Builds an engine wired to the library's events, as startBrowserSync does. */
function wireEngine(client: SyncClient, scheduler: ReturnType<typeof manualScheduler>) {
  const engine: SyncEngine = createSyncEngine({
    client,
    store: createLibrarySyncStore(library),
    isOnline: () => true,
    schedule: scheduler.schedule,
    flushDelayMs: 0,
    backoff: () => 0,
  });
  const off = library.subscribe((event) => {
    if (event.origin === 'device') engine.markDirty(event.id, event.type === 'removed' ? 'delete' : 'save');
  });
  engine.start();
  return {
    engine,
    /** A page reload: the engine and its in-memory queue are gone. */
    dispose() {
      off();
      engine.stop();
      scheduler.clear();
    },
  };
}

function sampleContest(): Contest {
  let c = createContest({ id: 'c1', now: T0 });
  c = withIdentity(c, { hostSchoolName: 'Westlake HS' }, T1);
  return c;
}

describe('sync data-loss reproductions (#263)', () => {
  // Bug confirmed by this test. Fixed by package A slice A5 (#281): durable
  // delete tombstones on the device. Flip to `it` when that lands.
  it.fails('a contest deleted while the server is unreachable stays deleted after a reload', async () => {
    const server = fakeServer();
    const contest = sampleContest();
    server.put(contest);
    await library.save(contest);

    // Session 1: the server goes away, then the CM deletes the contest. The
    // delete push fails and stays queued in the engine's memory.
    const scheduler1 = manualScheduler();
    const session1 = wireEngine(server.client, scheduler1);
    await scheduler1.drain(1); // the start-up reconcile (nothing to do)
    server.state.reachable = false;
    await library.remove(contest.id);
    await scheduler1.drain(3);
    expect(server.removed).toEqual([]);
    session1.dispose();

    // Reload with the server back: a fresh engine over the same IndexedDB.
    server.state.reachable = true;
    const scheduler2 = manualScheduler();
    const session2 = wireEngine(server.client, scheduler2);
    await scheduler2.drain();
    session2.dispose();

    expect(await library.read(contest.id)).toBeUndefined();
    expect(server.records.has(contest.id)).toBe(false);
  });

  // Bug confirmed by this test, fixed by package A slice A2 (#278): the
  // workspace edits through an open-contest session, which a pull swaps to the
  // newer copy ("Updated from another device"), so the next save keeps it.
  it('a pull of the open contest is not overwritten by the next autosave', async () => {
    const server = fakeServer();
    const contest = sampleContest();
    await library.save(contest);

    // The Workspace opens the contest and holds its live copy.
    const open = library.open(contest.id);
    await vi.waitFor(() => expect(open.getState().status).toBe('ready'));

    // Another device renames the host school; this device pulls it into IndexedDB.
    const remote = withIdentity(contest, { hostSchoolName: 'Remote Edit HS' }, T2);
    server.put(remote);
    const scheduler = manualScheduler();
    const session = wireEngine(server.client, scheduler);
    await scheduler.drain();
    expect((await library.read(contest.id))?.identity.hostSchoolName).toBe('Remote Edit HS');

    // The CM keeps typing in the workspace; the session saves it.
    open.update((c) => withDetails(c, { contestDate: '2026-03-14' }, T3));
    await open.close();
    await scheduler.drain();
    session.dispose();

    const stored = (await library.read(contest.id))!;
    expect(stored.details.contestDate).toBe('2026-03-14');
    expect(stored.identity.hostSchoolName).toBe('Remote Edit HS');
    // And the edit reached the server.
    expect(server.records.get(contest.id)?.updatedAt).toBe(stored.updatedAt);
  });
});

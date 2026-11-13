/**
 * Reproductions of two data-loss bugs in the sync layer that were inferred by
 * reading code (#263, part of #262). Both run against the real library on
 * fake-indexeddb and the in-memory server, the way the app wires them in
 * browserLibrary.ts. Both bugs are fixed: the open-contest pull by slice A2
 * (#278) and the returning delete by slice A5 (#281).
 */
// The globals (IDBRequest and friends) for idb; each test still gets its own factory.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContestLibrary, type ContestLibrary } from './contestLibrary';
import { createMemoryContestServer, type MemoryContestServer } from './memoryContestServer';
import { createContest, withDetails, withIdentity, type Contest } from '../model/contest';

const T0 = '2026-07-05T12:00:00.000Z';
const T1 = '2026-07-06T12:00:00.000Z';
const T2 = '2026-07-07T12:00:00.000Z';
const T3 = '2026-07-08T12:00:00.000Z';

let factory: IDBFactory;
let server: MemoryContestServer;
let library: ContestLibrary;

/** A library over this device's IndexedDB; a second one models a page reload. */
function load(): ContestLibrary {
  return createContestLibrary({ idb: factory, clock: () => T2, server: server.server, backoff: () => 0 });
}

beforeEach(() => {
  factory = new IDBFactory();
  server = createMemoryContestServer();
  library = load();
});

function sampleContest(): Contest {
  let c = createContest({ id: 'c1', now: T0 });
  c = withIdentity(c, { hostSchoolName: 'Westlake HS' }, T1);
  return c;
}

describe('sync data-loss reproductions (#263)', () => {
  // Bug confirmed by #263, fixed by package A slice A5 (#281): the delete is a
  // durable tombstone on the device, which the next server pass sends.
  it('a contest deleted while the server is unreachable stays deleted after a reload', async () => {
    const contest = sampleContest();
    server.seed(contest);
    await library.add(contest);
    await library.sync.reconcileNow(); // in step with the server

    // Session 1: the server goes away, then the CM deletes the contest. The
    // delete cannot be sent.
    server.reachable = false;
    await library.remove(contest.id);
    await library.sync.reconcileNow();
    expect(server.contests.has(contest.id)).toBe(true);
    await library.close();

    // Reload with the server back: a fresh library over the same IndexedDB.
    server.reachable = true;
    const reloaded = load();
    await reloaded.sync.reconcileNow();
    await reloaded.sync.reconcileNow(); // and it stays gone on the next pass

    expect(await reloaded.read(contest.id)).toBeUndefined();
    expect(server.contests.has(contest.id)).toBe(false);
    expect(server.tombstones.has(contest.id)).toBe(true);
  });

  // Bug confirmed by this test, fixed by package A slice A2 (#278): the
  // workspace edits through an open-contest session, which a pull swaps to the
  // newer copy ("Updated from another device"), so the next save keeps it.
  it('a pull of the open contest is not overwritten by the next autosave', async () => {
    const contest = sampleContest();
    await library.save(contest);

    // The Workspace opens the contest and holds its live copy.
    const open = library.open(contest.id);
    await vi.waitFor(() => expect(open.getState().status).toBe('ready'));

    // Another device renames the host school; this device pulls it into IndexedDB.
    server.seed(withIdentity(contest, { hostSchoolName: 'Remote Edit HS' }, T2));
    await library.sync.reconcileNow();
    expect((await library.read(contest.id))?.identity.hostSchoolName).toBe('Remote Edit HS');

    // The CM keeps typing in the workspace; the session saves it.
    open.update((c) => withDetails(c, { contestDate: '2026-03-14' }, T3));
    await open.close();
    await library.sync.reconcileNow();

    const stored = (await library.read(contest.id))!;
    expect(stored.details.contestDate).toBe('2026-03-14');
    expect(stored.identity.hostSchoolName).toBe('Remote Edit HS');
    // And the edit reached the server.
    expect(server.contests.get(contest.id)?.updatedAt).toBe((await library.list())[0].updatedAt);
  });
});

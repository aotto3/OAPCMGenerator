/**
 * Boundary tests for the IndexedDB contest store, run against fake-indexeddb — the
 * client-side mirror of how the server tests real repo code against pg-mem. This
 * file exercises the REAL contestStore (save/get/list/delete) so the persistence
 * logic that was previously only reachable in a browser is verifiable in the node
 * suite.
 *
 * `fake-indexeddb/auto` installs the IndexedDB globals; `__resetStoreForTests`
 * (a test-only hook) forgets the cached DB handle, clears the notifier registries,
 * and deletes the database between tests so each starts from an empty store.
 */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetStoreForTests,
  deleteContest,
  getContest,
  listContests,
  saveContest,
} from './contestStore';
import {
  createContest,
  withDetails,
  withIdentity,
  withSpeechwire,
  type Contest,
} from '../model/contest';

const NOW = '2026-07-05T12:00:00.000Z';

afterEach(async () => {
  await __resetStoreForTests();
});

/** A realistic saved contest with device-only Speechwire credentials set. */
function sampleContest(): Contest {
  let c = createContest({ id: 'store-rt', now: NOW });
  c = withIdentity(
    c,
    { hostSchoolName: 'Westlake HS', contestLevel: 'District', classification: '5A', contestYear: '2026' },
    NOW,
  );
  c = withDetails(c, { contestDate: '2026-03-14' }, NOW);
  c = withSpeechwire(c, { username: 'cm@speechwire', password: 's3cret' }, NOW);
  return c;
}

describe('contestStore — save/get round-trip (fake-indexeddb)', () => {
  it('round-trips a saved contest through IndexedDB', async () => {
    const contest = sampleContest();
    await saveContest(contest);
    expect(await getContest(contest.id)).toEqual(contest);
  });

  it("re-attaches this device's Speechwire credentials on read (device-only, kept beside the payload)", async () => {
    await saveContest(sampleContest());
    const loaded = await getContest('store-rt');
    expect(loaded?.speechwire).toEqual({ username: 'cm@speechwire', password: 's3cret' });
  });

  it('returns undefined for a contest that was never saved', async () => {
    expect(await getContest('nope')).toBeUndefined();
  });

  it('lists a saved contest and drops it on delete', async () => {
    await saveContest(sampleContest());
    expect((await listContests()).map((s) => s.id)).toEqual(['store-rt']);
    await deleteContest('store-rt');
    expect(await listContests()).toEqual([]);
  });

  it('isolates data between tests — the previous test does not leak in', async () => {
    expect(await listContests()).toEqual([]);
  });
});

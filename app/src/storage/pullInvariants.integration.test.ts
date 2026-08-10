/**
 * The sync PULL-path safety invariants, tested against the real store on
 * fake-indexeddb. These are the guarantees that make background sync correct, and
 * they previously lived only in untested store code:
 *
 *  - a pull emits a UI "pulled" signal but never a "change" (a pull must not
 *    bounce back up as a push — the loop-prevention headline);
 *  - a pull replaces the contest's checkpoints wholesale and stamps the server's
 *    updatedAt clock, while preserving this device's Speechwire credentials;
 *  - the checkpointStore CRUD + the contest-clock bump that propagates checkpoint
 *    changes through the sync bundle.
 */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetStoreForTests,
  bumpContestForCheckpointChange,
  getContest,
  listContests,
  onContestChanged,
  onContestPulled,
  putPulledContest,
  saveContest,
  type ContestChangeType,
} from './contestStore';
import {
  createCheckpoint,
  deleteCheckpoint,
  listCheckpoints,
  updateCheckpointNote,
} from './checkpointStore';
import { browserSyncStore } from './syncStore';
import {
  createContest,
  defaultSpeechwire,
  serializeContest,
  withDetails,
  withIdentity,
  withSpeechwire,
  type Contest,
} from '../model/contest';
import { makeCheckpoint } from '../model/checkpoint';
import { bundleFromEnvelope, parseSyncBundle, serializeSyncBundle } from '../model/syncBundle';

const NOW = '2026-07-05T12:00:00.000Z';
const SERVER_CLOCK = '2026-08-02T00:00:00.000Z';

afterEach(async () => {
  await __resetStoreForTests();
});

function sampleContest(): Contest {
  let c = createContest({ id: 'pull-c', now: NOW });
  c = withIdentity(c, { hostSchoolName: 'Westlake HS' }, NOW);
  c = withDetails(c, { contestDate: '2026-03-14' }, NOW);
  c = withSpeechwire(c, { username: 'cm@speechwire', password: 's3cret' }, NOW);
  return c;
}

/** Records what each notifier channel fires during a block of work. */
function watchNotifiers() {
  const changes: Array<[string, ContestChangeType]> = [];
  const pulls: string[] = [];
  const offChange = onContestChanged((id, type) => changes.push([id, type]));
  const offPulled = onContestPulled((id) => pulls.push(id));
  return { changes, pulls, stop: () => (offChange(), offPulled()) };
}

describe('pull loop-prevention (the headline invariant)', () => {
  it('putPulledContest emits "pulled" but never "change" (no push is enqueued)', async () => {
    const contest = sampleContest();
    const w = watchNotifiers();
    await putPulledContest(contest, [], SERVER_CLOCK);
    w.stop();
    expect(w.pulls).toEqual([contest.id]);
    expect(w.changes).toEqual([]);
  });

  it('syncStore.applyRemote lands a pulled bundle through putPulledContest (still no "change")', async () => {
    const contest = sampleContest();
    const w = watchNotifiers();
    await browserSyncStore.applyRemote(contest.id, {
      name: 'ignored',
      updatedAt: SERVER_CLOCK,
      payload: serializeSyncBundle(contest, []),
    });
    w.stop();
    expect(w.pulls).toEqual([contest.id]);
    expect(w.changes).toEqual([]);
    expect((await getContest(contest.id))?.id).toBe(contest.id);
  });
});

describe('pull write semantics', () => {
  it('replaces the contest checkpoints wholesale and stamps the server updatedAt', async () => {
    const contest = sampleContest();
    await saveContest(contest);
    await createCheckpoint(contest, 'local snapshot', '', NOW);
    expect((await listCheckpoints(contest.id)).map((c) => c.name)).toEqual(['local snapshot']);

    const fromServer = makeCheckpoint(contest, 'from server', '', '2026-08-01T00:00:00.000Z', 'cp-server');
    await putPulledContest(contest, [fromServer], SERVER_CLOCK);

    expect((await listCheckpoints(contest.id)).map((c) => c.name)).toEqual(['from server']);
    expect((await listContests()).find((s) => s.id === contest.id)?.updatedAt).toBe(SERVER_CLOCK);
  });

  it('preserves this device Speechwire credentials on pull (device-only data never travels)', async () => {
    const contest = sampleContest();
    await saveContest(contest); // stores deviceOnly = the creds
    // A pulled contest arrives with blank creds (they are stripped from the bundle).
    await putPulledContest({ ...contest, speechwire: defaultSpeechwire() }, [], SERVER_CLOCK);
    expect((await getContest(contest.id))?.speechwire).toEqual({
      username: 'cm@speechwire',
      password: 's3cret',
    });
  });
});

describe('checkpointStore CRUD + contest-clock bump', () => {
  it('creates, lists newest-first, edits notes, and deletes checkpoints', async () => {
    const contest = sampleContest();
    await saveContest(contest);
    const cp1 = await createCheckpoint(contest, 'first', 'note1', '2026-07-05T10:00:00.000Z');
    const cp2 = await createCheckpoint(contest, 'second', '', '2026-07-05T11:00:00.000Z');

    expect((await listCheckpoints(contest.id)).map((c) => c.name)).toEqual(['second', 'first']);

    await updateCheckpointNote(cp1.id, '  edited  ');
    expect((await listCheckpoints(contest.id)).find((c) => c.id === cp1.id)?.note).toBe('edited');

    await deleteCheckpoint(cp2.id);
    expect((await listCheckpoints(contest.id)).map((c) => c.name)).toEqual(['first']);
  });

  it('bumpContestForCheckpointChange advances updatedAt and emits a "save" change', async () => {
    const contest = sampleContest();
    await saveContest(contest);
    const w = watchNotifiers();
    await bumpContestForCheckpointChange(contest.id, '2026-08-09T00:00:00.000Z');
    w.stop();
    expect(w.changes).toEqual([[contest.id, 'save']]);
    expect((await listContests()).find((s) => s.id === contest.id)?.updatedAt).toBe('2026-08-09T00:00:00.000Z');
  });

  it('bumpContestForCheckpointChange is a no-op when the contest is not stored', async () => {
    const w = watchNotifiers();
    await bumpContestForCheckpointChange('ghost', NOW);
    w.stop();
    expect(w.changes).toEqual([]);
  });
});

describe('sync-bundle envelope round-trip (the checkpoint superset)', () => {
  it('bundleFromEnvelope + parseSyncBundle preserve the contest and its checkpoints', () => {
    const contest = sampleContest();
    const checkpoint = makeCheckpoint(contest, 'snap', 'a note', NOW, 'cp1');
    const bundle = bundleFromEnvelope(serializeContest(contest), [checkpoint]);
    const parsed = parseSyncBundle(bundle);
    expect(parsed.contest.id).toBe(contest.id);
    expect(parsed.checkpoints).toEqual([checkpoint]);
    // The contest envelope never carries device-only credentials.
    expect(parsed.contest.speechwire).toEqual(defaultSpeechwire());
  });
});

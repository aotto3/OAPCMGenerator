/**
 * Boundary tests for the contest library (RFC #276, slice A1 #277), run against
 * fake-indexeddb with a manual clock. Each test gets its own IDBFactory, so a
 * second library on the same factory models a reload of the same device.
 */
// The globals (IDBRequest and friends) that idb checks against.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { wrap } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createContestLibrary,
  nextVersion,
  summarize,
  type ContestEvent,
  type ContestLibrary,
} from './contestLibrary';
import { createMemoryContestServer, type MemoryContestServer } from './memoryContestServer';
import {
  createContest,
  effectiveContestTitle,
  serializeContest,
  withArchived,
  withDetails,
  withIdentity,
  withSpeechwire,
  type Contest,
} from '../model/contest';
import { makeCheckpoint } from '../model/checkpoint';
import { parseSyncBundle } from '../model/syncBundle';

const T0 = '2026-07-05T12:00:00.000Z';
const T1 = '2026-07-06T12:00:00.000Z';
const T2 = '2026-07-07T12:00:00.000Z';
const FUTURE = '2027-01-01T00:00:00.000Z';

let factory: IDBFactory;
let server: MemoryContestServer;
let now: string;
let library: ContestLibrary;
let events: ContestEvent[];

function open(): ContestLibrary {
  return createContestLibrary({ idb: factory, clock: () => now, server: server.server });
}

beforeEach(() => {
  factory = new IDBFactory();
  server = createMemoryContestServer();
  now = T2;
  library = open();
  events = [];
  library.subscribe((e) => events.push(e));
});

function sampleContest(id = 'c1'): Contest {
  let c = createContest({ id, now: T0 });
  c = withIdentity(c, { hostSchoolName: 'Westlake HS', contestLevel: 'District', classification: '5A', contestYear: '2026' }, T1);
  c = withDetails(c, { contestDate: '2026-03-14' }, T1);
  c = withSpeechwire(c, { username: 'cm@speechwire', password: 's3cret' }, T1);
  return c;
}

/** Every listed summary equals `summarize` of the stored contest at the listed version. */
async function expectListMatchesSummarize(lib: ContestLibrary = library): Promise<void> {
  const list = await lib.list();
  for (const summary of list) {
    const contest = await lib.read(summary.id);
    expect(contest).toBeDefined();
    expect(summary).toEqual(summarize(contest!, summary.updatedAt));
  }
}

function versionOf(list: { id: string; updatedAt: string }[], id: string): string | undefined {
  return list.find((s) => s.id === id)?.updatedAt;
}

describe('save, read and list', () => {
  it('round-trips a contest, re-attaching device-only credentials, and survives a reload', async () => {
    const contest = sampleContest();
    await library.save(contest);
    expect(await library.read(contest.id)).toEqual(contest);

    await library.close();
    const reloaded = open();
    expect(await reloaded.read(contest.id)).toEqual(contest);
    expect((await reloaded.readAll()).map((c) => c.id)).toEqual([contest.id]);
  });

  it('returns undefined for a contest that was never stored', async () => {
    expect(await library.read('nope')).toBeUndefined();
  });

  it('list matches summarize after a save, and the save emits a device event', async () => {
    const contest = sampleContest();
    await library.save(contest);
    await expectListMatchesSummarize();
    expect((await library.list())[0].name).toBe(effectiveContestTitle(contest));
    expect(events).toEqual([
      { type: 'changed', id: contest.id, origin: 'device', by: undefined, contest, summary: summarize(contest) },
    ]);
  });

  it('a legacy record missing denormalized fields lists from its payload', async () => {
    const contest = withArchived(sampleContest(), true, T1);
    await library.list(); // creates the schema
    await library.close();
    // Write a record the way an old build did: name and version only.
    const raw = (await wrap(factory.open('oap-contest-manager')))!;
    await raw.put('contests', {
      id: contest.id,
      name: 'Old Name',
      updatedAt: T1,
      payload: serializeContest(contest),
    });
    raw.close();

    const list = await open().list();
    expect(list).toEqual([{ ...summarize(contest, T1), name: 'Old Name' }]);
  });
});

describe('add', () => {
  it('stores a new contest, lists it, and emits a device event', async () => {
    const contest = sampleContest('new');
    await library.add(contest);
    expect(await library.read('new')).toEqual(contest);
    await expectListMatchesSummarize();
    expect(events.map((e) => [e.type, 'id' in e && e.id, 'origin' in e && e.origin])).toEqual([['changed', 'new', 'device']]);
  });
});

describe('transform', () => {
  it('reads fresh, applies the function, persists, and tags the event', async () => {
    await library.save(sampleContest());
    events.length = 0;

    const result = await library.transform('c1', (fresh) => withArchived(fresh, true, T2), { by: 'dashboard' });

    expect(result?.archived).toBe(true);
    expect((await library.read('c1'))?.archived).toBe(true);
    await expectListMatchesSummarize();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'changed', id: 'c1', origin: 'device', by: 'dashboard' });
  });

  it('the function sees this device credentials (they are kept on write)', async () => {
    await library.save(sampleContest());
    let seen: Contest | undefined;
    await library.transform('c1', (fresh) => ((seen = fresh), withArchived(fresh, true, T2)));
    expect(seen?.speechwire.password).toBe('s3cret');
    expect((await library.read('c1'))?.speechwire.password).toBe('s3cret');
  });

  it('returns undefined for a missing contest and writes nothing', async () => {
    let called = false;
    const result = await library.transform('ghost', (c) => ((called = true), c));
    expect(result).toBeUndefined();
    expect(called).toBe(false);
    expect(await library.list()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('an identity return is a no-op: no write, no event, version unchanged', async () => {
    await library.save(sampleContest());
    const before = await library.list();
    events.length = 0;

    const result = await library.transform('c1', (fresh) => fresh);

    expect(result?.id).toBe('c1');
    expect(events).toEqual([]);
    expect(await library.list()).toEqual(before);
  });
});

describe('remove', () => {
  it('deletes the contest and its checkpoints, and emits a device removal', async () => {
    const contest = sampleContest();
    await library.save(contest);
    await library.checkpoints.save(contest, 'snap');
    await library.save(sampleContest('other'));
    await library.checkpoints.save(sampleContest('other'), 'keep me');
    events.length = 0;

    await library.remove(contest.id);

    expect(await library.read(contest.id)).toBeUndefined();
    expect(await library.checkpoints.list(contest.id)).toEqual([]);
    expect((await library.checkpoints.list('other')).map((c) => c.name)).toEqual(['keep me']);
    expect(events).toEqual([{ type: 'removed', id: contest.id, origin: 'device' }]);
  });
});

describe('checkpoints', () => {
  it('saving a checkpoint and bumping the version land together, before the event', async () => {
    const contest = sampleContest();
    await library.save(contest);
    const before = versionOf(await library.list(), contest.id)!;
    events.length = 0;

    const seenAtEvent: Array<{ names: string[]; version: string | undefined }> = [];
    const off = library.subscribe(() => {
      void Promise.all([library.checkpoints.list(contest.id), library.list()]).then(([cps, list]) =>
        seenAtEvent.push({ names: cps.map((c) => c.name), version: versionOf(list, contest.id) }),
      );
    });
    now = '2026-07-09T00:00:00.000Z';
    const checkpoint = await library.checkpoints.save(contest, 'snap', 'a note');
    await new Promise((r) => setTimeout(r, 0));
    off();

    expect(checkpoint).toMatchObject({ contestId: contest.id, name: 'snap', note: 'a note', createdAt: now });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'changed', id: contest.id, origin: 'device' });
    expect(seenAtEvent).toEqual([{ names: ['snap'], version: now }]);
    expect(now > before).toBe(true);
    await expectListMatchesSummarize();
  });

  it('a checkpoint of an unstored draft is kept but emits nothing', async () => {
    const draft = createContest({ id: 'draft', now: T0 });
    await library.checkpoints.save(draft, 'early');
    expect((await library.checkpoints.list('draft')).map((c) => c.name)).toEqual(['early']);
    expect(await library.list()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('lists newest first, edits notes (trimmed), and deletes, each moving the version', async () => {
    const contest = sampleContest();
    await library.save(contest);
    now = '2026-07-08T10:00:00.000Z';
    const first = await library.checkpoints.save(contest, 'first', 'note1');
    now = '2026-07-08T11:00:00.000Z';
    const second = await library.checkpoints.save(contest, 'second');
    expect((await library.checkpoints.list(contest.id)).map((c) => c.name)).toEqual(['second', 'first']);

    now = '2026-07-08T12:00:00.000Z';
    await library.checkpoints.setNote(first.id, '  edited  ');
    expect((await library.checkpoints.list(contest.id)).find((c) => c.id === first.id)?.note).toBe('edited');
    expect(versionOf(await library.list(), contest.id)).toBe(now);

    now = '2026-07-08T13:00:00.000Z';
    await library.checkpoints.remove(second.id);
    expect((await library.checkpoints.list(contest.id)).map((c) => c.name)).toEqual(['first']);
    expect(versionOf(await library.list(), contest.id)).toBe(now);
    await expectListMatchesSummarize();
  });

  it('setNote and remove on a missing checkpoint do nothing', async () => {
    await library.checkpoints.setNote('ghost', 'x');
    await library.checkpoints.remove('ghost');
    expect(events).toEqual([]);
  });

  it('restore auto-checkpoints the live copy and stores the restored contest in one write', async () => {
    const original = sampleContest();
    await library.save(original);
    now = '2026-07-08T00:00:00.000Z';
    const checkpoint = await library.checkpoints.save(original, 'before rename');
    const live = withIdentity(original, { hostSchoolName: 'Renamed HS' }, '2026-07-08T01:00:00.000Z');
    events.length = 0;

    now = '2026-07-09T00:00:00.000Z';
    const restored = await library.checkpoints.restore(live, checkpoint.id);

    expect(restored.identity.hostSchoolName).toBe('Westlake HS');
    expect(restored.speechwire.password).toBe('s3cret');
    expect((await library.read(original.id))?.identity.hostSchoolName).toBe('Westlake HS');
    const names = (await library.checkpoints.list(original.id)).map((c) => c.name);
    expect(names).toHaveLength(2);
    expect(names).toContain('before rename');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'changed', origin: 'device' });
    await expectListMatchesSummarize();
  });

  it('restore of a missing checkpoint throws and writes nothing', async () => {
    await library.save(sampleContest());
    events.length = 0;
    await expect(library.checkpoints.restore(sampleContest(), 'ghost')).rejects.toThrow('Checkpoint not found.');
    expect(events).toEqual([]);
  });
});

describe('pulls and pushes through the server port', () => {
  const changes = () => events.filter((e) => e.type !== 'reconciled');

  it('a pull stamps the server version, replaces checkpoints, keeps credentials, and emits a remote event', async () => {
    const contest = sampleContest();
    await library.save(contest);
    await library.checkpoints.save(contest, 'local snapshot');
    events.length = 0;

    const remoteCopy = withIdentity(contest, { hostSchoolName: 'Remote HS' }, T2);
    const fromServer = makeCheckpoint(remoteCopy, 'from server', '', T2, 'cp-server');
    server.seed(remoteCopy, { version: FUTURE, checkpoints: [fromServer] });
    await library.sync.reconcileNow();

    const stored = await library.read(contest.id);
    expect(stored?.identity.hostSchoolName).toBe('Remote HS');
    expect(stored?.speechwire).toEqual({ username: 'cm@speechwire', password: 's3cret' });
    expect((await library.checkpoints.list(contest.id)).map((c) => c.name)).toEqual(['from server']);
    expect(versionOf(await library.list(), contest.id)).toBe(FUTURE);
    await expectListMatchesSummarize();
    expect(changes()).toHaveLength(1);
    expect(changes()[0]).toMatchObject({ type: 'changed', id: contest.id, origin: 'remote' });
    expect(events.at(-1)).toEqual({ type: 'reconciled' });
  });

  it('a pull of a contest new to this device stores it with blank credentials', async () => {
    server.seed(sampleContest('fresh'));
    await library.sync.reconcileNow();
    expect((await library.read('fresh'))?.speechwire).toEqual({ username: '', password: '' });
    await expectListMatchesSummarize();
  });

  it('the push carries the contest and its checkpoints at the stored version, never the credentials', async () => {
    const contest = sampleContest();
    await library.save(contest);
    await library.checkpoints.save(contest, 'snap');
    await library.sync.reconcileNow();

    const pushed = server.contests.get(contest.id)!;
    expect(pushed.name).toBe(effectiveContestTitle(contest));
    expect(pushed.updatedAt).toBe(versionOf(await library.list(), contest.id));
    const parsed = parseSyncBundle(pushed.payload);
    expect(parsed.contest.identity.hostSchoolName).toBe('Westlake HS');
    expect(parsed.checkpoints.map((c) => c.name)).toEqual(['snap']);
    // No call to the server port ever carries a credential.
    expect(JSON.stringify(server.calls)).not.toContain('s3cret');
    expect(JSON.stringify(server.calls)).not.toContain('cm@speechwire');
  });
});

describe('the version rule', () => {
  it('after pulling a copy stamped in the future, a local edit still counts as newer', async () => {
    const contest = sampleContest();
    server.seed(contest, { version: FUTURE });
    await library.sync.reconcileNow();

    // This device's clock is behind the other device's: the edit stamps T2 < FUTURE.
    const pulled = (await library.read(contest.id))!;
    await library.save(withDetails(pulled, { contestDate: '2026-04-01' }, T2));

    const version = versionOf(await library.list(), contest.id)!;
    expect(Date.parse(version)).toBeGreaterThan(Date.parse(FUTURE));
    await library.sync.reconcileNow();
    expect(server.contests.get(contest.id)?.updatedAt).toBe(version);
    expect(parseSyncBundle(server.contests.get(contest.id)!.payload).contest.details.contestDate).toBe('2026-04-01');
  });

  it('is the later of the contest updatedAt and one millisecond past the stored version', () => {
    expect(nextVersion(T1, undefined)).toBe(T1);
    expect(nextVersion(T2, T1)).toBe(T2);
    expect(nextVersion(T1, T2)).toBe('2026-07-07T12:00:00.001Z');
    expect(nextVersion(T1, T1)).toBe('2026-07-06T12:00:00.001Z');
  });
});

describe('automatic checkpoints (PRD #304, #309)', () => {
  const at = (i: number) => `2026-08-01T00:00:${String(i).padStart(2, '0')}.000Z`;

  it('stores the given (pre-change) state, marked automatic, and moves the contest version', async () => {
    const before = sampleContest();
    await library.save(before);
    const versionBefore = versionOf(await library.list(), before.id);
    now = at(1);
    const cp = await library.checkpoints.saveAuto(before, 'Before re-draw');
    expect(cp).toMatchObject({ name: 'Before re-draw', auto: true, contestId: before.id });
    const [listed] = await library.checkpoints.list(before.id);
    expect(listed).toMatchObject({ id: cp.id, auto: true });
    expect(versionOf(await library.list(), before.id)).not.toBe(versionBefore);
  });

  it('keeps only the newest 10 automatic checkpoints and never prunes named or Before-restore ones', async () => {
    const contest = sampleContest();
    await library.save(contest);
    now = at(0);
    const named = await library.checkpoints.save(contest, 'my named one');
    for (let i = 1; i <= 12; i++) {
      now = at(i);
      await library.checkpoints.saveAuto(contest, `auto ${i}`);
    }
    // A restore's "Before restore" checkpoint is not automatic, so it is never pruned either.
    now = at(13);
    await library.checkpoints.restore(contest, named.id);
    now = at(14);
    await library.checkpoints.saveAuto(contest, 'auto 13');

    const list = await library.checkpoints.list(contest.id);
    const autos = list.filter((c) => c.auto).map((c) => c.name);
    expect(autos).toHaveLength(10);
    expect(autos[0]).toBe('auto 13');
    expect(autos).not.toContain('auto 1');
    expect(autos).not.toContain('auto 3');
    expect(list.map((c) => c.name)).toContain('my named one');
    expect(list.some((c) => !c.auto && c.name.startsWith('Before restore'))).toBe(true);
  });

  it('prunes per contest: another contest keeps its own automatic checkpoints', async () => {
    const a = sampleContest('a');
    const b = sampleContest('b');
    await library.save(a);
    await library.save(b);
    now = at(0);
    await library.checkpoints.saveAuto(b, 'b only');
    for (let i = 1; i <= 11; i++) {
      now = at(i);
      await library.checkpoints.saveAuto(a, `a ${i}`);
    }
    expect((await library.checkpoints.list('b')).map((c) => c.name)).toEqual(['b only']);
    expect(await library.checkpoints.list('a')).toHaveLength(10);
  });

  it('restoring an automatic checkpoint returns the state from before the change', async () => {
    const before = sampleContest();
    await library.save(before);
    now = at(1);
    const cp = await library.checkpoints.saveAuto(before, 'Before clearing results');
    const after = withIdentity(before, { hostSchoolName: 'Changed HS' }, at(2));
    await library.save(after);
    now = at(3);
    const restored = await library.checkpoints.restore(after, cp.id);
    expect(restored.identity.hostSchoolName).toBe('Westlake HS');
  });

  it('the automatic marker survives the sync bundle round trip', async () => {
    const contest = sampleContest();
    await library.save(contest);
    now = at(1);
    await library.checkpoints.save(contest, 'named');
    now = at(2);
    await library.checkpoints.saveAuto(contest, 'Before unlocking the draw');
    await library.sync.reconcileNow();
    const parsed = parseSyncBundle(server.contests.get(contest.id)!.payload);
    const byName = Object.fromEntries(parsed.checkpoints.map((c) => [c.name, c.auto]));
    expect(byName).toEqual({ named: undefined, 'Before unlocking the draw': true });
  });
});

/**
 * Boundary tests for the library's convergence with the server (RFC #276,
 * slice A5 #281): delete tombstones on both sides, two devices on one account,
 * an older client without tombstone support, the device-only guarantee, and
 * the loop's retry, 401 pause, poison-write and status behavior.
 *
 * Each device is a real library on its own fake-indexeddb, with a manual
 * clock, manual timers, a manual online flag and a manual wake port. Devices
 * share one in-memory server, which implements the server's tombstone rules;
 * the shared case table from #280 is asserted against it at the end.
 */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContestLibrary, type ContestLibrary, type SyncStatus, type Timers } from './contestLibrary';
import { FLUSH_DELAY_MS, planSync, WAKE_THROTTLE_MS } from './librarySync';
import { createMemoryContestServer, type MemoryContestServer } from './memoryContestServer';
import { backoffDelay } from './syncBackoff';
import { SyncHttpError, SyncNetworkError, type RemoteContest } from './syncClient';
import { createContest, withDetails, withIdentity, withSpeechwire, type Contest } from '../model/contest';
import { parseSyncBundle, serializeSyncBundle } from '../model/syncBundle';

const T0 = '2026-09-01T08:00:00.000Z';
const T1 = '2026-09-01T09:00:00.000Z';
const T2 = '2026-09-01T10:00:00.000Z';
const T3 = '2026-09-01T11:00:00.000Z';
const T4 = '2026-09-01T12:00:00.000Z';

/** A few macrotask rounds, enough for fake-indexeddb and the loop's awaits to drain. */
async function idle(rounds = 25): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

interface Device {
  library: ContestLibrary;
  factory: IDBFactory;
  setNow(iso: string): void;
  setOnline(online: boolean): void;
  wake(): void;
  /** Delays of the timers pending right now. */
  delays(): number[];
  /** Fires the timers pending right now, then lets their work drain. */
  fire(): Promise<void>;
  statuses: SyncStatus[];
}

function device(server: MemoryContestServer, factory = new IDBFactory(), start = T0): Device {
  let now = start;
  let online = true;
  const onlineListeners = new Set<(online: boolean) => void>();
  const wakeListeners = new Set<() => void>();
  const pending = new Map<number, { fn: () => void; ms: number }>();
  let next = 0;
  const timers: Timers = {
    set(fn, ms) {
      pending.set(++next, { fn, ms });
      return next;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
  };
  const library = createContestLibrary({
    idb: factory,
    clock: () => now,
    timers,
    server: server.server,
    online: {
      isOnline: () => online,
      onChange(listener) {
        onlineListeners.add(listener);
        return () => onlineListeners.delete(listener);
      },
    },
    wake(listener) {
      wakeListeners.add(listener);
      return () => wakeListeners.delete(listener);
    },
  });
  const statuses: SyncStatus[] = [];
  library.sync.onStatus((s) => statuses.push(s));
  return {
    library,
    factory,
    statuses,
    setNow: (iso) => (now = iso),
    setOnline(value) {
      online = value;
      for (const listener of [...onlineListeners]) listener(value);
    },
    wake() {
      for (const listener of [...wakeListeners]) listener();
    },
    delays: () => [...pending.values()].map((t) => t.ms),
    async fire() {
      const due = [...pending.values()];
      pending.clear();
      for (const t of due) t.fn();
      await idle();
    },
  };
}

function sample(id = 'c1', at = T0): Contest {
  return withIdentity(createContest({ id, now: at }), { hostSchoolName: 'Westlake HS' }, at);
}

let server: MemoryContestServer;
beforeEach(() => {
  server = createMemoryContestServer();
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Two devices on one account, both holding `c1` at T0. */
async function twoDevices(): Promise<{ a: Device; b: Device }> {
  const a = device(server);
  const b = device(server);
  await a.library.add(sample());
  await a.library.sync.reconcileNow();
  await b.library.sync.reconcileNow();
  expect(await b.library.read('c1')).toBeDefined();
  return { a, b };
}

describe('the tombstone table, two devices on one server', () => {
  it('local tombstone, newer remote contest: the contest is pulled back and the tombstone cleared', async () => {
    const { a, b } = await twoDevices();
    // A deletes at T1 but cannot send it yet.
    a.setNow(T1);
    server.reachable = false;
    await a.library.remove('c1');
    await a.library.sync.reconcileNow();
    server.reachable = true;
    // B edits after the delete and syncs first.
    const edited = withDetails((await b.library.read('c1'))!, { contestDate: '2027-03-25' }, T2);
    await b.library.save(edited);
    await b.library.sync.reconcileNow();

    await a.library.sync.reconcileNow();
    expect((await a.library.read('c1'))?.details.contestDate).toBe('2027-03-25');
    // The tombstone is gone: another pass does not delete it on the server.
    await a.library.sync.reconcileNow();
    expect(server.contests.has('c1')).toBe(true);
    expect(server.tombstones.has('c1')).toBe(false);
  });

  it('local tombstone, older remote contest: deleted on the server, then everywhere', async () => {
    const { a, b } = await twoDevices();
    a.setNow(T2);
    await a.library.remove('c1');
    await a.library.sync.reconcileNow();
    expect(server.contests.has('c1')).toBe(false);
    expect(server.tombstones.get('c1')).toBe(T2);

    // B's copy (T0) is older than the delete: removed on B.
    await b.library.sync.reconcileNow();
    expect(await b.library.read('c1')).toBeUndefined();
    expect(await a.library.read('c1')).toBeUndefined();
  });

  it('local contest newer than the remote tombstone: pushed, and it survives on both', async () => {
    const { a, b } = await twoDevices();
    // B (offline) edits at T3; A deletes at T2 and syncs.
    const edited = withDetails((await b.library.read('c1'))!, { contestDate: '2027-03-25' }, T3);
    await b.library.save(edited);
    a.setNow(T2);
    await a.library.remove('c1');
    await a.library.sync.reconcileNow();
    expect(server.tombstones.get('c1')).toBe(T2);

    // B comes online: its newer edit beats the delete.
    await b.library.sync.reconcileNow();
    expect(server.contests.get('c1')?.updatedAt).toBe(T3);
    expect(server.tombstones.has('c1')).toBe(false);
    await a.library.sync.reconcileNow();
    expect((await a.library.read('c1'))?.details.contestDate).toBe('2027-03-25');
    expect((await b.library.read('c1'))?.details.contestDate).toBe('2027-03-25');
  });

  it('local contest at or before the remote tombstone: removed locally, an open session becomes removed', async () => {
    const { a, b } = await twoDevices();
    const open = b.library.open('c1');
    await vi.waitFor(() => expect(open.getState().status).toBe('ready'));
    const events: string[] = [];
    b.library.subscribe((e) => events.push(e.type === 'reconciled' ? e.type : `${e.type}:${e.origin}`));

    a.setNow(T1);
    await a.library.remove('c1');
    await a.library.sync.reconcileNow();
    await b.library.sync.reconcileNow();

    expect(open.getState()).toEqual({ status: 'removed', origin: 'remote' });
    expect(events).toEqual(['removed:remote', 'reconciled']);
    expect(await b.library.list()).toEqual([]);
    await open.close();
  });

  it('a push answered gone (the delete won while queued) removes the local copy', async () => {
    const { a, b } = await twoDevices();
    const disconnect = b.library.sync.connect();
    await b.fire(); // the start-up pass
    a.setNow(T3);
    await a.library.remove('c1');
    await a.library.sync.reconcileNow();

    // B's clock runs behind: its edit is stamped T1, before A's delete at T3.
    await b.library.save(withDetails((await b.library.read('c1'))!, { contestDate: '2027-03-25' }, T1));
    await b.fire(); // the debounced push: 410
    expect(server.calls.at(-1)).toMatchObject({ method: 'update', id: 'c1' });
    expect(await b.library.read('c1')).toBeUndefined();
    expect(server.contests.has('c1')).toBe(false);
    disconnect();
  });

  it('a delete answered newer (edited elsewhere after the delete) pulls the edit back', async () => {
    const { a, b } = await twoDevices();
    a.setNow(T1);
    const disconnect = a.library.sync.connect();
    await a.fire();
    // B's edit at T2 reaches the server before A's queued delete at T1 is sent.
    await b.library.save(withDetails((await b.library.read('c1'))!, { contestDate: '2027-03-25' }, T2));
    await b.library.sync.reconcileNow();
    await a.library.remove('c1');
    await a.fire(); // the debounced push: 409
    expect((await a.library.read('c1'))?.details.contestDate).toBe('2027-03-25');
    expect(server.contests.has('c1')).toBe(true);
    disconnect();
  });
});

describe('durable deletes on the device', () => {
  it('an offline delete survives a reload and is sent when the server is back', async () => {
    const factory = new IDBFactory();
    const first = device(server, factory);
    await first.library.add(sample());
    await first.library.sync.reconcileNow();
    first.setNow(T2);
    first.setOnline(false);
    await first.library.remove('c1');
    await first.library.sync.reconcileNow();
    expect(server.contests.has('c1')).toBe(true);
    await first.library.close();

    const reloaded = device(server, factory, T2);
    await reloaded.library.sync.reconcileNow();
    expect(server.contests.has('c1')).toBe(false);
    expect(server.tombstones.get('c1')).toBe(T2);
    expect(await reloaded.library.read('c1')).toBeUndefined();
  });

  it('a delete is stamped past the deleted copy even when the clock runs behind', async () => {
    const lib = device(server);
    await lib.library.add(sample('c1', T3));
    lib.setNow(T1);
    await lib.library.remove('c1');
    await lib.library.sync.reconcileNow();
    expect(Date.parse(server.tombstones.get('c1')!)).toBeGreaterThan(Date.parse(T3));
  });

  it('re-adding a deleted id outranks its own delete', async () => {
    const lib = device(server);
    await lib.library.add(sample('c1', T0));
    lib.setNow(T2);
    await lib.library.remove('c1');
    await lib.library.add(sample('c1', T0));
    await lib.library.sync.reconcileNow();
    expect(await lib.library.read('c1')).toBeDefined();
    expect(server.contests.has('c1')).toBe(true);
    expect(Date.parse(server.contests.get('c1')!.updatedAt)).toBeGreaterThan(Date.parse(T2));
  });

  it('deleting a contest deletes its checkpoints', async () => {
    const lib = device(server);
    const contest = sample();
    await lib.library.add(contest);
    await lib.library.checkpoints.save(contest, 'snap');
    await lib.library.remove('c1');
    expect(await lib.library.checkpoints.list('c1')).toEqual([]);
  });
});

describe('device-only credentials', () => {
  it('survive a pull and never appear in any call to the server', async () => {
    const a = device(server);
    const withCreds = withSpeechwire(sample(), { username: 'cm@speechwire', password: 's3cret' }, T0);
    await a.library.add(withCreds);
    await a.library.sync.reconcileNow();

    // Another device edits the contest and pushes it.
    const b = device(server);
    await b.library.sync.reconcileNow();
    expect((await b.library.read('c1'))?.speechwire).toEqual({ username: '', password: '' });
    await b.library.save(withDetails((await b.library.read('c1'))!, { contestDate: '2027-03-25' }, T2));
    await b.library.sync.reconcileNow();

    await a.library.sync.reconcileNow();
    const pulled = (await a.library.read('c1'))!;
    expect(pulled.details.contestDate).toBe('2027-03-25');
    expect(pulled.speechwire).toEqual({ username: 'cm@speechwire', password: 's3cret' });
    expect(JSON.stringify(server.calls)).not.toContain('s3cret');
    expect(JSON.stringify([...server.contests.values()])).not.toContain('cm@speechwire');
  });
});

describe('an older client on the same account (no tombstone support)', () => {
  /** The pre-A5 client: lists contests only, PUT-404-POST, deletes without deletedAt, drops a 4xx write. */
  function legacyClient() {
    const local = new Map<string, RemoteContest>();
    return {
      local,
      async reconcile() {
        const { contests } = await server.client.list(); // tombstones ignored
        const remote = new Map(contests.map((c) => [c.id, c.updatedAt]));
        for (const [id, version] of remote) {
          if (!local.has(id) || local.get(id)!.updatedAt < version) local.set(id, await server.client.get(id));
        }
        for (const [id, mine] of local) {
          const theirs = remote.get(id);
          if (theirs === undefined || mine.updatedAt > theirs) await this.push(id);
        }
      },
      async push(id: string) {
        const { name, updatedAt, payload } = local.get(id)!;
        try {
          try {
            await server.client.update(id, { name, updatedAt, payload });
          } catch (err) {
            if (!(err instanceof SyncHttpError && err.status === 404)) throw err;
            await server.client.create({ id, name, updatedAt, payload });
          }
        } catch (err) {
          // The old engine dropped a permanent failure (a 410 is one to it).
          if (!(err instanceof SyncHttpError) || err.status >= 500) throw err;
        }
      },
      edit(id: string, contest: Contest) {
        local.set(id, { id, name: 'N', updatedAt: contest.updatedAt, payload: serializeSyncBundle(contest, []) });
      },
      async remove(id: string) {
        local.delete(id);
        await server.client.remove(id).catch(() => {});
      },
    };
  }

  it("an old client's stale copy cannot bring back a contest the new client deleted", async () => {
    const neu = device(server);
    await neu.library.add(sample());
    await neu.library.sync.reconcileNow();
    const old = legacyClient();
    await old.reconcile();
    neu.setNow(T2);
    await neu.library.remove('c1');
    await neu.library.sync.reconcileNow();

    await old.reconcile(); // pushes its T0 copy: 410, dropped
    await neu.library.sync.reconcileNow();
    expect(await neu.library.read('c1')).toBeUndefined();
    // The old client still has its copy: nothing of its own is lost.
    expect(old.local.has('c1')).toBe(true);
  });

  it("an old client's newer edit after the delete is kept on both", async () => {
    const neu = device(server);
    await neu.library.add(sample());
    await neu.library.sync.reconcileNow();
    const old = legacyClient();
    await old.reconcile();
    neu.setNow(T1);
    await neu.library.remove('c1');
    await neu.library.sync.reconcileNow();

    old.edit('c1', withDetails(sample(), { contestDate: '2027-03-25' }, T3));
    await old.reconcile(); // PUT 404, POST newer: re-created, server tombstone cleared
    await neu.library.sync.reconcileNow();
    expect((await neu.library.read('c1'))?.details.contestDate).toBe('2027-03-25');
  });

  it("an old client's legacy delete leaves the new client's copy (and pushes it back)", async () => {
    const neu = device(server);
    await neu.library.add(sample());
    await neu.library.sync.reconcileNow();
    const old = legacyClient();
    await old.reconcile();
    await old.remove('c1');
    expect(server.tombstones.has('c1')).toBe(false);

    await neu.library.sync.reconcileNow();
    expect(await neu.library.read('c1')).toBeDefined();
    expect(server.contests.has('c1')).toBe(true);
  });
});

describe('the connected loop', () => {
  it('a save marks pending, pushes after the debounce, and reports synced', async () => {
    const d = device(server);
    const disconnect = d.library.sync.connect();
    await d.fire(); // start-up pass
    d.statuses.length = 0;
    await d.library.add(sample());
    expect(d.library.sync.status()).toBe('pending');
    expect(server.contests.has('c1')).toBe(false); // nothing sent before the timer
    expect(d.delays()).toEqual([FLUSH_DELAY_MS]);
    await d.fire();
    expect(server.contests.has('c1')).toBe(true);
    expect(d.statuses).toEqual(['pending', 'syncing', 'synced']);
    disconnect();
  });

  it('retries a transient failure with backoff until it succeeds', async () => {
    const d = device(server);
    const disconnect = d.library.sync.connect();
    await d.fire();
    server.failNext(new SyncHttpError(503), 2, 'update');
    server.failNext(new SyncNetworkError(), 1, 'update');
    await d.library.add(sample());
    await d.fire(); // the debounced flush: 503
    expect(d.delays()).toEqual([backoffDelay(0)]);
    expect(d.library.sync.status()).toBe('pending');
    await d.fire(); // 503
    expect(d.delays()).toEqual([backoffDelay(1)]);
    await d.fire(); // network error
    expect(d.delays()).toEqual([backoffDelay(2)]);
    await d.fire(); // success
    expect(server.contests.has('c1')).toBe(true);
    expect(d.library.sync.status()).toBe('synced');
    expect(d.delays()).toEqual([]);
    disconnect();
  });

  it('a 401 pauses without retrying and keeps the change queued for the next reconnect', async () => {
    const d = device(server);
    const disconnect = d.library.sync.connect();
    await d.fire();
    server.failNext(new SyncHttpError(401), 1, 'update');
    await d.library.add(sample());
    await d.fire();
    expect(d.delays()).toEqual([]);
    expect(d.library.sync.status()).toBe('pending');
    expect(server.contests.has('c1')).toBe(false);

    d.setOnline(false);
    expect(d.library.sync.status()).toBe('offline');
    d.setOnline(true);
    await d.fire(); // reconnect: a pass, which pushes the queued change
    expect(server.contests.has('c1')).toBe(true);
    expect(d.library.sync.status()).toBe('synced');
    disconnect();
  });

  it('drops a poison write rather than wedging the queue; the next pass re-derives it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = device(server);
    const disconnect = d.library.sync.connect();
    await d.fire();
    server.failNext(new SyncHttpError(400), 1, 'update');
    await d.library.add(sample('c1'));
    await d.library.add(sample('c2'));
    await d.fire();
    expect(server.contests.has('c1')).toBe(false);
    expect(server.contests.has('c2')).toBe(true);
    expect(d.library.sync.status()).toBe('synced');
    expect(d.delays()).toEqual([]);
    await d.library.sync.reconcileNow();
    expect(server.contests.has('c1')).toBe(true);
    disconnect();
  });

  it('a failed server list retries the whole pass; followers wait for a completed one', async () => {
    const d = device(server);
    const reconciled: number[] = [];
    d.library.subscribe((e) => e.type === 'reconciled' && reconciled.push(1));
    server.failNext(new SyncHttpError(502), 1, 'list');
    const disconnect = d.library.sync.connect();
    await d.fire(); // start-up pass: list fails
    expect(reconciled).toEqual([]);
    expect(d.delays()).toEqual([backoffDelay(0)]);
    await d.fire(); // the retried pass
    expect(reconciled).toEqual([1]);
    disconnect();
  });

  it('works offline: changes wait, status says offline, and reconnecting sends them', async () => {
    const d = device(server);
    const disconnect = d.library.sync.connect();
    await d.fire();
    d.setOnline(false);
    await d.library.add(sample());
    await d.fire();
    expect(d.library.sync.status()).toBe('offline');
    expect(server.contests.has('c1')).toBe(false);
    d.setOnline(true);
    await d.fire();
    expect(server.contests.has('c1')).toBe(true);
    expect(d.library.sync.status()).toBe('synced');
    disconnect();
  });

  it('a wake runs a pass, throttled; nothing once disconnected', async () => {
    const d = device(server);
    const disconnect = d.library.sync.connect();
    await d.fire();
    const lists = () => server.calls.filter((c) => c.method === 'list').length;
    expect(lists()).toBe(1);
    d.wake();
    await idle();
    expect(lists()).toBe(1); // within the throttle
    d.setNow(new Date(Date.parse(T0) + WAKE_THROTTLE_MS).toISOString());
    d.wake();
    await idle();
    expect(lists()).toBe(2);
    disconnect();
    d.setNow(T4);
    d.wake();
    await idle();
    expect(lists()).toBe(2);
    expect(d.delays()).toEqual([]);
  });
});

describe('planSync (ties go to the delete)', () => {
  const plan = (local: Parameters<typeof planSync>[0], remote: Parameters<typeof planSync>[1]) => planSync(local, remote);

  it('a remote tombstone at the local version removes it; one before pushes', () => {
    expect(plan({ contests: [{ id: 'c', updatedAt: T1 }], tombstones: [] }, { contests: [], tombstones: [{ id: 'c', deletedAt: T1 }] })).toEqual([
      { kind: 'removeLocal', id: 'c', deletedAt: T1 },
    ]);
    expect(plan({ contests: [{ id: 'c', updatedAt: T2 }], tombstones: [] }, { contests: [], tombstones: [{ id: 'c', deletedAt: T1 }] })).toEqual([
      { kind: 'push', id: 'c' },
    ]);
  });

  it('a local tombstone beats a remote contest at the same time, and clears when the server already has it', () => {
    expect(plan({ contests: [], tombstones: [{ id: 'c', deletedAt: T1 }] }, { contests: [{ id: 'c', updatedAt: T1 }], tombstones: [] })).toEqual([
      { kind: 'deleteRemote', id: 'c' },
    ]);
    expect(plan({ contests: [], tombstones: [{ id: 'c', deletedAt: T1 }] }, { contests: [], tombstones: [{ id: 'c', deletedAt: T2 }] })).toEqual([
      { kind: 'clearTombstone', id: 'c', deletedAt: T1 },
    ]);
  });

  it('a remote-only tombstone needs nothing', () => {
    expect(plan({ contests: [], tombstones: [] }, { contests: [], tombstones: [{ id: 'c', deletedAt: T1 }] })).toEqual([]);
  });
});

describe('the in-memory server follows the shared tombstone cases (#280)', () => {
  interface Scenario {
    name: string;
    given: { contest: string | null; tombstone: string | null };
    when: { op: 'delete' | 'deleteLegacy' | 'put' | 'post'; at?: string };
    then: { status: number; body?: Record<string, string>; contest: string | null; tombstone: string | null };
  }
  const file = readFileSync(new URL('../../../server/test/tombstoneScenarios.json', import.meta.url), 'utf8');
  const scenarios = (JSON.parse(file) as { scenarios: Scenario[] }).scenarios;

  it('has the cases', () => {
    expect(scenarios.length).toBeGreaterThan(10);
  });

  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      const fake = createMemoryContestServer();
      const payload = serializeSyncBundle(sample('c1'), []);
      if (scenario.given.contest) fake.contests.set('c1', { id: 'c1', name: 'N', updatedAt: scenario.given.contest, payload });
      if (scenario.given.tombstone) fake.tombstones.set('c1', scenario.given.tombstone);
      const { op, at } = scenario.when;
      const body = { name: 'N', updatedAt: at!, payload };
      const call =
        op === 'delete'
          ? fake.client.remove('c1', at)
          : op === 'deleteLegacy'
            ? fake.client.remove('c1')
            : op === 'put'
              ? fake.client.update('c1', body)
              : fake.client.create({ id: 'c1', ...body });

      if (scenario.then.status < 300) {
        await expect(call).resolves.toBeUndefined();
      } else {
        const err = await call.then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(SyncHttpError);
        expect((err as SyncHttpError).status).toBe(scenario.then.status);
        if (scenario.then.body) expect((err as SyncHttpError).body).toMatchObject(scenario.then.body);
      }
      expect(fake.contests.get('c1')?.updatedAt ?? null).toBe(scenario.then.contest);
      expect(fake.tombstones.get('c1') ?? null).toBe(scenario.then.tombstone);
      if (scenario.then.contest) expect(parseSyncBundle(fake.contests.get('c1')!.payload).contest.id).toBe('c1');
    });
  }
});

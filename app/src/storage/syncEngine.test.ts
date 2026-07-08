import { beforeEach, describe, expect, it } from 'vitest';
import { createSyncEngine, type SyncEngine, type SyncStore } from './syncEngine';
import {
  SyncHttpError,
  SyncNetworkError,
  type RemoteContest,
  type RemoteSummary,
  type SyncClient,
} from './syncClient';
import { serializeSyncBundle } from '../model/syncBundle';
import { createContest, withSpeechwire } from '../model/contest';
import { makeCheckpoint } from '../model/checkpoint';

const T1 = '2026-07-07T12:00:00.000Z';
const T2 = '2026-07-08T12:00:00.000Z';

interface Call {
  method: 'list' | 'get' | 'create' | 'update' | 'remove';
  id?: string;
  body?: { name: string; updatedAt: string; payload: string };
}

/** A programmable in-memory SyncClient that records every call. */
function fakeClient() {
  const calls: Call[] = [];
  let listResult: RemoteSummary[] = [];
  const remote = new Map<string, RemoteContest>();
  /** Per-method throw hooks (return undefined to proceed normally). */
  const hooks: Partial<Record<Call['method'], (call: Call) => void>> = {};

  const client: SyncClient = {
    async list() {
      const call: Call = { method: 'list' };
      calls.push(call);
      hooks.list?.(call);
      return listResult;
    },
    async get(id) {
      const call: Call = { method: 'get', id };
      calls.push(call);
      hooks.get?.(call);
      const record = remote.get(id);
      if (!record) throw new SyncHttpError(404);
      return record;
    },
    async create(body) {
      const call: Call = { method: 'create', id: body.id, body };
      calls.push(call);
      hooks.create?.(call);
    },
    async update(id, body) {
      const call: Call = { method: 'update', id, body };
      calls.push(call);
      hooks.update?.(call);
    },
    async remove(id) {
      const call: Call = { method: 'remove', id };
      calls.push(call);
      hooks.remove?.(call);
    },
  };

  return {
    client,
    calls,
    remote,
    hooks,
    setList: (list: RemoteSummary[]) => {
      listResult = list;
    },
    countOf: (method: Call['method']) => calls.filter((c) => c.method === method).length,
  };
}

/** An in-memory SyncStore. */
function fakeStore() {
  const local = new Map<string, string>(); // id -> updatedAt
  const bundles = new Map<string, { name: string; updatedAt: string; payload: string }>();
  const applied: Array<{ id: string; updatedAt: string }> = [];

  const store: SyncStore = {
    async listLocal() {
      return [...local].map(([id, updatedAt]) => ({ id, updatedAt }));
    },
    async loadBundle(id) {
      return bundles.get(id);
    },
    async applyRemote(id, remote) {
      applied.push({ id, updatedAt: remote.updatedAt });
      local.set(id, remote.updatedAt);
    },
  };

  const put = (id: string, updatedAt: string, payload = `payload-${id}`) => {
    local.set(id, updatedAt);
    bundles.set(id, { name: `Contest ${id}`, updatedAt, payload });
  };

  return { store, local, bundles, applied, put };
}

/** A scheduler that queues work and lets a test drain it, awaiting each task. */
function manualScheduler() {
  const tasks: Array<() => void | Promise<void>> = [];
  const delays: number[] = [];
  return {
    schedule(fn: () => void | Promise<void>, ms: number) {
      delays.push(ms);
      tasks.push(fn);
    },
    delays,
    async drain(max = 200) {
      let n = 0;
      while (tasks.length && n++ < max) {
        await tasks.shift()!();
      }
    },
  };
}

let client: ReturnType<typeof fakeClient>;
let store: ReturnType<typeof fakeStore>;
let scheduler: ReturnType<typeof manualScheduler>;
const online = { value: true };

function buildEngine(): SyncEngine {
  return createSyncEngine({
    client: client.client,
    store: store.store,
    isOnline: () => online.value,
    schedule: scheduler.schedule,
    flushDelayMs: 0,
  });
}

beforeEach(() => {
  client = fakeClient();
  store = fakeStore();
  scheduler = manualScheduler();
  online.value = true;
});

describe('reconcile — last-write-wins per contest', () => {
  it('pushes a contest whose local copy is newer than the server', async () => {
    store.put('a', T2);
    client.setList([{ id: 'a', name: 'Contest a', updatedAt: T1 }]);

    const engine = buildEngine();
    engine.start();
    await scheduler.drain();

    expect(client.countOf('update')).toBe(1);
    expect(client.calls.find((c) => c.method === 'update')?.body?.updatedAt).toBe(T2);
    expect(client.countOf('get')).toBe(0);
  });

  it('pulls a contest whose server copy is newer than the local one', async () => {
    store.put('a', T1);
    client.setList([{ id: 'a', name: 'Contest a', updatedAt: T2 }]);
    client.remote.set('a', { id: 'a', name: 'Contest a', updatedAt: T2, payload: 'remote-bundle' });

    const engine = buildEngine();
    engine.start();
    await scheduler.drain();

    expect(store.applied).toEqual([{ id: 'a', updatedAt: T2 }]);
    expect(client.countOf('update')).toBe(0);
    expect(client.countOf('create')).toBe(0);
  });

  it('does nothing when timestamps agree', async () => {
    store.put('a', T1);
    client.setList([{ id: 'a', name: 'Contest a', updatedAt: T1 }]);

    const engine = buildEngine();
    engine.start();
    await scheduler.drain();

    expect(client.countOf('update')).toBe(0);
    expect(client.countOf('get')).toBe(0);
    expect(store.applied).toEqual([]);
  });

  it('creates a contest the server has never seen (PUT 404 → POST)', async () => {
    store.put('a', T2);
    client.setList([]);
    client.hooks.update = () => {
      throw new SyncHttpError(404);
    };

    const engine = buildEngine();
    engine.start();
    await scheduler.drain();

    expect(client.countOf('update')).toBe(1);
    expect(client.countOf('create')).toBe(1);
  });
});

describe('offline queue', () => {
  it('holds changes made offline and flushes them on reconnect', async () => {
    online.value = false;
    store.put('a', T2);

    const engine = buildEngine();
    engine.start();
    await scheduler.drain();
    engine.markDirty('a', 'save');
    await scheduler.drain();

    // Nothing left this device while offline.
    expect(client.calls).toHaveLength(0);
    expect(engine.getStatus()).toBe('offline');

    // Reconnect: the queued change flushes.
    online.value = true;
    client.setList([{ id: 'a', name: 'Contest a', updatedAt: T2 }]);
    engine.notifyOnline();
    await scheduler.drain();

    expect(client.countOf('update')).toBe(1);
    expect(engine.getStatus()).toBe('synced');
  });
});

describe('retry with backoff', () => {
  it('retries a transient failure until it succeeds, backing off each time', async () => {
    store.put('a', T2);
    client.setList([{ id: 'a', name: 'Contest a', updatedAt: T1 }]); // remote older → push

    let attempts = 0;
    client.hooks.update = () => {
      attempts += 1;
      if (attempts < 3) throw new SyncNetworkError();
    };

    const engine = buildEngine();
    engine.start();
    await scheduler.drain();

    expect(attempts).toBe(3);
    // The two retry delays grow exponentially from the backoff base.
    expect(scheduler.delays).toContain(1000);
    expect(scheduler.delays).toContain(2000);
    expect(engine.getStatus()).toBe('synced');
  });

  it('does not retry a lost session (401) — leaves the change queued', async () => {
    store.put('a', T2);
    client.setList([]);
    client.hooks.update = () => {
      throw new SyncHttpError(401);
    };

    const engine = buildEngine();
    engine.start();
    await scheduler.drain();

    // One attempt, then it stops (no exponential retry storm).
    expect(client.countOf('update')).toBe(1);
  });
});

describe('deletes', () => {
  it('propagates a local delete to the server', async () => {
    const engine = buildEngine();
    engine.start();
    await scheduler.drain();

    engine.markDirty('a', 'delete');
    await scheduler.drain();

    expect(client.countOf('remove')).toBe(1);
  });

  it('treats an already-deleted server contest (404) as success', async () => {
    client.hooks.remove = () => {
      throw new SyncHttpError(404);
    };
    const engine = buildEngine();
    engine.start();
    await scheduler.drain();

    engine.markDirty('a', 'delete');
    await scheduler.drain();

    expect(engine.getStatus()).toBe('synced');
  });
});

describe('device-only credentials never reach the wire', () => {
  it('the outgoing request body carries no Speechwire fields', async () => {
    // Build a real bundle from a contest that HAS credentials on this device.
    const contest = withSpeechwire(
      createContest({ id: 'a', now: T2 }),
      { username: 'sw-user-SECRET', password: 'sw-pass-SECRET' },
      T2,
    );
    const checkpoints = [makeCheckpoint(contest, 'cp', '', T2, 'cp-1')];
    store.local.set('a', T2);
    store.bundles.set('a', {
      name: 'Contest a',
      updatedAt: T2,
      payload: serializeSyncBundle(contest, checkpoints),
    });
    client.setList([{ id: 'a', name: 'Contest a', updatedAt: T1 }]); // force a push

    const engine = buildEngine();
    engine.start();
    await scheduler.drain();

    const sent = client.calls.find((c) => c.method === 'update')?.body?.payload ?? '';
    expect(sent).not.toContain('speechwire');
    expect(sent).not.toContain('sw-user-SECRET');
    expect(sent).not.toContain('sw-pass-SECRET');
  });
});

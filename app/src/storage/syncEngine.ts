/**
 * Background sync engine (PRD module 4, issue #27). Reconciles this device's
 * IndexedDB with the server: pushes local changes up, pulls remote changes
 * down, resolves conflicts last-write-wins per contest, queues work made
 * offline, and retries transient failures with backoff.
 *
 * Design constraints from the issue:
 *  - NEVER a synchronous network call on the edit/typing path. Edits land in
 *    IndexedDB (autosave); the store then notifies this engine, which only marks
 *    an id dirty in memory and schedules an async flush. Typing latency is
 *    independent of network state.
 *  - The durable source of truth is IndexedDB. The in-memory `pending` queue is
 *    just the fast path for immediate pushes; anything it loses is recovered by
 *    reconcile(), which re-derives local-vs-remote differences from the store.
 *
 * Everything the engine touches — the network (SyncClient), local storage
 * (SyncStore), the clock, the online check, and the scheduler — is injected, so
 * the LWW resolution, offline queue, retry/backoff, and device-only-on-the-wire
 * guarantee are all unit-testable with no real network, DB, or timers.
 */
import { backoffDelay } from './syncBackoff';
import { planReconciliation, type SyncSummary } from './syncReconcile';
import {
  isAuthError,
  isTransient,
  SyncHttpError,
  type ContestWrite,
  type SyncClient,
} from './syncClient';

/** What the engine needs from local storage. Implemented over IndexedDB in
 * syncStore.ts; faked in tests. */
export interface SyncStore {
  /** {id, updatedAt} for every stored contest (the LWW clock is updatedAt). */
  listLocal(): Promise<SyncSummary[]>;
  /** The sync bundle + metadata to upload for one contest, or undefined if it
   * is gone (deleted between enqueue and flush). */
  loadBundle(id: string): Promise<{ name: string; updatedAt: string; payload: string } | undefined>;
  /** Writes a pulled contest bundle into local storage WITHOUT re-notifying the
   * engine (a pull must never re-trigger a push). */
  applyRemote(id: string, remote: { name: string; updatedAt: string; payload: string }): Promise<void>;
}

export type ChangeType = 'save' | 'delete';

/** Subtle, non-blocking status for the UI indicator. */
export type SyncStatus = 'synced' | 'syncing' | 'pending' | 'offline';

export interface SyncEngineDeps {
  client: SyncClient;
  store: SyncStore;
  isOnline: () => boolean;
  backoff?: (attempt: number) => number;
  /** Defaults to setTimeout. Tests inject a manual scheduler. May return a
   * promise (the engine's scheduled work is async) so tests can await it. */
  schedule?: (fn: () => void | Promise<void>, ms: number) => void;
  /** Debounce before a dirty mark turns into a push cycle. */
  flushDelayMs?: number;
}

export interface SyncEngine {
  start(): void;
  stop(): void;
  /** Mark a locally-changed contest for push (called by the store's change
   * notifier — off the edit path). */
  markDirty(id: string, type: ChangeType): void;
  /** Full pull+push pass; runs on start, sign-in, and reconnect. */
  reconcile(): Promise<void>;
  notifyOnline(): void;
  notifyOffline(): void;
  getStatus(): SyncStatus;
  subscribe(listener: (status: SyncStatus) => void): () => void;
}

const DEFAULT_FLUSH_DELAY_MS = 600;

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const { client, store, isOnline } = deps;
  const backoff = deps.backoff ?? backoffDelay;
  const schedule = deps.schedule ?? ((fn, ms) => void setTimeout(() => void fn(), ms));
  const flushDelayMs = deps.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;

  /** Latest intent per contest; a later mark supersedes an earlier one. */
  const pending = new Map<string, ChangeType>();
  const listeners = new Set<(status: SyncStatus) => void>();

  let status: SyncStatus = 'synced';
  let stopped = true;
  let flushScheduled = false;
  let cycleRunning = false;
  let failCount = 0;

  function setStatus(next: SyncStatus): void {
    if (next === status) return;
    status = next;
    for (const listener of listeners) listener(status);
  }

  /** Status reflecting queue + connectivity when the engine is at rest. */
  function restingStatus(): SyncStatus {
    if (!isOnline()) return 'offline';
    return pending.size > 0 ? 'pending' : 'synced';
  }

  function scheduleFlush(): void {
    if (flushScheduled || stopped) return;
    flushScheduled = true;
    schedule(() => {
      flushScheduled = false;
      return flush();
    }, flushDelayMs);
  }

  function scheduleRetry(): void {
    if (stopped) return;
    const delay = backoff(failCount);
    failCount += 1;
    setStatus(restingStatus());
    schedule(() => flush(), delay);
  }

  async function pushSave(id: string): Promise<void> {
    const bundle = await store.loadBundle(id);
    if (!bundle) return; // deleted between enqueue and flush — nothing to send
    const write: Omit<ContestWrite, 'id'> = {
      name: bundle.name,
      updatedAt: bundle.updatedAt,
      payload: bundle.payload,
    };
    try {
      await client.update(id, write);
    } catch (err) {
      // First push of a contest the server has never seen: PUT 404 ⇒ create it.
      if (err instanceof SyncHttpError && err.status === 404) {
        await client.create({ id, ...write });
        return;
      }
      throw err;
    }
  }

  async function pushDelete(id: string): Promise<void> {
    try {
      await client.remove(id);
    } catch (err) {
      // Already gone on the server is the outcome we wanted.
      if (err instanceof SyncHttpError && err.status === 404) return;
      throw err;
    }
  }

  /** Drains the pending queue. Successful ops are removed; a transient/auth
   * failure aborts the cycle (leaving its op queued) and schedules a retry;
   * an unexpected permanent failure drops the poison op so it can't wedge the
   * queue. */
  async function flush(): Promise<void> {
    if (stopped || cycleRunning) return;
    if (!isOnline()) {
      setStatus(restingStatus());
      return;
    }
    if (pending.size === 0) {
      setStatus(restingStatus());
      return;
    }

    cycleRunning = true;
    setStatus('syncing');
    try {
      for (const [id, type] of [...pending]) {
        try {
          if (type === 'delete') await pushDelete(id);
          else await pushSave(id);
          pending.delete(id);
        } catch (err) {
          if (isAuthError(err)) {
            // Session lost: stop, keep the change queued, wait for re-auth.
            setStatus(restingStatus());
            return;
          }
          if (isTransient(err)) {
            // Offline/5xx: keep this op queued and retry the cycle with backoff.
            scheduleRetry();
            return;
          }
          // Permanent, unexpected (e.g. 400): drop it rather than loop forever.
          // eslint-disable-next-line no-console
          console.error('sync: dropping unrecoverable op for', id, err);
          pending.delete(id);
        }
      }
      failCount = 0;
      setStatus(restingStatus());
      if (pending.size > 0) scheduleFlush();
    } finally {
      cycleRunning = false;
    }
  }

  async function reconcile(): Promise<void> {
    if (stopped) return;
    if (!isOnline()) {
      setStatus(restingStatus());
      return;
    }
    setStatus('syncing');
    let remote;
    try {
      remote = await client.list();
    } catch (err) {
      if (isAuthError(err)) setStatus(restingStatus());
      else if (isTransient(err)) scheduleRetry();
      return;
    }

    const local = await store.listLocal();
    const plan = planReconciliation(local, remote);

    for (const id of plan.pull) {
      try {
        const record = await client.get(id);
        await store.applyRemote(id, record);
      } catch (err) {
        if (isAuthError(err) || isTransient(err)) {
          scheduleRetry();
          return;
        }
        // Skip a single bad record; the rest of the reconcile continues.
        // eslint-disable-next-line no-console
        console.error('sync: skipping pull for', id, err);
      }
    }

    for (const id of plan.push) pending.set(id, 'save');
    await flush();
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      failCount = 0;
      // Through the scheduler like all other async work, so it is one seam.
      schedule(() => reconcile(), 0);
    },
    stop() {
      stopped = true;
    },
    markDirty(id, type) {
      pending.set(id, type);
      if (stopped) return;
      setStatus(restingStatus());
      scheduleFlush();
    },
    reconcile,
    notifyOnline() {
      if (stopped) return;
      failCount = 0;
      schedule(() => reconcile(), 0);
    },
    notifyOffline() {
      setStatus('offline');
    },
    getStatus() {
      return status;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(status);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * The contest library's convergence with the server (RFC #276, slice A5 #281):
 * the reconcile plan over contests and delete tombstones on both sides, the
 * push queue, retry with backoff, the 401 pause, online/offline, the wake
 * throttle and the status the UI shows. Private to the library: only
 * contestLibrary.ts imports it, and it reaches IndexedDB only through the
 * `LocalSide` callbacks the library hands it, so the library stays the one
 * file that touches storage. Callers see it as `library.sync`.
 *
 * Never on the edit path: a device write only marks an id in memory and arms a
 * debounced flush. The in-memory queue is the fast path; anything it loses (a
 * reload, a dropped op) is re-derived by the next reconcile from the stored
 * contests and tombstones, and the tombstones are what make a delete durable.
 *
 * Tombstone rule (the server implements the same table; ties go to the delete):
 *
 * | Local          | Remote              | Outcome                                       |
 * |----------------|---------------------|-----------------------------------------------|
 * | tombstone at D | contest at R > D    | pull the contest, clear the local tombstone   |
 * | tombstone at D | contest R <= D / -  | delete on the server, then clear the tombstone|
 * | contest at L   | tombstone RD < L    | push the contest; the server clears its own   |
 * | contest at L   | tombstone RD >= L   | remove locally; an open session is `removed`  |
 */
import { backoffDelay } from './syncBackoff';
import { isAuthError, isTransient, type RemoteContest, type Tombstone } from './syncClient';
import type { ContestServer } from './contestServer';
import type { Timers } from './contestLibrary';

/** Subtle, non-blocking status for the UI indicator. */
export type SyncStatus = 'synced' | 'syncing' | 'pending' | 'offline';

/** Connectivity: production is navigator.onLine and the window online/offline events. */
export interface Online {
  isOnline(): boolean;
  onChange(listener: (online: boolean) => void): () => void;
}

export interface Versioned {
  id: string;
  updatedAt: string;
}

/** What the loop needs from the library's storage; every write goes through the library's commit path. */
export interface LocalSide {
  state(): Promise<{ contests: Versioned[]; tombstones: Tombstone[] }>;
  /** The upload for one stored contest, or undefined if it is not stored. */
  bundle(id: string): Promise<RemoteContest | undefined>;
  /** The local tombstone's time, if the contest was deleted on this device. */
  tombstone(id: string): Promise<string | undefined>;
  /** Writes a pulled contest unless the local side is newer (clears an older local tombstone). */
  applyRemote(remote: RemoteContest): Promise<void>;
  /** Removes the local contest for a server delete at `deletedAt`, unless the local copy is newer. */
  applyRemoteDelete(id: string, deletedAt: string): Promise<void>;
  /** Drops the local tombstone once the server holds the delete (only if it is still at `deletedAt`). */
  clearTombstone(id: string, deletedAt: string): Promise<void>;
  /** A full server pass completed (emits the library's `reconciled`). */
  reconciled(): void;
}

export interface SyncLoopDeps {
  server: ContestServer;
  local: LocalSide;
  timers: Timers;
  online: Online;
  wake?: (listener: () => void) => () => void;
  /** Milliseconds clock for the wake throttle. */
  now: () => number;
  backoff?: (attempt: number) => number;
}

export interface SyncLoop {
  /** Starts the loop (a reconcile now, then pushes, retries, wake and connectivity); returns disconnect. */
  connect(): () => void;
  status(): SyncStatus;
  /** Calls `listener` with the current status, then on every change. */
  onStatus(listener: (status: SyncStatus) => void): () => void;
  /** One full server pass now. */
  reconcileNow(): Promise<void>;
  /** A device write to `id` (a save or a delete) needs pushing. */
  markDirty(id: string): void;
}

/** Debounce before a dirty mark turns into a push cycle. */
export const FLUSH_DELAY_MS = 600;
/** A wake within this long of the last reconcile's start is ignored. */
export const WAKE_THROTTLE_MS = 60_000;

const ms = (iso: string) => Date.parse(iso);

export type PlanStep =
  | { kind: 'push'; id: string }
  | { kind: 'pull'; id: string }
  | { kind: 'deleteRemote'; id: string }
  | { kind: 'removeLocal'; id: string; deletedAt: string }
  | { kind: 'clearTombstone'; id: string; deletedAt: string };

/** The reconcile plan over both sides' contests and tombstones (the table above). */
export function planSync(
  local: { contests: Versioned[]; tombstones: Tombstone[] },
  remote: { contests: Versioned[]; tombstones: Tombstone[] },
): PlanStep[] {
  const lc = new Map(local.contests.map((c) => [c.id, c.updatedAt]));
  const lt = new Map(local.tombstones.map((t) => [t.id, t.deletedAt]));
  const rc = new Map(remote.contests.map((c) => [c.id, c.updatedAt]));
  const rt = new Map(remote.tombstones.map((t) => [t.id, t.deletedAt]));
  const ids = new Set([...lc.keys(), ...lt.keys(), ...rc.keys(), ...rt.keys()]);
  const steps: PlanStep[] = [];

  for (const id of ids) {
    const localVersion = lc.get(id);
    const localDelete = lt.get(id);
    let remoteVersion = rc.get(id);
    const remoteDelete = rt.get(id);
    // Should both exist on the server, the later wins (ties to the delete).
    if (remoteVersion !== undefined && remoteDelete !== undefined && ms(remoteDelete) >= ms(remoteVersion)) {
      remoteVersion = undefined;
    }

    if (localVersion !== undefined) {
      if (remoteVersion !== undefined) {
        if (ms(localVersion) > ms(remoteVersion)) steps.push({ kind: 'push', id });
        else if (ms(localVersion) < ms(remoteVersion)) steps.push({ kind: 'pull', id });
      } else if (remoteDelete !== undefined && ms(remoteDelete) >= ms(localVersion)) {
        steps.push({ kind: 'removeLocal', id, deletedAt: remoteDelete });
      } else {
        steps.push({ kind: 'push', id });
      }
    } else if (localDelete !== undefined) {
      if (remoteVersion !== undefined && ms(remoteVersion) > ms(localDelete)) {
        steps.push({ kind: 'pull', id });
      } else if (remoteVersion === undefined && remoteDelete !== undefined && ms(remoteDelete) >= ms(localDelete)) {
        // The server already holds this delete (or a later one).
        steps.push({ kind: 'clearTombstone', id, deletedAt: localDelete });
      } else {
        steps.push({ kind: 'deleteRemote', id });
      }
    } else if (remoteVersion !== undefined) {
      steps.push({ kind: 'pull', id });
    }
  }
  return steps;
}

export function createSyncLoop(deps: SyncLoopDeps): SyncLoop {
  const { server, local, timers, online } = deps;
  const backoff = deps.backoff ?? backoffDelay;

  /** Ids with a device write to push (a save or a delete; storage says which). */
  const pending = new Set<string>();
  const listeners = new Set<(status: SyncStatus) => void>();

  let status: SyncStatus = 'synced';
  let connected = false;
  let flushTimer: unknown;
  let retryTimer: unknown;
  let cycleRunning = false;
  let failCount = 0;
  let pass: Promise<void> | undefined;
  let lastReconcileAt: number | undefined;
  let detach: (() => void) | undefined;

  function setStatus(next: SyncStatus): void {
    if (next === status) return;
    status = next;
    for (const listener of [...listeners]) listener(status);
  }

  /** Status reflecting queue and connectivity when the loop is at rest. */
  function restingStatus(): SyncStatus {
    if (!online.isOnline()) return 'offline';
    return pending.size > 0 ? 'pending' : 'synced';
  }

  function scheduleFlush(): void {
    if (!connected || flushTimer !== undefined) return;
    flushTimer = timers.set(() => {
      flushTimer = undefined;
      if (connected) void flush();
    }, FLUSH_DELAY_MS);
  }

  /** A transient failure: back off, then retry the flush or the whole pass. */
  function scheduleRetry(what: 'flush' | 'reconcile'): void {
    setStatus(restingStatus());
    if (!connected) return;
    const delay = backoff(failCount);
    failCount += 1;
    if (retryTimer !== undefined) timers.clear(retryTimer);
    retryTimer = timers.set(() => {
      retryTimer = undefined;
      if (!connected) return;
      void (what === 'flush' ? flush() : reconcileNow());
    }, delay);
  }

  /** Pushes one id's device write: the stored contest, or its tombstone. */
  async function pushOne(id: string): Promise<void> {
    const bundle = await local.bundle(id);
    if (bundle) {
      const result = await server.put(bundle);
      // The server holds a delete at or after this version: it wins here too.
      if ('gone' in result) await local.applyRemoteDelete(id, result.gone);
      return;
    }
    const deletedAt = await local.tombstone(id);
    if (deletedAt === undefined) return; // nothing left to send
    const result = await server.remove(id, deletedAt);
    if ('newer' in result) {
      // Edited elsewhere after this delete: the edit wins and comes back.
      await local.applyRemote(await server.get(id));
    } else {
      await local.clearTombstone(id, deletedAt);
    }
  }

  /**
   * Drains the queue. A transient failure keeps the op and retries with
   * backoff; a 401 keeps it and pauses until the next reconnect or sign-in; any
   * other failure drops the op (a poison write must not wedge the queue; the
   * next reconcile re-derives what is still different).
   */
  async function flush(): Promise<void> {
    if (cycleRunning) return;
    if (!online.isOnline() || pending.size === 0) {
      setStatus(restingStatus());
      return;
    }
    cycleRunning = true;
    setStatus('syncing');
    try {
      for (const id of [...pending]) {
        // Taken off first, so a write that lands mid-push marks it again.
        pending.delete(id);
        try {
          await pushOne(id);
        } catch (err) {
          if (isAuthError(err)) {
            pending.add(id);
            setStatus(restingStatus());
            return;
          }
          if (isTransient(err)) {
            pending.add(id);
            scheduleRetry('flush');
            return;
          }
          // eslint-disable-next-line no-console
          console.error('sync: dropping unrecoverable op for', id, err);
        }
      }
      failCount = 0;
      setStatus(restingStatus());
      if (pending.size > 0) scheduleFlush();
    } finally {
      cycleRunning = false;
    }
  }

  async function runPass(): Promise<void> {
    if (!online.isOnline()) {
      setStatus(restingStatus());
      return;
    }
    lastReconcileAt = deps.now();
    setStatus('syncing');
    let remote;
    try {
      remote = await server.list();
    } catch (err) {
      if (isTransient(err)) scheduleRetry('reconcile');
      else setStatus(restingStatus());
      return;
    }

    const plan = planSync(await local.state(), remote);
    for (const step of plan) {
      try {
        if (step.kind === 'pull') await local.applyRemote(await server.get(step.id));
        else if (step.kind === 'removeLocal') await local.applyRemoteDelete(step.id, step.deletedAt);
        else if (step.kind === 'clearTombstone') await local.clearTombstone(step.id, step.deletedAt);
        else pending.add(step.id);
      } catch (err) {
        if (isAuthError(err)) {
          setStatus(restingStatus());
          return;
        }
        if (isTransient(err)) {
          scheduleRetry('reconcile');
          return;
        }
        // Skip a single bad record; the rest of the pass continues.
        // eslint-disable-next-line no-console
        console.error('sync: skipping', step.kind, 'for', step.id, err);
      }
    }

    await flush();
    // Every pull landed (or was skipped as unreadable): this device reflects the server.
    local.reconciled();
  }

  function reconcileNow(): Promise<void> {
    pass ??= runPass().finally(() => {
      pass = undefined;
    });
    return pass;
  }

  /** A wake (focus, visibility, periodic tick) asks for a reconcile; throttled. */
  function onWake(): void {
    if (!connected || pass || !online.isOnline()) return;
    if (lastReconcileAt !== undefined && deps.now() - lastReconcileAt < WAKE_THROTTLE_MS) return;
    void reconcileNow();
  }

  function soon(fn: () => void): void {
    timers.set(() => {
      if (connected) fn();
    }, 0);
  }

  return {
    connect() {
      if (connected) return () => {};
      connected = true;
      failCount = 0;
      const offWake = deps.wake?.(onWake);
      const offOnline = online.onChange((isOnline) => {
        if (!connected) return;
        if (isOnline) {
          failCount = 0;
          soon(() => void reconcileNow());
        } else {
          setStatus('offline');
        }
      });
      detach = () => {
        offWake?.();
        offOnline();
      };
      soon(() => void reconcileNow());
      let done = false;
      return () => {
        if (done) return;
        done = true;
        connected = false;
        detach?.();
        detach = undefined;
        if (flushTimer !== undefined) timers.clear(flushTimer);
        if (retryTimer !== undefined) timers.clear(retryTimer);
        flushTimer = retryTimer = undefined;
      };
    },
    status: () => status,
    onStatus(listener) {
      listeners.add(listener);
      listener(status);
      return () => listeners.delete(listener);
    },
    reconcileNow,
    markDirty(id) {
      pending.add(id);
      if (!connected) return;
      setStatus(restingStatus());
      scheduleFlush();
    },
  };
}

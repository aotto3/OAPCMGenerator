/**
 * Wires the sync engine to the browser: the real network client, the IndexedDB
 * store, navigator.onLine, the window online/offline events, and the store's
 * change notifier. This is the impure seam the app calls; the engine itself
 * stays environment-free and unit-tested.
 *
 * The engine is a module singleton so its status survives re-renders and there
 * is only ever one sync loop. startBrowserSync() connects the live inputs and
 * starts a reconcile; its returned disposer detaches everything (on sign-out).
 */
import { onContestChanged } from './contestStore';
import { createBrowserSyncClient } from './syncClient';
import { createSyncEngine, type SyncEngine } from './syncEngine';
import { browserSyncStore } from './syncStore';

let engine: SyncEngine | undefined;

/** The shared engine instance (created on first use). */
export function getSyncEngine(): SyncEngine {
  engine ??= createSyncEngine({
    client: createBrowserSyncClient(),
    store: browserSyncStore,
    isOnline: () => navigator.onLine,
  });
  return engine;
}

/**
 * Starts background sync and connects live inputs. Call once the user is signed
 * in. Returns a disposer that stops the engine and detaches all listeners.
 */
export function startBrowserSync(): () => void {
  const active = getSyncEngine();

  const offChange = onContestChanged((id, type) => active.markDirty(id, type));
  const handleOnline = () => active.notifyOnline();
  const handleOffline = () => active.notifyOffline();
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  active.start();

  return () => {
    offChange();
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    active.stop();
  };
}

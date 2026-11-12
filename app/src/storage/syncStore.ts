/**
 * The sync engine's SyncStore, implemented over the contest library. It does
 * exactly three things: list what we have, build an upload bundle for one
 * contest, and apply a pulled bundle. No network and no reconciliation logic
 * (that lives in syncEngine.ts / syncReconcile.ts), and no IndexedDB: the
 * library owns the record shape and writes the pull through its commit path,
 * emitting a `remote` event the engine ignores (a pull never re-triggers a push).
 */
import type { ContestLibrary } from './contestLibrary';
import type { SyncStore } from './syncEngine';

export function createLibrarySyncStore(library: ContestLibrary): SyncStore {
  return {
    async listLocal() {
      return (await library.list()).map(({ id, updatedAt }) => ({ id, updatedAt }));
    },
    loadBundle: (id) => library.bundleFor(id),
    // The contest id travels inside the bundle.
    applyRemote: (_id, remote) => library.applyRemote(remote),
  };
}

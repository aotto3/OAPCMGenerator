/**
 * Persistent storage request (PRD module 4; Slice 15, issue #28).
 *
 * Contests live in IndexedDB and are the device's source of truth. Under storage
 * pressure a browser may EVICT a non-persistent origin's IndexedDB — which on
 * contest day would mean lost work. navigator.storage.persist() asks the browser
 * to exempt this origin from that eviction. It is best-effort: some browsers
 * grant it silently, some tie it to the PWA being installed / the site being
 * bookmarked, and some don't support it at all. We request once and never block
 * on the outcome — the app is fully functional whether or not it's granted.
 *
 * Pure of React/DOM specifics beyond the Storage API, so it is unit-testable by
 * injecting a fake `navigator.storage`.
 */

export type PersistResult =
  | 'persisted' // already persisted, or just granted
  | 'denied' // supported but the browser declined
  | 'unsupported'; // no StorageManager.persist on this platform

/** The slice of navigator.storage we use; narrows the real StorageManager. */
interface StorageManagerLike {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
}

/**
 * Requests persistent storage if the platform supports it and it isn't already
 * granted. Never throws — a rejected/oddly-behaving API resolves to 'denied' so
 * callers can fire-and-forget. Returns the resulting state for logging/UI.
 */
export async function requestPersistentStorage(
  storage: StorageManagerLike | undefined = globalThis.navigator?.storage,
): Promise<PersistResult> {
  if (!storage || typeof storage.persist !== 'function') return 'unsupported';
  try {
    // Skip the prompt if we already have it (idempotent across sessions).
    if (typeof storage.persisted === 'function' && (await storage.persisted())) {
      return 'persisted';
    }
    return (await storage.persist()) ? 'persisted' : 'denied';
  } catch {
    return 'denied';
  }
}

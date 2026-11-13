/**
 * The app's one contest library (storage/contestLibrary.ts), bound to the
 * browser's IndexedDB and wall clock. Created on first use so importing this
 * module never touches `indexedDB`. Components reach it through the hooks in
 * ui/contestHooks.ts or this accessor; they never open the database themselves.
 *
 * Leaving the page (pagehide) writes every open contest's pending edit, so
 * closing the tab mid-burst loses nothing.
 */
import { browserWake } from './browserWake';
import { createContestLibrary, type ContestLibrary } from './contestLibrary';

let library: ContestLibrary | undefined;

export function contestLibrary(): ContestLibrary {
  if (!library) {
    const created = createContestLibrary({
      idb: indexedDB,
      clock: () => new Date().toISOString(),
      wake: browserWake,
    });
    window.addEventListener('pagehide', () => void created.flush());
    library = created;
  }
  return library;
}

/**
 * The app's one contest library (storage/contestLibrary.ts), bound to the
 * browser's IndexedDB and wall clock. Created on first use so importing this
 * module never touches `indexedDB`. Components reach it through the hooks in
 * ui/contestHooks.ts or this accessor; they never open the database themselves.
 */
import { createContestLibrary, type ContestLibrary } from './contestLibrary';

let library: ContestLibrary | undefined;

export function contestLibrary(): ContestLibrary {
  library ??= createContestLibrary({ idb: indexedDB, clock: () => new Date().toISOString() });
  return library;
}

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
import { createQuestionnaireClient } from '../questionnaire/questionnaireClient';
import { localToday, startRosterPublisher } from '../questionnaire/rosterPublisher';
import { startSubmissionSync } from '../questionnaire/submissionSync';
import { contestLibrary } from './browserLibrary';
import { createBrowserSyncClient } from './syncClient';
import { createSyncEngine, type SyncEngine } from './syncEngine';
import { createLibrarySyncStore } from './syncStore';

let engine: SyncEngine | undefined;

/** The shared engine instance (created on first use). */
export function getSyncEngine(): SyncEngine {
  engine ??= createSyncEngine({
    client: createBrowserSyncClient(),
    store: createLibrarySyncStore(contestLibrary()),
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

  const library = contestLibrary();
  // Push this device's writes; pulls (origin 'remote') came from the server.
  const offChange = library.subscribe((event) => {
    if (event.origin !== 'device') return;
    active.markDirty(event.id, event.type === 'removed' ? 'delete' : 'save');
  });
  const handleOnline = () => active.notifyOnline();
  const handleOffline = () => active.notifyOffline();
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // Keep the judge questionnaire's roster current (PRD #252): republished when
  // sync settles and the roster changed. Off the edit path, best-effort.
  const questionnaire = createQuestionnaireClient();
  const loadContests = () => library.readAll();
  const stopRoster = startRosterPublisher({
    subscribe: (listener) => active.subscribe(listener),
    loadContests,
    publish: (roster) => questionnaire.publishRoster(roster),
    today: () => localToday(),
  });
  // And bring judges' questionnaire answers into the contests. A changed contest
  // is saved like an edit, so it syncs to the account's other devices.
  const stopSubmissions = startSubmissionSync({
    subscribe: (listener) => active.subscribe(listener),
    fetchSubmissions: () => questionnaire.listSubmissions(),
    loadContests,
    saveContest: (contest) => library.save(contest),
    now: () => new Date().toISOString(),
  });

  active.start();

  return () => {
    stopRoster();
    stopSubmissions();
    offChange();
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    active.stop();
  };
}

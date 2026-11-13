/**
 * The app's one contest library (storage/contestLibrary.ts), bound to the
 * browser: IndexedDB, the wall clock, the deployed API (contestServer.ts),
 * navigator.onLine and the window online/offline events, and the wake port
 * (tab focus/visibility and a periodic tick). Created on first use so
 * importing this module never touches `indexedDB`. Components reach it
 * through the hooks in ui/contestHooks.ts or this accessor; they never open
 * the database themselves.
 *
 * Leaving the page (pagehide) writes every open contest's pending edit, so
 * closing the tab mid-burst loses nothing.
 *
 * This is also the composition root for sync (RFC #276): `connectBrowserSync()`
 * starts the library's server loop while the user is signed in and attaches the
 * library's two followers, the judge roster publisher and the questionnaire
 * answer follower. The library decides when they run (data events and
 * completed server passes).
 */
import { createQuestionnaireClient } from '../questionnaire/questionnaireClient';
import { localToday, startRosterPublisher, type RosterPublishStatus } from '../questionnaire/rosterPublisher';
import { startSubmissionSync } from '../questionnaire/submissionSync';
import { browserWake } from './browserWake';
import { createContestLibrary, type ContestLibrary, type Online } from './contestLibrary';
import { createHttpContestServer } from './contestServer';

let library: ContestLibrary | undefined;

const browserOnline: Online = {
  isOnline: () => navigator.onLine,
  onChange(listener) {
    const up = () => listener(true);
    const down = () => listener(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  },
};

export function contestLibrary(): ContestLibrary {
  if (!library) {
    const created = createContestLibrary({
      idb: indexedDB,
      clock: () => new Date().toISOString(),
      wake: browserWake,
      server: createHttpContestServer(),
      online: browserOnline,
    });
    window.addEventListener('pagehide', () => void created.flush());
    library = created;
  }
  return library;
}

/* The roster publisher's last outcome (#275), kept here so the questionnaire
 * link control can read it whether or not a publisher is running right now. */
let rosterStatus: RosterPublishStatus = { kind: 'idle' };
const rosterStatusListeners = new Set<() => void>();

function setRosterStatus(next: RosterPublishStatus): void {
  rosterStatus = next;
  for (const listener of rosterStatusListeners) listener();
}

/** The judge roster's last publish outcome; 'idle' until one has run this session. */
export function getRosterPublishStatus(): RosterPublishStatus {
  return rosterStatus;
}

/** Notifies on every roster publish outcome; returns an unsubscribe. */
export function subscribeRosterPublishStatus(listener: () => void): () => void {
  rosterStatusListeners.add(listener);
  return () => {
    rosterStatusListeners.delete(listener);
  };
}

/**
 * Starts background sync and the followers. Call once the user is signed in.
 * Returns a disposer that disconnects sync and stops the followers (sign-out).
 */
export function connectBrowserSync(): () => void {
  const lib = contestLibrary();

  // Keep the judge questionnaire's roster current (PRD #252): republished when
  // the roster changed, never before the first server pass. Off the edit path;
  // its outcome is shown by the questionnaire link control.
  const questionnaire = createQuestionnaireClient();
  const rosterPublisher = startRosterPublisher({
    follow: (name, handler) => lib.follow(name, handler),
    publish: (roster) => questionnaire.publishRoster(roster),
    today: () => localToday(),
    now: () => new Date(),
  });
  const offRosterStatus = rosterPublisher.onStatus(setRosterStatus);
  // And bring judges' questionnaire answers into the contests, fetched once per
  // server pass, through the library's transform, so an open workspace gets
  // them via its session. A changed contest is saved like an edit, so it syncs
  // to the other devices.
  const stopSubmissions = startSubmissionSync({
    follow: (name, handler) => lib.follow(name, handler),
    fetchSubmissions: () => questionnaire.listSubmissions(),
    contestIds: async () => (await lib.list()).map((summary) => summary.id),
    now: () => new Date().toISOString(),
  });

  const disconnect = lib.sync.connect();

  return () => {
    offRosterStatus();
    rosterPublisher.stop();
    setRosterStatus({ kind: 'idle' });
    stopSubmissions();
    disconnect();
  };
}

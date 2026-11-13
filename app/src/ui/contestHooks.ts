/**
 * Thin React adapters over the contest library singleton (RFC #276). No logic
 * of their own: the library decides what changed, these only re-render.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Contest } from '../model/contest';
import { connectBrowserSync, contestLibrary } from '../storage/browserLibrary';
import type { ContestSummary, OpenContest, OpenState, SyncStatus } from '../storage/contestLibrary';

const LOADING: OpenState = { status: 'loading' };
const noSubscribe = () => () => {};
const loadingSnapshot = () => LOADING;

export type UseOpenContest = OpenState & {
  set(next: Contest): void;
  update(fn: (contest: Contest) => Contest): void;
  dismissNotice(): void;
  checkpoints: OpenContest['checkpoints'] | null;
};

/**
 * Opens a session on one contest for as long as the component is mounted. The
 * session owns the debounced save, the draft rule and the flush on unmount;
 * outside writes (a pull, applied questionnaire answers) arrive through it.
 */
export function useOpenContest(id: string, draft?: Contest, attempt = 0): UseOpenContest {
  const [session, setSession] = useState<OpenContest | null>(null);

  // `attempt` reopens the session (e.g. after a sync pass may have pulled a
  // contest that was missing on this device).
  useEffect(() => {
    const opened = contestLibrary().open(id, { draft });
    setSession(opened);
    return () => {
      setSession(null);
      void opened.close();
    };
  }, [id, draft, attempt]);

  const state = useSyncExternalStore(
    session ? session.subscribe : noSubscribe,
    session ? session.getState : loadingSnapshot,
  );

  return useMemo(
    () => ({
      ...state,
      set: (next: Contest) => session?.set(next),
      update: (fn: (contest: Contest) => Contest) => session?.update(fn),
      dismissNotice: () => session?.dismissNotice(),
      checkpoints: session?.checkpoints ?? null,
    }),
    [state, session],
  );
}

/**
 * The live contest list: refreshed on every library event, so local writes,
 * pulls and deletes all show up without a listener of the caller's own.
 * Null until the first read completes.
 */
export function useContestList(): ContestSummary[] | null {
  const [contests, setContests] = useState<ContestSummary[] | null>(null);

  useEffect(() => {
    const library = contestLibrary();
    let active = true;
    // Only the latest read may land, so a slow early read never overwrites a newer one.
    let latest = 0;
    const refresh = () => {
      const ticket = ++latest;
      void library.list().then((list) => {
        if (active && ticket === latest) setContests(list);
      });
    };
    refresh();
    const off = library.subscribe((event) => {
      if (event.type !== 'reconciled') refresh();
    });
    return () => {
      active = false;
      off();
    };
  }, []);

  return contests;
}

/**
 * Runs one library operation at a time and reports a failure as
 * `${failure}: ${message}` instead of leaving the CM unsure whether it happened.
 */
export function useContestAction(): {
  run(failure: string, work: () => Promise<void>): void;
  busy: boolean;
  error: string | null;
  clearError(): void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback((failure: string, work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    void work()
      .catch((err: unknown) => {
        if (mounted.current) setError(`${failure}: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { run, busy, error, clearError };
}

/**
 * Runs the library's sync (and its followers) while `enabled` (signed in) and
 * returns its status for the indicator. The UI never drives reconciliation; it
 * only reflects it.
 */
export function useContestSync(enabled: boolean): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(() => contestLibrary().sync.status());

  useEffect(() => {
    if (!enabled) return;
    trackFirstPass();
    const off = contestLibrary().sync.onStatus(setStatus);
    const disconnect = connectBrowserSync();
    return () => {
      off();
      disconnect();
    };
  }, [enabled]);

  return status;
}

/* ── first completed sync pass (#310) ──
 * A contest linked by URL may not be on this device yet (a new device, cleared
 * storage). The workspace waits for the first completed server pass before
 * calling it missing. Tracked once per page load, from the moment sync starts.
 */
let firstPassDone = false;
let tracking = false;
const firstPassListeners = new Set<() => void>();

function trackFirstPass(): void {
  if (tracking) return;
  tracking = true;
  contestLibrary().subscribe((event) => {
    if (event.type !== 'reconciled' || firstPassDone) return;
    firstPassDone = true;
    for (const listener of firstPassListeners) listener();
  });
}

/** How long to wait for that first pass (offline, a slow server) before giving up. */
const FIRST_PASS_TIMEOUT_MS = 15_000;

/**
 * While `missing` is true: 'waiting' until the first sync pass completes (or
 * the timeout passes), then 'missing'. `onPassed` fires once when the pass
 * completes so the caller can reopen the contest. 'found' when not missing.
 */
export function useAwaitFirstPass(missing: boolean, onPassed: () => void): 'found' | 'waiting' | 'missing' {
  const [gaveUp, setGaveUp] = useState(false);
  const [passed, setPassed] = useState(firstPassDone);

  useEffect(() => {
    if (!missing || passed) return;
    const listener = () => {
      setPassed(true);
      onPassed();
    };
    firstPassListeners.add(listener);
    const timer = setTimeout(() => setGaveUp(true), FIRST_PASS_TIMEOUT_MS);
    return () => {
      firstPassListeners.delete(listener);
      clearTimeout(timer);
    };
    // onPassed is a fresh closure each render; the subscription keys on state only.
  }, [missing, passed]);

  if (!missing) return 'found';
  return passed || gaveUp ? 'missing' : 'waiting';
}

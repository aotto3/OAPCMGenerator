/**
 * Thin React adapters over the contest library singleton (RFC #276). No logic
 * of their own: the library decides what changed, these only re-render.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Contest } from '../model/contest';
import { contestLibrary } from '../storage/browserLibrary';
import type { ContestSummary, OpenContest, OpenState } from '../storage/contestLibrary';

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
export function useOpenContest(id: string, draft?: Contest): UseOpenContest {
  const [session, setSession] = useState<OpenContest | null>(null);

  useEffect(() => {
    const opened = contestLibrary().open(id, { draft });
    setSession(opened);
    return () => {
      setSession(null);
      void opened.close();
    };
  }, [id, draft]);

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

/**
 * The autosave pattern for this app — copy this, don't invent new ones.
 *
 * Every edit updates React state immediately; this hook then writes the
 * contest to IndexedDB after a short debounce (so a burst of keystrokes is
 * one write, but nothing is ever more than DEBOUNCE_MS from disk). There is
 * no Save button anywhere, by design (PRD issue #13). The pending write is
 * flushed on unmount and on pagehide so closing the tab mid-burst loses
 * nothing.
 */
import { useEffect, useRef } from 'react';
import type { Contest } from '../model/contest';
import { saveContest } from './contestStore';

const DEBOUNCE_MS = 300;

export function useAutosave(contest: Contest | undefined): void {
  const pending = useRef<Contest>();

  useEffect(() => {
    if (!contest) return;
    pending.current = contest;
    const timer = setTimeout(() => {
      pending.current = undefined;
      void saveContest(contest);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [contest]);

  // Flush the debounced write if the user leaves before it fires.
  useEffect(() => {
    const flush = () => {
      if (pending.current) {
        void saveContest(pending.current);
        pending.current = undefined;
      }
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush(); // unmount (e.g. navigating back to the dashboard)
    };
  }, []);
}

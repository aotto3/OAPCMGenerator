/**
 * Keeps the server's judge roster in step with this device (PRD #252). It rides
 * the sync engine's status instead of adding work to the edit path: whenever sync
 * settles ('synced') after a pass has actually run, it rebuilds the roster from the
 * local contests and publishes it if it changed since the last successful publish.
 *
 * Waiting for a real sync pass matters: the engine reports 'synced' before its
 * first reconcile, and a fresh device's empty store would otherwise wipe the
 * account's roster until the pull finished. A failed publish is simply retried at
 * the next settle. All inputs are injected so this is unit-testable.
 */
import type { Contest } from '../model/contest';
import type { SyncStatus } from '../storage/syncEngine';
import { buildJudgeRoster, type JudgeRoster } from './roster';

export interface RosterPublisherDeps {
  subscribe(listener: (status: SyncStatus) => void): () => void;
  loadContests(): Promise<Contest[]>;
  publish(roster: JudgeRoster): Promise<void>;
  /** Local date, YYYY-MM-DD. */
  today(): string;
}

export function startRosterPublisher(deps: RosterPublisherDeps): () => void {
  let sawSyncPass = false;
  let running = false;
  let rerun = false;
  let lastPublished: string | null = null;

  async function publishIfChanged(): Promise<void> {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      do {
        rerun = false;
        const roster = buildJudgeRoster(await deps.loadContests(), deps.today());
        const text = JSON.stringify(roster);
        if (text === lastPublished) continue;
        try {
          await deps.publish(roster);
          lastPublished = text;
        } catch {
          // Offline, signed out, or a server hiccup: the next settle retries.
        }
      } while (rerun);
    } finally {
      running = false;
    }
  }

  return deps.subscribe((status) => {
    if (status === 'syncing') sawSyncPass = true;
    else if (status === 'synced' && sawSyncPass) void publishIfChanged();
  });
}

/** Today's local calendar date as YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

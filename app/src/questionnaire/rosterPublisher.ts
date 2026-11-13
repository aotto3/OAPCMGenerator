/**
 * Keeps the server's judge roster in step with this device (PRD #252). It rides
 * the sync engine's status instead of adding work to the edit path: whenever sync
 * settles ('synced') after a pass has actually run, it rebuilds the roster from the
 * local contests and publishes it if it changed since the last successful publish.
 *
 * Waiting for a real sync pass matters: the engine reports 'synced' before its
 * first reconcile, and a fresh device's empty store would otherwise wipe the
 * account's roster until the pull finished. A failed publish is retried at the
 * next settle.
 *
 * It records its last outcome (#275): published at a time, or failed with a
 * plain reason, so the questionnaire link control can show it instead of a
 * failure passing silently. Package A's rewrite of this as a sync follower must
 * keep that status. All inputs, the clock included, are injected.
 */
import { ApiHttpError, ApiNetworkError } from '../api/http';
import type { Contest } from '../model/contest';
import type { SyncStatus } from '../storage/syncEngine';
import { buildJudgeRoster, type JudgeRoster } from './roster';

export interface RosterPublisherDeps {
  subscribe(listener: (status: SyncStatus) => void): () => void;
  loadContests(): Promise<Contest[]>;
  publish(roster: JudgeRoster): Promise<void>;
  /** Local date, YYYY-MM-DD. */
  today(): string;
  /** The clock for publish-status timestamps. */
  now(): Date;
}

/** The last publish outcome. `at` is an ISO timestamp from the injected clock. */
export type RosterPublishStatus =
  | { kind: 'idle' }
  | { kind: 'published'; at: string }
  | { kind: 'failed'; at: string; reason: string };

export interface RosterPublisher {
  status(): RosterPublishStatus;
  /** Called on every status change; returns an unsubscribe. */
  onStatus(listener: (status: RosterPublishStatus) => void): () => void;
  stop(): void;
}

/** A short, plain reason for a failed publish. */
export function publishFailureReason(error: unknown): string {
  if (error instanceof ApiNetworkError) return 'no connection';
  if (error instanceof ApiHttpError) {
    if (error.status === 401) return 'signed out';
    const body = error.body as { error?: unknown } | undefined;
    if (body?.error === 'Roster too large') return 'the roster is too large';
    if (body?.error === 'Invalid roster') return 'the server refused the roster';
    return `server error ${error.status}`;
  }
  return error instanceof Error && error.message ? error.message : 'unknown error';
}

export function startRosterPublisher(deps: RosterPublisherDeps): RosterPublisher {
  let sawSyncPass = false;
  let running = false;
  let rerun = false;
  let lastPublished: string | null = null;
  let lastPublishedAt = '';
  let status: RosterPublishStatus = { kind: 'idle' };
  const listeners = new Set<(status: RosterPublishStatus) => void>();

  function report(next: RosterPublishStatus): void {
    status = next;
    for (const listener of listeners) listener(next);
  }

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
        if (text === lastPublished) {
          // The server already holds this roster, even if a newer one failed since.
          if (status.kind === 'failed') report({ kind: 'published', at: lastPublishedAt });
          continue;
        }
        try {
          await deps.publish(roster);
          lastPublished = text;
          lastPublishedAt = deps.now().toISOString();
          report({ kind: 'published', at: lastPublishedAt });
        } catch (error) {
          // Offline, signed out, or a server hiccup: shown, and the next settle retries.
          report({ kind: 'failed', at: deps.now().toISOString(), reason: publishFailureReason(error) });
        }
      } while (rerun);
    } finally {
      running = false;
    }
  }

  const unsubscribe = deps.subscribe((syncStatus) => {
    if (syncStatus === 'syncing') sawSyncPass = true;
    else if (syncStatus === 'synced' && sawSyncPass) void publishIfChanged();
  });

  return {
    status: () => status,
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      unsubscribe();
      listeners.clear();
    },
  };
}

/** Today's local calendar date as YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

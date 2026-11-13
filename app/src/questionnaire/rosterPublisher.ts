/**
 * Keeps the server's judge roster in step with this device (PRD #252), as a
 * contest-library follower (RFC #276, slice A3 #279). It keeps a per-id cache of
 * the contests (filled from the whole store on its first batch, then updated
 * from each batch's changed and removed contests), rebuilds the roster, and
 * publishes it only when the roster text changed since the last successful
 * publish.
 *
 * The library never runs a follower before a completed server pass, so a fresh
 * device's empty store cannot wipe the account's roster before its first pull
 * lands. A burst of edits is one coalesced batch. A failed publish throws after
 * recording its outcome, so the library retries it at the next event or wake.
 *
 * It records its last outcome (#275): published at a time, or failed with a
 * plain reason, so the questionnaire link control can show it instead of a
 * failure passing silently. All inputs, the clock included, are injected.
 */
import { ApiHttpError, ApiNetworkError } from '../api/http';
import type { Contest } from '../model/contest';
import type { FollowBatch } from '../storage/contestLibrary';
import { buildJudgeRoster, type JudgeRoster } from './roster';

export interface RosterPublisherDeps {
  /** The library's `follow`. */
  follow(name: string, handler: (batch: FollowBatch) => Promise<void>): () => void;
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
  const cache = new Map<string, Contest>();
  let lastPublished: string | null = null;
  let lastPublishedAt = '';
  let status: RosterPublishStatus = { kind: 'idle' };
  let stopped = false;
  const listeners = new Set<(status: RosterPublishStatus) => void>();

  function report(next: RosterPublishStatus): void {
    if (stopped) return;
    status = next;
    for (const listener of listeners) listener(next);
  }

  const unfollow = deps.follow('roster', async (batch) => {
    if (batch.first) {
      cache.clear();
      for (const contest of await batch.all()) cache.set(contest.id, contest);
    } else {
      for (const contest of batch.changed) cache.set(contest.id, contest);
      for (const id of batch.removed) cache.delete(id);
    }
    // In id order, so the text depends only on the contests, not on arrival order.
    const contests = [...cache.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const roster = buildJudgeRoster(contests, deps.today());
    const text = JSON.stringify(roster);
    if (text === lastPublished) {
      // The server already holds this roster, even if a newer one failed since.
      if (status.kind === 'failed') report({ kind: 'published', at: lastPublishedAt });
      return;
    }
    try {
      await deps.publish(roster);
    } catch (error) {
      // Offline, signed out, or a server hiccup: shown, and retried at the next event or wake.
      report({ kind: 'failed', at: deps.now().toISOString(), reason: publishFailureReason(error) });
      throw error;
    }
    lastPublished = text;
    lastPublishedAt = deps.now().toISOString();
    report({ kind: 'published', at: lastPublishedAt });
  });

  return {
    status: () => status,
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      stopped = true;
      unfollow();
      listeners.clear();
    },
  };
}

/** Today's local calendar date as YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

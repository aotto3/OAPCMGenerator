/**
 * Brings judge questionnaire answers into this device's contests (PRD #252).
 *
 * Like the roster publisher it rides the sync engine's status: whenever sync
 * settles after a real pass, it fetches the account's submissions, applies them to
 * every stored contest (applySubmissions is idempotent, so unchanged contests are
 * left alone), and saves the ones that changed; the save then syncs like any edit.
 *
 * An open contest holds its own in-memory copy and autosaves it whole, which would
 * overwrite a background save. So the latest submissions are also published on a
 * small in-memory channel the Workspace listens to and applies to its own copy;
 * both writes carry the same answers, so whichever lands last is still right.
 */
import type { Contest } from '../model/contest';
import type { SyncStatus } from '../storage/syncEngine';
import { applySubmissions, type JudgeSubmission } from './submission';

let latest: JudgeSubmission[] = [];
const listeners = new Set<(submissions: JudgeSubmission[]) => void>();

/** The most recently fetched submissions (empty until the first fetch). */
export function latestSubmissions(): JudgeSubmission[] {
  return latest;
}

/** Notified when a fetch brings different submissions. Returns an unsubscribe fn. */
export function onSubmissionsChanged(listener: (submissions: JudgeSubmission[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publishLatest(next: JudgeSubmission[]): void {
  if (JSON.stringify(next) === JSON.stringify(latest)) return;
  latest = next;
  for (const listener of listeners) listener(latest);
}

export interface SubmissionSyncDeps {
  subscribe(listener: (status: SyncStatus) => void): () => void;
  fetchSubmissions(): Promise<JudgeSubmission[]>;
  loadContests(): Promise<Contest[]>;
  saveContest(contest: Contest): Promise<void>;
  now(): string;
}

export function startSubmissionSync(deps: SubmissionSyncDeps): () => void {
  let sawSyncPass = false;
  let running = false;
  let rerun = false;

  async function pullAndApply(): Promise<void> {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      do {
        rerun = false;
        let submissions: JudgeSubmission[];
        try {
          submissions = await deps.fetchSubmissions();
        } catch {
          continue; // offline or signed out: the next settle retries
        }
        publishLatest(submissions);
        if (submissions.length === 0) continue;
        const now = deps.now();
        for (const contest of await deps.loadContests()) {
          const next = applySubmissions(contest, submissions, now);
          if (next !== contest) await deps.saveContest(next);
        }
      } while (rerun);
    } finally {
      running = false;
    }
  }

  return deps.subscribe((status) => {
    if (status === 'syncing') sawSyncPass = true;
    else if (status === 'synced' && sawSyncPass) void pullAndApply();
  });
}

/** Test seam: forget cached submissions between tests. */
export function __resetSubmissionCacheForTests(): void {
  latest = [];
  listeners.clear();
}

/**
 * Brings judge questionnaire answers into this device's contests (PRD #252).
 *
 * Like the roster publisher it rides the sync engine's status: whenever sync
 * settles after a real pass, it fetches the account's submissions and applies
 * them to every stored contest through the library's `transform`
 * (applySubmissions is idempotent, so an unchanged contest is a no-op). The
 * write then syncs like any edit.
 *
 * `transform` runs on an open contest's live copy, so answers reach an open
 * workspace through its session and are never overwritten by its next save.
 */
import type { Contest } from '../model/contest';
import type { SyncStatus } from '../storage/syncEngine';
import { applySubmissions, type JudgeSubmission } from './submission';

export interface SubmissionSyncDeps {
  subscribe(listener: (status: SyncStatus) => void): () => void;
  fetchSubmissions(): Promise<JudgeSubmission[]>;
  /** The ids of every stored contest. */
  contestIds(): Promise<string[]>;
  /** The library's read-transform-persist (one transaction; no-op on an identical result). */
  transform(id: string, fn: (fresh: Contest) => Contest): Promise<unknown>;
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
        if (submissions.length === 0) continue;
        const now = deps.now();
        for (const id of await deps.contestIds()) {
          await deps.transform(id, (fresh) => applySubmissions(fresh, submissions, now));
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

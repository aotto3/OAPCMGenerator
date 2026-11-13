/**
 * Brings judge questionnaire answers into this device's contests (PRD #252), as
 * a contest-library follower (RFC #276, slice A3 #279).
 *
 * The network is touched only when a batch includes a completed server pass:
 * then it fetches the account's submissions and applies them to every stored
 * contest. A batch of edits alone fetches nothing; it applies the submissions
 * already fetched to the contests that changed (a new contest, a judge's email
 * typed in). Passes come from the start-up reconcile, a reconnect, and the
 * wake port (tab focus and a periodic tick), which is how answers reach an open
 * tab without any edit.
 *
 * Writes go through the batch's `transform`: it runs on an open contest's live
 * copy, so answers reach an open workspace through its session, and they are
 * left out of this follower's next batch. applySubmissions is idempotent, so an
 * unchanged contest is a no-op. A failed fetch throws, so the library retries
 * the batch at the next event or wake.
 */
import type { Contest } from '../model/contest';
import type { FollowBatch } from '../storage/contestLibrary';
import { applySubmissions, type JudgeSubmission } from './submission';

export interface SubmissionSyncDeps {
  /** The library's `follow`. */
  follow(name: string, handler: (batch: FollowBatch) => Promise<void>): () => void;
  fetchSubmissions(): Promise<JudgeSubmission[]>;
  /** The ids of every stored contest. */
  contestIds(): Promise<string[]>;
  now(): string;
}

export function startSubmissionSync(deps: SubmissionSyncDeps): () => void {
  let submissions: JudgeSubmission[] = [];

  return deps.follow('submissions', async (batch) => {
    let ids: string[];
    if (batch.reconciled) {
      submissions = await deps.fetchSubmissions();
      ids = await deps.contestIds();
    } else {
      ids = batch.changed.map((contest) => contest.id);
    }
    if (submissions.length === 0) return;
    const now = deps.now();
    const apply = (fresh: Contest) => applySubmissions(fresh, submissions, now);
    for (const id of ids) await batch.transform(id, apply);
  });
}

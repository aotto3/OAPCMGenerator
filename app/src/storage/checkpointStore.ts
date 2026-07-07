/**
 * Local-first checkpoint storage (IndexedDB), alongside contests.
 *
 * The 'checkpoints' object store and its `byContest` index are declared in the
 * shared schema in contestStore.ts (bumped to DB_VERSION 2); this module is the
 * typed API over them. Records are the model's Checkpoint verbatim — the pure
 * makeCheckpoint/planRestore factories in model/checkpoint.ts do the snapshot
 * work, so this layer only reads and writes, never inspects the payload.
 */
import { makeCheckpoint, planRestore, type Checkpoint } from '../model/checkpoint';
import type { Contest } from '../model/contest';
import { db, saveContest } from './contestStore';

/** Snapshots `contest` as a named checkpoint and persists it. */
export async function createCheckpoint(
  contest: Contest,
  name: string,
  note = '',
  now: string = new Date().toISOString(),
): Promise<Checkpoint> {
  const checkpoint = makeCheckpoint(contest, name, note, now);
  await (await db()).put('checkpoints', checkpoint);
  return checkpoint;
}

/** A contest's checkpoints, newest first (for the history panel). */
export async function listCheckpoints(contestId: string): Promise<Checkpoint[]> {
  const records = await (await db()).getAllFromIndex('checkpoints', 'byContest', contestId);
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteCheckpoint(id: string): Promise<void> {
  await (await db()).delete('checkpoints', id);
}

/** Updates a checkpoint's note in place (v12 editSnapshotNote). No-op if gone. */
export async function updateCheckpointNote(id: string, note: string): Promise<void> {
  const database = await db();
  const existing = await database.get('checkpoints', id);
  if (!existing) return;
  await database.put('checkpoints', { ...existing, note: note.trim() });
}

/**
 * Restores a checkpoint over the current working copy, undoably: the pre-restore
 * state is auto-checkpointed FIRST (so the user can get back), then the restored
 * contest is persisted as the live record. `current` is the live working copy
 * from the workspace (which may hold edits not yet flushed to disk). Returns the
 * restored contest so the caller can install it into React state + autosave.
 */
export async function restoreCheckpoint(current: Contest, checkpointId: string): Promise<Contest> {
  const database = await db();
  const target = await database.get('checkpoints', checkpointId);
  if (!target) throw new Error('Checkpoint not found.');

  const plan = planRestore(current, target, new Date().toISOString());
  await database.put('checkpoints', plan.autoCheckpoint);
  await saveContest(plan.restored);
  return plan.restored;
}

/**
 * Checkpoints — immutable, named snapshots of a contest record (PRD module 4,
 * user stories 10 & 11). The 2.0 replacement for v12's browser "snapshots"
 * (saveSnapshot/loadSnapshot in _Templates/OAP Contest Setup.html): where v12
 * stored a curated field subset in localStorage, a checkpoint stores the FULL
 * contest record — serialized through the model codec, exactly like every other
 * copy that leaves memory.
 *
 * PURE MODULE. No React, no DOM, no IndexedDB. The snapshot is captured as the
 * versioned envelope serializeContest() produces, so a checkpoint round-trips
 * through the same forward-migrating codec as sync and export, and device-only
 * Speechwire credentials are stripped by construction (they are never in the
 * payload). The IndexedDB persistence lives in storage/checkpointStore.ts.
 */
import { parseContest, serializeContest, type Contest } from './contest';

export interface Checkpoint {
  /** Stable unique id; the object-store keyPath. */
  id: string;
  /** The contest this checkpoint belongs to (indexed for per-contest listing). */
  contestId: string;
  /** User-given label, e.g. "before judge change" (v12 snapshot name). */
  name: string;
  /** Optional free-text note; '' when none. */
  note: string;
  /** ISO 8601 capture time. */
  createdAt: string;
  /** Immutable snapshot: the versioned envelope from serializeContest(). */
  payload: string;
}

/**
 * Captures `contest` as an immutable checkpoint. The snapshot is serialized with
 * the model codec, so restoring it later parses/migrates like any stored
 * contest and can never carry device-only credentials. Pure: the caller supplies
 * `now` (and may supply `id`) so the factory is deterministic under test.
 */
export function makeCheckpoint(
  contest: Contest,
  name: string,
  note: string,
  now: string,
  id: string = crypto.randomUUID(),
): Checkpoint {
  return {
    id,
    contestId: contest.id,
    name: name.trim(),
    note: note.trim(),
    createdAt: now,
    payload: serializeContest(contest),
  };
}

/** The contest snapshotted inside a checkpoint, rehydrated through the codec. */
export function checkpointContest(checkpoint: Checkpoint): Contest {
  return parseContest(checkpoint.payload);
}

export interface RestorePlan {
  /**
   * A checkpoint of the pre-restore working copy — SAVE THIS FIRST so the
   * restore is itself undoable (PRD user story 11). Named "Before restore …".
   */
  autoCheckpoint: Checkpoint;
  /** The contest to install as the new working copy. */
  restored: Contest;
}

/** Auto-checkpoint label for the state captured just before a restore. */
export function beforeRestoreName(target: Checkpoint): string {
  return `Before restore "${target.name}"`;
}

/**
 * Pure ordering logic for an undoable restore: auto-checkpoint the current
 * working copy, then produce the restored contest to install over it.
 *
 * The restored contest is the checkpoint's snapshot re-parsed through the codec,
 * with (a) `updatedAt` bumped to `now` so it is newer than the record it
 * replaces and autosave persists it, and (b) the device's CURRENT Speechwire
 * credentials preserved — the snapshot never held credentials, and rolling back
 * contest content should not log the CM out of Speechwire. The id is unchanged
 * (same contest), so the restored copy overwrites, never duplicates.
 *
 * The caller persists these in order: autoCheckpoint first, then restored.
 */
export function planRestore(
  current: Contest,
  target: Checkpoint,
  now: string,
  autoCheckpointId?: string,
): RestorePlan {
  const snapshot = parseContest(target.payload);
  return {
    autoCheckpoint: makeCheckpoint(current, beforeRestoreName(target), '', now, autoCheckpointId),
    restored: { ...snapshot, speechwire: current.speechwire, updatedAt: now },
  };
}

import type { Contest } from '../model/contest';
import { contestLibrary } from '../storage/browserLibrary';
import { offerUndo } from './undoOffer';

/**
 * Best-effort safety net before a destructive action (PRD #304, #309, #312):
 * saves `before` (the contest as it is BEFORE the change) as an automatic
 * checkpoint labeled `label`, listed in Manual Save, then offers a one-click
 * Undo toast reading `done` (e.g. "Draw re-run"). Call it after the confirm is
 * accepted and before handing the changed contest to onChange. Never awaited
 * and never throws: a failed snapshot must not block the CM's action (it just
 * means no toast). The library captures the snapshot synchronously, so the
 * change that follows cannot leak into it.
 */
export function autoCheckpoint(before: Contest, label: string, done: string): void {
  try {
    void contestLibrary()
      .checkpoints.saveAuto(before, label)
      .then((cp) => offerUndo({ message: done, contestId: before.id, checkpointId: cp.id }))
      .catch(() => {});
  } catch {
    /* best-effort */
  }
}

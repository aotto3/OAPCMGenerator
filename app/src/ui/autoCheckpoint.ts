import type { Contest } from '../model/contest';
import { contestLibrary } from '../storage/browserLibrary';

/**
 * Best-effort safety net before a destructive action (PRD #304, #309): saves
 * `before` (the contest as it is BEFORE the change) as an automatic checkpoint
 * labeled `label`, listed in Manual Save. Call it after the confirm is
 * accepted and before handing the changed contest to onChange. Never awaited
 * and never throws: a failed snapshot must not block the CM's action. The
 * library captures the snapshot synchronously, so the change that follows
 * cannot leak into it.
 */
export function autoCheckpoint(before: Contest, label: string): void {
  try {
    void contestLibrary()
      .checkpoints.saveAuto(before, label)
      .catch(() => {});
  } catch {
    /* best-effort */
  }
}

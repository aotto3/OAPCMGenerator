/**
 * Last-write-wins reconciliation — the pure decision core of the sync layer.
 *
 * No network, no IndexedDB: given what this device holds and what the server
 * reports (each an {id, updatedAt} summary), decide per contest whether to push
 * the local copy up, pull the remote copy down, or do nothing. This is the whole
 * of the PRD's "last-write-wins PER CONTEST by updatedAt" policy, isolated so it
 * is unit-testable without a server (issue #27).
 *
 * updatedAt is an ISO-8601 UTC timestamp (the contest model's format); those
 * sort chronologically as plain strings, so a lexical compare is a time compare.
 * The known trade-off (simultaneous offline edits on two devices resolve to the
 * later save wholesale) is accepted per the PRD.
 */

export interface SyncSummary {
  id: string;
  updatedAt: string;
}

export type SyncDirection = 'push' | 'pull' | 'none';

/**
 * Resolves one contest given the local and remote updatedAt (undefined ⇒ the
 * side does not have it). Local-only ⇒ push; remote-only ⇒ pull; both ⇒ the
 * newer wins; a tie ⇒ nothing (already in agreement).
 */
export function resolveDirection(
  localUpdatedAt: string | undefined,
  remoteUpdatedAt: string | undefined,
): SyncDirection {
  if (localUpdatedAt === undefined && remoteUpdatedAt === undefined) return 'none';
  if (remoteUpdatedAt === undefined) return 'push';
  if (localUpdatedAt === undefined) return 'pull';
  if (localUpdatedAt > remoteUpdatedAt) return 'push';
  if (localUpdatedAt < remoteUpdatedAt) return 'pull';
  return 'none';
}

export interface ReconcilePlan {
  /** Contest ids whose local copy should be pushed to the server. */
  push: string[];
  /** Contest ids whose remote copy should be pulled to this device. */
  pull: string[];
}

/**
 * Plans a full reconcile over both summary lists. The union of ids is walked in
 * a stable order (local first, then remote-only), and each is resolved by
 * resolveDirection. Deletions are intentionally not inferred here: an id absent
 * locally but present remotely is a PULL (it may be new from another device),
 * which is why local deletes must propagate as explicit delete ops, not by
 * omission — see syncEngine.ts.
 */
export function planReconciliation(local: SyncSummary[], remote: SyncSummary[]): ReconcilePlan {
  const localById = new Map(local.map((s) => [s.id, s.updatedAt]));
  const remoteById = new Map(remote.map((s) => [s.id, s.updatedAt]));

  const push: string[] = [];
  const pull: string[] = [];
  const seen = new Set<string>();

  const consider = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const direction = resolveDirection(localById.get(id), remoteById.get(id));
    if (direction === 'push') push.push(id);
    else if (direction === 'pull') pull.push(id);
  };

  for (const s of local) consider(s.id);
  for (const s of remote) consider(s.id);

  return { push, pull };
}

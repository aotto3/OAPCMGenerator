/**
 * The subtle sync-status indicator (PRD module 4, issue #27). Deliberately
 * understated: a small dot and a few words in the account bar. The app never
 * blocks on the network, so this only ever informs — it never demands action.
 */
import type { SyncStatus as Status } from '../storage/syncEngine';

const LABELS: Record<Status, string> = {
  synced: 'All changes synced',
  syncing: 'Syncing…',
  pending: 'Saved · syncing soon',
  offline: 'Offline · saved on this device',
};

export function SyncStatus({ status }: { status: Status }) {
  return (
    <span className={`sync-status sync-status--${status}`} title={LABELS[status]}>
      <span className="sync-dot" aria-hidden="true" />
      <span className="sync-label">{LABELS[status]}</span>
    </span>
  );
}

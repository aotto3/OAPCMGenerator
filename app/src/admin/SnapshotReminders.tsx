import { snapshotIsStale } from '../model/uilAlignment';
import { UIL_ALIGNMENT_SNAPSHOT } from '../model/uilAlignmentSnapshot';
import { TTAO_SNAPSHOT } from '../model/ttaoRosterSnapshot';

const SNAPSHOTS = [
  { label: 'TTAO adjudicator list', asOf: TTAO_SNAPSHOT.asOf, command: 'npm run refresh:ttao' },
  { label: 'UIL district alignments', asOf: UIL_ALIGNMENT_SNAPSHOT.asOf, command: 'npm run refresh:alignments' },
];

function longDate(asOf: string): string {
  return new Date(`${asOf}T12:00:00`).toLocaleDateString('en-US', { dateStyle: 'long' });
}

function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Bundled reference data older than 11 months, with the command that refreshes it. */
export function SnapshotReminders() {
  const today = localToday();
  const stale = SNAPSHOTS.filter((s) => snapshotIsStale(s.asOf, today));
  if (!stale.length) return null;
  return (
    <section className="note-box" aria-label="Data to refresh">
      {stale.map((s) => (
        <p key={s.label}>
          ⏰ The {s.label} was last updated {longDate(s.asOf)}. Refresh it: run <code>{s.command}</code> in{' '}
          <code>app/</code>, then commit and deploy.
        </p>
      ))}
    </section>
  );
}

import { useState } from 'react';
import type { Contest } from '../../model/contest';
import { createSiblingZone, siblingZoneNumber } from '../../model/siblingZone';

/**
 * "Create Zone 2" / "Create Zone 1" (PRD #220). Rendered by IdentitySection, and
 * renders nothing unless the contest is Zone 1 or 2. What carries over lives in
 * model/siblingZone.ts. The source is the live contest prop, so edits still waiting
 * on autosave carry too; opening the new contest remounts the Workspace, which
 * flushes those edits to the source.
 */
export function CreateSiblingZoneControl({
  contest,
  onOpenSaved,
}: {
  contest: Contest;
  onOpenSaved: (contest: Contest) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zone = siblingZoneNumber(contest.identity);
  if (zone === null) return null;

  async function create() {
    const sibling = createSiblingZone(contest);
    if (!sibling) return;
    setBusy(true);
    setError(null);
    try {
      await onOpenSaved(sibling);
    } catch (err) {
      setError(`Couldn't create Zone ${zone}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="judge-copy">
      <div className="results-advance-actions">
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void create()}>
          Create Zone {zone}
        </button>
        <p className="hint">Carries the location, times, fees, and judges. Dates and schools start blank.</p>
      </div>
      {error && (
        <p className="import-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

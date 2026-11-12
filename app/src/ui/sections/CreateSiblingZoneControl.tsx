import { useEffect, useState } from 'react';
import type { Contest } from '../../model/contest';
import { createSiblingZone, findSiblingZones, siblingZoneNumber } from '../../model/siblingZone';
import { contestLibrary } from '../../storage/browserLibrary';
import type { ContestSummary } from '../../storage/contestLibrary';
import { useContestAction, useContestList } from '../contestHooks';
import { contestSummaryMeta } from './contestSummaryMeta';

/**
 * "Create Zone 2" / "Create Zone 1" and the links to the other zone (PRD #220).
 * Rendered by IdentitySection, and renders nothing unless the contest is Zone 1 or 2.
 * What carries over and what counts as a match live in model/siblingZone.ts. The
 * source is the live contest prop, so edits still waiting on autosave carry too;
 * opening another contest remounts the Workspace, which flushes those edits to the
 * source.
 */
export function CreateSiblingZoneControl({
  contest,
  onOpenSaved,
  onOpenContest,
}: {
  contest: Contest;
  onOpenSaved: (contest: Contest) => void | Promise<void>;
  onOpenContest: (id: string) => void;
}) {
  // Live, so a pull landing while this section is open can add a match.
  const contests = useContestList() ?? [];
  const { run, busy, error } = useContestAction();
  const [warning, setWarning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // A failure ends the warning dialog; the error explains what didn't happen.
  useEffect(() => {
    if (error) setWarning(false);
  }, [error]);

  // An identity edit can change which zone the warning is about, so it goes away.
  useEffect(() => {
    setWarning(false);
  }, [contest.identity]);

  const zone = siblingZoneNumber(contest.identity);
  if (zone === null) return null;
  const matches = findSiblingZones(contest, contests);

  // One library operation at a time; a failure is reported, not swallowed.
  function guarded(failure: string, work: () => Promise<void>) {
    setNotice(null);
    run(failure, work);
  }

  async function createNow() {
    const sibling = createSiblingZone(contest);
    if (sibling) await onOpenSaved(sibling);
  }

  function create() {
    guarded(`Couldn't create Zone ${zone}`, async () => {
      // Read fresh, so a match that arrived since the list loaded still warns.
      const fresh = await contestLibrary().list();
      if (findSiblingZones(contest, fresh).length > 0) setWarning(true);
      else await createNow();
    });
  }

  function open(target: ContestSummary) {
    guarded(`Couldn't open "${target.name}"`, async () => {
      if (await contestLibrary().read(target.id)) return onOpenContest(target.id);
      setWarning(false);
      setNotice(`"${target.name}" no longer exists.`);
    });
  }

  const matchButtons = (
    <ul className="judge-copy-targets">
      {matches.map((match) => (
        <li key={match.id}>
          <button type="button" className="judge-copy-target" disabled={busy} onClick={() => open(match)}>
            <span className="contest-name">{match.name}</span>
            {contestSummaryMeta(match) && <span className="muted">{contestSummaryMeta(match)}</span>}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="judge-copy">
      {warning && matches.length > 0 ? (
        <div className="results-advance-dialog" role="alertdialog" aria-label={`Zone ${zone} already exists`}>
          {matches.length === 1 ? (
            <p>
              <strong>{matches[0].name}</strong> already exists. Creating another makes a second Zone {zone} contest.
            </p>
          ) : (
            <>
              <p>These Zone {zone} contests already exist. Creating another adds one more.</p>
              {matchButtons}
            </>
          )}
          <div className="results-advance-actions">
            {matches.length === 1 && (
              <button type="button" className="btn-primary" disabled={busy} onClick={() => open(matches[0])}>
                Open existing
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => guarded(`Couldn't create Zone ${zone}`, createNow)}
            >
              Create anyway
            </button>
            <button type="button" className="btn-util" onClick={() => setWarning(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {matches.length > 0 && (
            <>
              <p className="hint">Other zone:</p>
              {matchButtons}
            </>
          )}
          <div className="results-advance-actions">
            <button type="button" className="btn-secondary" disabled={busy} onClick={create}>
              Create Zone {zone}
            </button>
            <p className="hint">Carries the location, times, fees, and judges. Dates and schools start blank.</p>
          </div>
        </>
      )}
      {(error ?? notice) && (
        <p className="import-error" role="alert">
          {error ?? notice}
        </p>
      )}
    </div>
  );
}

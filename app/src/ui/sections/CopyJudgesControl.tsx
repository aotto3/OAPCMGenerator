import { useEffect, useState } from 'react';
import type { Contest } from '../../model/contest';
import {
  canCopyJudges,
  copyJudges,
  judgeCopyImpact,
  judgeCopyTargets,
  type JudgeCopyImpact,
} from '../../model/copyJudges';
import {
  getContest,
  listContests,
  onContestPulled,
  saveContest,
  type ContestSummary,
} from '../../storage/contestStore';

/** A bare ISO date in words. Noon keeps it on the same day in every time zone. */
function targetDate(iso: string): string {
  if (!iso) return '';
  const date = new Date(`${iso}T12:00:00`);
  return isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { dateStyle: 'long' });
}

/** One line under a target's name: its date and host, each only when present. */
function targetMeta({ contestDate, hostSchoolName }: ContestSummary): string {
  const host = hostSchoolName.trim();
  return [targetDate(contestDate), host ? `Host: ${host}` : ''].filter(Boolean).join(' · ');
}

/** "A", "A and B", "A, B, and C". */
function nameList(names: string[]): string {
  if (names.length < 3) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/** Where the control is in its flow; a confirmation holds the impact it describes. */
type Step =
  | { kind: 'closed' }
  | { kind: 'picking' }
  | { kind: 'confirming'; target: ContestSummary; impact: JudgeCopyImpact; targetJudges: number };

/**
 * "Copy Judges to Other Zone" (PRD #220). Rendered by AdjudicatorsSection on Zone
 * contests only. The copy rules live in model/copyJudges.ts; this owns the flow:
 * pick a target, confirm if the copy would lose anything, then save the target
 * through the normal store path so it syncs. The source is the live contest prop,
 * so edits still waiting on autosave are included.
 */
export function CopyJudgesControl({ contest }: { contest: Contest }) {
  const [contests, setContests] = useState<ContestSummary[] | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'closed' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  // A pull landing while this section is open can add a target, so refresh on it.
  useEffect(() => {
    let active = true;
    const refresh = () => void listContests().then((list) => active && setContests(list));
    refresh();
    const off = onContestPulled(refresh);
    return () => {
      active = false;
      off();
    };
  }, []);

  // A later edit to these judges makes "Copied to..." misleading, so it goes away.
  useEffect(() => {
    setMessage(null);
  }, [contest.adjudicators]);

  const targets = contests ? judgeCopyTargets(contests, contest.id) : [];
  const hasJudges = canCopyJudges(contest);
  const noTargets = contests !== null && targets.length === 0;

  function missingTarget(target: ContestSummary) {
    setStep({ kind: 'closed' });
    setMessage({ text: `"${target.name}" no longer exists, so nothing was copied.`, error: true });
    void listContests().then(setContests);
  }

  // Runs one store operation at a time, reporting a storage failure instead of
  // leaving the CM unsure whether the copy happened.
  async function guarded(target: ContestSummary, work: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (err) {
      setStep({ kind: 'closed' });
      setMessage({
        text: `Couldn't copy to "${target.name}": ${err instanceof Error ? err.message : String(err)}`,
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function writeCopy(target: ContestSummary) {
    // Read fresh, so nothing that changed since the list loaded gets overwritten.
    const fresh = await getContest(target.id);
    if (!fresh) return missingTarget(target);
    await saveContest(copyJudges(contest, fresh, new Date().toISOString()));
    setStep({ kind: 'closed' });
    setMessage({ text: `Copied judges to ${target.name}.`, error: false });
    setContests(await listContests());
  }

  function pick(target: ContestSummary) {
    void guarded(target, async () => {
      const fresh = await getContest(target.id);
      if (!fresh) return missingTarget(target);
      const impact = judgeCopyImpact(contest, fresh);
      if (impact.needsConfirmation) {
        setStep({ kind: 'confirming', target, impact, targetJudges: fresh.details.numJudges });
      } else {
        await writeCopy(target);
      }
    });
  }

  return (
    <div className="judge-copy">
      {step.kind === 'closed' && (
        <div className="results-advance-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={contests === null || noTargets || !hasJudges}
            onClick={() => {
              setMessage(null);
              setStep({ kind: 'picking' });
              void listContests().then(setContests);
            }}
          >
            Copy Judges to Other Zone
          </button>
          {noTargets ? (
            <p className="hint">Create the other zone's contest first. Archived contests aren't listed.</p>
          ) : (
            contests !== null && !hasJudges && <p className="hint">Enter at least one judge to copy.</p>
          )}
        </div>
      )}

      {step.kind === 'picking' && (
        <div className="results-advance-dialog">
          <p>
            Choose the contest to receive these judges. Its judges and judge count will match this
            contest's. Nothing else changes.
          </p>
          {targets.length === 0 ? (
            <p className="hint">No other Zone contests are available.</p>
          ) : (
            <ul className="judge-copy-targets">
              {targets.map((target) => (
                <li key={target.id}>
                  <button type="button" className="judge-copy-target" disabled={busy} onClick={() => pick(target)}>
                    <span className="contest-name">{target.name}</span>
                    {targetMeta(target) && <span className="muted">{targetMeta(target)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn-util" onClick={() => setStep({ kind: 'closed' })}>
            Cancel
          </button>
        </div>
      )}

      {step.kind === 'confirming' && (
        <div className="results-advance-dialog" role="alertdialog" aria-label="Confirm copying judges">
          <p>
            Copy these judges to <strong>{step.target.name}</strong>?
          </p>
          {step.impact.replacedJudgeNames.length > 0 ? (
            <p>
              This replaces {nameList(step.impact.replacedJudgeNames)}, including any contracting
              checklist dates.
            </p>
          ) : (
            step.impact.targetHasJudgeData && <p>This replaces the judge information already in that contest.</p>
          )}
          {step.impact.clearsCritique && (
            <p>
              Its judge count changes from {step.targetJudges} to {contest.details.numJudges}, so its
              critique assignment will be cleared, even if locked. You can randomize it again in that
              contest.
            </p>
          )}
          <div className="results-advance-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void guarded(step.target, () => writeCopy(step.target))}
            >
              Copy and replace
            </button>
            <button type="button" className="btn-util" onClick={() => setStep({ kind: 'closed' })}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className={message.error ? 'import-error' : 'hint'} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </div>
  );
}

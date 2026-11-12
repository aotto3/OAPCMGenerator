/**
 * Copying judges from one Zone contest to another (PRD #220). Pure: contests in,
 * contest out. The UI (ui/sections/CopyJudgesControl.tsx) picks the target, asks
 * for confirmation using judgeCopyImpact, and persists the result.
 */
import type { Adjudicator, Contest, ContestLevel } from './contest';

/**
 * True when a judge slot holds anything worth protecting. hotelNights is left out:
 * it only means something once needsHotel is set.
 */
function hasJudgeData(judge: Adjudicator): boolean {
  return (
    judge.needsPower ||
    judge.needsHotel ||
    judge.requestingFlight ||
    [
      judge.name,
      judge.mailingAddress,
      judge.email,
      judge.cellPhone,
      judge.dietary,
      judge.bio,
      judge.judgeNotes,
      judge.ttaoContractDate,
      judge.paymentPaperworkSentDate,
      judge.paymentPaperworkReturnedDate,
    ].some((value) => value.trim() !== '')
  );
}

/** True when the contest's active judges have something to copy. */
export function canCopyJudges(source: Contest): boolean {
  return source.adjudicators.slice(0, source.details.numJudges).some(hasJudgeData);
}

/**
 * The contests a copy may go to: every other non-archived Zone contest. The CM
 * always picks from this list; there is deliberately no matching on year or
 * district. Generic so the dashboard summary rows pass through with their fields.
 */
export function judgeCopyTargets<T extends { id: string; contestLevel: ContestLevel | string; archived: boolean }>(
  contests: readonly T[],
  sourceId: string,
): T[] {
  return contests.filter((c) => c.contestLevel === 'Zone' && !c.archived && c.id !== sourceId);
}

function clearsCritique(source: Contest, target: Contest): boolean {
  return target.critique !== null && source.details.numJudges !== target.details.numJudges;
}

/** What a copy would do to the target, for wording the confirmation. */
export interface JudgeCopyImpact {
  /** Names of target judges being replaced, in slot order. */
  replacedJudgeNames: string[];
  /** Any stored slot counts, including ones hidden by the count: all get replaced. */
  targetHasJudgeData: boolean;
  clearsCritique: boolean;
  needsConfirmation: boolean;
}

export function judgeCopyImpact(source: Contest, target: Contest): JudgeCopyImpact {
  const targetHasJudgeData = target.adjudicators.some(hasJudgeData);
  const clears = clearsCritique(source, target);
  return {
    replacedJudgeNames: target.adjudicators.map((j) => j.name.trim()).filter(Boolean),
    targetHasJudgeData,
    clearsCritique: clears,
    needsConfirmation: targetHasJudgeData || clears,
  };
}

/**
 * One judge as copied to another contest (#263): identity, person-level fields
 * and bookkeeping dates carry over; the per-contest travel answers are blanked and
 * the questionnaire stamp cleared, so the judge's own answers for the target
 * contest still apply when submissions sync.
 */
function copyJudge(judge: Adjudicator): Adjudicator {
  return {
    ...judge,
    needsHotel: false,
    hotelNights: { before: false, after: false },
    requestingFlight: false,
    questionnaireUpdatedAt: '',
  };
}

/**
 * Returns the target with the source's judges and judge count. Critique refers to
 * judges by number, so it survives unless the count changes; then it is cleared,
 * even if locked, because a school could be left with a judge who no longer exists.
 */
export function copyJudges(source: Contest, target: Contest, now?: string): Contest {
  return {
    ...target,
    updatedAt: now ?? new Date().toISOString(),
    details: { ...target.details, numJudges: source.details.numJudges },
    adjudicators: source.adjudicators.map(copyJudge),
    critique: clearsCritique(source, target) ? null : target.critique,
  };
}

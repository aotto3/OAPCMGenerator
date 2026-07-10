/**
 * Results derivation — resolves the recorded results record into concrete,
 * displayable rows for the Awards Script and the Results & Advancement UI.
 *
 * PURE MODULE. Reads only the Contest model; no React, DOM, storage, or document
 * imports. The analog of critique.ts/schedule.ts: the stored record
 * (ContestResults) holds only school INDICES plus typed student names, and this
 * module joins those indices to school names/plays AT READ TIME — so renaming a
 * school flows through to every consumer with no results edit (PRD #66, user
 * story 32), exactly as docVars.critiqueRows re-derives judge names live.
 *
 * Two rules the derivation enforces for the ceremony:
 *   • Advancing companies come back in NO PARTICULAR ORDER (user story 6): the
 *     stored rank order is deliberately dropped by re-sorting into school form
 *     order, so no consumer can surface a placement.
 *   • Invalid / stale school indices (out of range for the current school list)
 *     are dropped rather than rendered as blanks.
 *
 * Returns null when no results are recorded (contest.results === null) — the
 * signal the Awards Script uses to fall back to its blank fill-in template,
 * mirroring critiqueRows() returning null when there is no assignment.
 */

import type { AwardWinner, Contest } from './contest';

/** A resolved company: a school paired with its play, both re-derived from the contest. */
export interface ResolvedCompany {
  schoolName: string;
  play: string;
}

/** A resolved individual honor: the typed student name + their re-derived school name. */
export interface ResolvedWinner {
  studentName: string;
  schoolName: string;
}

/** The recorded results resolved into concrete rows the Awards Script + UI render. */
export interface ResolvedResults {
  /** Advancing companies in NO PARTICULAR ORDER (stored rank deliberately dropped). */
  advancing: ResolvedCompany[];
  /** The alternate company, or null (none recorded, or a stale index). */
  alternate: ResolvedCompany | null;
  bestPerformers: ResolvedWinner[];
  allStarCast: ResolvedWinner[];
  honorableMention: ResolvedWinner[];
  /** Outstanding Technicians — at most one per school (enforced upstream). */
  outstandingTechnicians: ResolvedWinner[];
  /** Best Crew's company, or null. */
  bestCrew: ResolvedCompany | null;
}

/** True when the index points at a real school in the current contest. */
function isValidSchool(contest: Contest, schoolIndex: number): boolean {
  return Number.isInteger(schoolIndex) && schoolIndex >= 0 && schoolIndex < contest.schools.length;
}

/**
 * Resolves a school index to a company, or null for a stale/invalid index. A
 * blank school name falls back to "School N" (N = form position), matching the
 * docSchools convention the .docx generators already use for unnamed schools.
 */
function companyAt(contest: Contest, schoolIndex: number): ResolvedCompany | null {
  if (!isValidSchool(contest, schoolIndex)) return null;
  const school = contest.schools[schoolIndex];
  return { schoolName: school.name || `School ${schoolIndex + 1}`, play: school.playTitle || '' };
}

/** Resolves each winner's school index to a name, dropping any with a stale index. */
function resolveWinners(contest: Contest, winners: AwardWinner[]): ResolvedWinner[] {
  return winners.flatMap((w) => {
    const company = companyAt(contest, w.schoolIndex);
    return company ? [{ studentName: w.studentName, schoolName: company.schoolName }] : [];
  });
}

/**
 * Resolves the contest's recorded results into concrete rows. Returns null when
 * nothing is recorded (contest.results === null) — the blank-fallback signal.
 * Stale indices are dropped and the advancing companies are returned unordered.
 */
export function resolveResults(contest: Contest): ResolvedResults | null {
  const results = contest.results;
  if (results === null) return null;

  // Advancing: drop stale indices AND the stored rank order — sort the resolved
  // companies by school form index so no placement can leak downstream.
  const advancing = results.advancing
    .filter((i) => isValidSchool(contest, i))
    .slice()
    .sort((a, b) => a - b)
    .flatMap((i) => {
      const company = companyAt(contest, i);
      return company ? [company] : [];
    });

  return {
    advancing,
    alternate: results.alternate === null ? null : companyAt(contest, results.alternate),
    bestPerformers: resolveWinners(contest, results.bestPerformers),
    allStarCast: resolveWinners(contest, results.allStarCast),
    honorableMention: resolveWinners(contest, results.honorableMention),
    outstandingTechnicians: resolveWinners(contest, results.outstandingTechnicians),
    bestCrew: results.bestCrew === null ? null : companyAt(contest, results.bestCrew),
  };
}

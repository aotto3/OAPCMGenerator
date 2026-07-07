/**
 * Shared document-layer projections of the Contest record.
 *
 * v12 assembled a flat `vars` bag from the DOM (FormState._buildVars /
 * _readSchools) and every generator read `vars.schools`. The seven .docx ports
 * in this slice read the pure Contest record instead, but they all need the SAME
 * school projection v12's _readSchools produced — performance-order sort, the
 * "School N" blank-name fallback keyed on the ORIGINAL form position, and the
 * first director's name/email flattened onto each school. That projection is
 * lifted here so the builders share one definition rather than copy-pasting it
 * (letter.ts, merged before this slice, inlines the same logic; it is left
 * untouched to keep its golden stable).
 *
 * This lives in its own module rather than ooxml.ts because it is a data
 * projection over the model, not raw WordprocessingML — keeping ooxml.ts free of
 * any model dependency. Pure: no DOM, no OOXML.
 */

import { schoolsInPerformanceOrder, type Contest } from '../model/contest';

/** One school as the .docx generators consume it (v12 _readSchools shape). */
export interface DocSchool {
  /** 1-based performance-order slot. */
  order: number;
  /** School name, or "School N" (N = form position) when blank — v12 fallback. */
  name: string;
  /** Play title, or '' when blank. */
  play: string;
  /** First director's name, or '' — v12 flattened directors[0] onto the school. */
  director: string;
  /** First director's email, or ''. */
  email: string;
}

/**
 * Schools in performance order with v12's _readSchools fallbacks. The blank-name
 * fallback uses the school's ORIGINAL form position (computed before the sort),
 * exactly as v12 did, so "School 3" means the third row regardless of its draw.
 */
export function docSchools(contest: Contest): DocSchool[] {
  const formIndex = new Map(contest.schools.map((s, i) => [s, i + 1] as const));
  return schoolsInPerformanceOrder(contest).map((s) => ({
    order: s.performanceOrder,
    name: s.name || 'School ' + formIndex.get(s),
    play: s.playTitle || '',
    director: s.directors[0]?.name || '',
    email: s.directors[0]?.email || '',
  }));
}

/** One row of the critique assignment — a school paired with its assigned judge. */
export interface CritiqueRow {
  /** 1-based performance-order slot. */
  order: number;
  /** School name (docSchools "School N" fallback). */
  school: string;
  /** Play title, or '' when blank. */
  play: string;
  /** 1-based judge number. */
  judgeNumber: number;
  /** Assigned judge's name, or '' when that adjudicator row is blank. */
  judgeName: string;
}

/**
 * The stored critique assignment projected onto schools in performance order —
 * the shared shape the workspace table and the Directors Meeting Agenda both
 * render, so neither re-derives the join. Reuses docSchools() (same order the
 * assignment was indexed against) and reads judge names live from the contest,
 * so an adjudicator rename shows through without re-randomizing.
 *
 * Returns `null` when there is no assignment yet, or when a STALE assignment no
 * longer matches the current school count (e.g. the CM added a school after
 * generating) — callers then fall back to the no-assignment state rather than
 * render a mismatched table.
 */
export function critiqueRows(contest: Contest): CritiqueRow[] | null {
  const critique = contest.critique;
  const schools = docSchools(contest);
  if (!critique || critique.judgeByPosition.length !== schools.length) return null;
  return schools.map((s, i) => {
    const judgeNumber = critique.judgeByPosition[i];
    return {
      order: s.order,
      school: s.name,
      play: s.play,
      judgeNumber,
      judgeName: contest.adjudicators[judgeNumber - 1]?.name || '',
    };
  });
}

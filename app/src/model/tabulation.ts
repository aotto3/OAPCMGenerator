/**
 * Panel tabulation view: the pure derivation behind the Tabulation section
 * (PRD #236). Contest in, everything the UI renders out: the rows in
 * performance order with their live "School - Play" labels, the three judge
 * columns, per-cell validation, per-judge missing-rank notes, and (only when
 * every ballot is valid) the computed places from the rank.js port.
 *
 * PURE MODULE, a sibling of results.ts / critique.ts. Ranks are stored as raw
 * text on the contest (contest.tabulation), keyed by school form index; this
 * module parses and validates them at read time.
 */

import { tabulationEntry, type Contest } from './contest';
import { tabulate } from './tabulator';

/** Why a cell is not a usable rank. 'blank' is "not entered yet", the rest are mistakes. */
export type TabulationCellIssue = 'blank' | 'notWholeNumber' | 'outOfRange' | 'duplicate';

export interface TabulationRow {
  /** School form index (the key the ranks are stored under). */
  schoolIndex: number;
  /** "School - Play", read live; blank school falls back to "School N" (form position). */
  label: string;
  notRanked: boolean;
  /** Raw text per judge [Acting Judge, Judge B, Judge C]. */
  ranks: [string, string, string];
  /** Per-judge issue, or null when the cell holds a valid rank. Always null on a Not-ranked row. */
  issues: [TabulationCellIssue | null, TabulationCellIssue | null, TabulationCellIssue | null];
}

export interface TabulationResult {
  schoolIndex: number;
  label: string;
  place: number;
  ranks: [number, number, number];
  /** UIL prints " - TIE" after the name when set. */
  tie: boolean;
  diagnostic: string;
  diagnosticCode: string;
}

export interface TabulationView {
  /** The tool is built for exactly 3 judges; false hides the section. */
  applicable: boolean;
  /** Column names: each judge's name, or "Judge 1/2/3" when blank. Judge 1 is the Acting Judge. */
  judgeNames: [string, string, string];
  /** Every school, performance order (form order for ties), Not-ranked rows included. */
  rows: TabulationRow[];
  /** Schools on the ballots; valid ranks are 1..rankedCount. */
  rankedCount: number;
  /** Count of cells still blank on ranked rows. */
  blankCount: number;
  /** Count of cells with a real mistake (not a whole number, out of range, duplicate). */
  errorCount: number;
  /**
   * Per judge, the ranks 1..rankedCount nobody received from that judge, listed
   * only once the judge's column has no blank or non-number cells (before that
   * the gaps are just unfinished entry).
   */
  missingRanks: [number[], number[], number[]];
  /** Computed places, sorted by place; null until every ballot is valid (and at least one school is ranked). */
  results: TabulationResult[] | null;
}

/** Human text for a cell issue, given the current rank range. */
export function cellIssueMessage(issue: TabulationCellIssue, rankedCount: number): string {
  switch (issue) {
    case 'blank':
      return 'Required';
    case 'notWholeNumber':
      return 'Not a whole number';
    case 'outOfRange':
      return `Must be 1-${rankedCount}`;
    case 'duplicate':
      return 'Duplicate ranking';
  }
}

/** The display label for a school: "School - Play", or just the school when no play is entered. */
function schoolLabel(contest: Contest, schoolIndex: number): string {
  const school = contest.schools[schoolIndex];
  const name = school.name.trim() || `School ${schoolIndex + 1}`;
  const play = school.playTitle.trim();
  return play ? `${name} - ${play}` : name;
}

export function tabulationView(contest: Contest): TabulationView {
  const judgeNames = [0, 1, 2].map((j) => contest.adjudicators[j]?.name.trim() || `Judge ${j + 1}`) as [
    string,
    string,
    string,
  ];

  // Performance order, stable on form order for equal order numbers.
  const order = contest.schools
    .map((s, i) => ({ i, o: s.performanceOrder }))
    .sort((a, b) => a.o - b.o || a.i - b.i)
    .map((x) => x.i);

  const base = order.map((schoolIndex) => {
    const entry = tabulationEntry(contest, schoolIndex);
    return {
      schoolIndex,
      label: schoolLabel(contest, schoolIndex),
      notRanked: entry.notRanked,
      ranks: [...entry.ranks] as [string, string, string],
    };
  });
  const rankedCount = base.filter((r) => !r.notRanked).length;

  // First pass: per-cell shape and range.
  const rows: TabulationRow[] = base.map((r) => ({
    ...r,
    issues: r.ranks.map((text) => {
      if (r.notRanked) return null;
      const t = text.trim();
      if (t === '') return 'blank';
      if (!/^\d+$/.test(t)) return 'notWholeNumber';
      const n = Number(t);
      if (n < 1 || n > rankedCount) return 'outOfRange';
      return null;
    }) as TabulationRow['issues'],
  }));

  // Second pass: duplicates within a judge, flagged on every cell that shares the rank.
  const missingRanks: TabulationView['missingRanks'] = [[], [], []];
  for (let j = 0; j < 3; j++) {
    const byRank = new Map<number, TabulationRow[]>();
    for (const row of rows) {
      if (row.notRanked || row.issues[j] !== null) continue;
      const n = Number(row.ranks[j].trim());
      byRank.set(n, [...(byRank.get(n) ?? []), row]);
    }
    for (const group of byRank.values()) {
      if (group.length > 1) for (const row of group) row.issues[j] = 'duplicate';
    }
    const columnSettled = rows.every(
      (row) => row.notRanked || (row.issues[j] !== 'blank' && row.issues[j] !== 'notWholeNumber'),
    );
    if (columnSettled) {
      for (let rank = 1; rank <= rankedCount; rank++) if (!byRank.has(rank)) missingRanks[j].push(rank);
    }
  }

  let blankCount = 0;
  let errorCount = 0;
  for (const row of rows) {
    for (const issue of row.issues) {
      if (issue === 'blank') blankCount++;
      else if (issue !== null) errorCount++;
    }
  }

  const ranked = rows.filter((r) => !r.notRanked);
  let results: TabulationResult[] | null = null;
  if (blankCount === 0 && errorCount === 0 && ranked.length > 0) {
    const byIndex = new Map(ranked.map((r) => [r.schoolIndex, r]));
    results = tabulate(
      ranked.map((r) => ({
        key: r.schoolIndex,
        ranks: r.ranks.map((t) => Number(t.trim())) as [number, number, number],
      })),
    ).map((t) => ({
      schoolIndex: t.key,
      label: byIndex.get(t.key)!.label,
      place: t.place,
      ranks: [...t.ranks] as [number, number, number],
      tie: t.tie,
      diagnostic: t.diagnostic,
      diagnosticCode: t.diagnosticCode,
    }));
  }

  return {
    applicable: contest.details.numJudges === 3,
    judgeNames,
    rows,
    rankedCount,
    blankCount,
    errorCount,
    missingRanks,
    results,
  };
}

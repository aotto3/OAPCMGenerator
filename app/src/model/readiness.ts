/**
 * Readiness report — the pure calculator behind the Contest Readiness page
 * (PRD #75, Group G). Given a contest, it returns a top-level red/yellow/green
 * rollup plus the seven chronological lifecycle phases, each with its own
 * done/total, color, and an ordered list of items.
 *
 * PURE MODULE, a sibling of schedule.ts / critique.ts: contest in → report out.
 * No React, no DOM, no storage, no mutation. It COMPOSES the derivations that
 * already exist rather than reinventing them — section completion, validation,
 * generation warnings, the schedule and critique calculators, and Groups A–E's
 * own derivations (compliance progress, draw-lock, results, judge milestones,
 * company roster counts) — and reads the manual/custom check-off state G1 stores
 * on the contest. The report is the ONLY thing the G3 UI renders; the UI is a
 * thin view over this shape (PRD user story 28).
 *
 * Counts and color follow Group A's compliance rules exactly: an item is
 * *applicable* unless marked N-A; the counter is resolved/applicable; a phase (or
 * the whole contest) with nothing applicable is green. Derived items are
 * read-only and computed here (status done/pending, never N-A); manual and custom
 * items carry the stored tri-state.
 */

import {
  BUILT_IN_READINESS_ITEMS,
  READINESS_PHASES,
  adjudicatorMilestoneStatus,
  companyCounts,
  complianceItems,
  complianceProgress,
  generationWarnings,
  resolveReadinessStatus,
  sectionCompletion,
  validateContest,
  type Contest,
  type ReadinessItemDef,
  type ReadinessPhase,
  type ReadinessStatus,
  type SectionCompletion,
} from './contest';
import { computeSchedule } from './schedule';
import { resolveResults } from './results';

/** Red at zero, yellow in progress, green when everything applicable is resolved. */
export const READINESS_COLORS = ['red', 'yellow', 'green'] as const;
export type ReadinessColor = (typeof READINESS_COLORS)[number];

/** How an item gets its status: computed from data, or a stored manual/custom check-off. */
export type ReadinessItemKind = 'derived' | 'manual' | 'custom';

/** The workspace section-anchor a derived item jumps to (matches Workspace.tsx DOM ids). */
export type ReadinessSection =
  | 'sec-cm'
  | 'sec-identity'
  | 'sec-details'
  | 'sec-adjudicators'
  | 'sec-schools'
  | 'sec-plays'
  | 'sec-companies'
  | 'sec-draw'
  | 'sec-compliance'
  | 'sec-schedule'
  | 'sec-critique'
  | 'sec-generate'
  | 'sec-results';

/** Partial progress for items that have a count, e.g. "5 of 6 schools". */
export interface ReadinessCount {
  done: number;
  total: number;
}

export interface ReadinessReportItem {
  /** Stable id — a derived-item slug, or the manual/custom item's own id. */
  id: string;
  label: string;
  kind: ReadinessItemKind;
  /** 'done' | 'pending' | 'na'. Derived items are only ever done/pending. */
  status: ReadinessStatus;
  /** Optional granular progress (display only; the phase counts ITEMS, not sub-units). */
  count?: ReadinessCount;
  /** Derived items only: the section that resolves this item (click-to-jump). */
  section?: ReadinessSection;
}

export interface ReadinessPhaseReport {
  phase: ReadinessPhase;
  label: string;
  items: ReadinessReportItem[];
  /** Items resolved (done). */
  done: number;
  /** Items not marked N-A — the counter's denominator. */
  applicable: number;
  color: ReadinessColor;
}

export interface ReadinessReport {
  phases: ReadinessPhaseReport[];
  /** Resolved items across every phase. */
  done: number;
  /** Applicable (not-N-A) items across every phase. */
  applicable: number;
  color: ReadinessColor;
}

/** Display names for the seven phases — the report's single source of truth. */
const PHASE_LABELS: Record<ReadinessPhase, string> = {
  preliminary: 'Preliminary Info',
  planning: 'Planning Meeting',
  contracting: 'Contracting',
  entry: 'Entry',
  draw_schedule: 'Draw & Schedule',
  contest_day: 'Contest Day',
  results_advancement: 'Results & Advancement',
};

/** Group A's color rule, reused verbatim: green when nothing applicable is still pending. */
function colorFor(done: number, applicable: number): ReadinessColor {
  const pending = applicable - done;
  return pending === 0 ? 'green' : done === 0 ? 'red' : 'yellow';
}

/** A completed section is one with every field filled (an empty section counts done). */
function sectionDone(sc: SectionCompletion): boolean {
  return sc.total === 0 || sc.done === sc.total;
}

/**
 * Builds the derived items for a contest, each tagged with the phase it comes due
 * in. Every item COMPOSES an existing derivation — nothing is recomputed from raw
 * fields here. Status is done/pending (derived items are never N-A); a count is
 * attached wherever partial progress is meaningful.
 */
function derivedItems(contest: Contest): { phase: ReadinessPhase; item: ReadinessReportItem }[] {
  const sc = sectionCompletion(contest);
  const derived = (
    phase: ReadinessPhase,
    id: string,
    label: string,
    section: ReadinessSection,
    done: boolean,
    count?: ReadinessCount,
  ): { phase: ReadinessPhase; item: ReadinessReportItem } => ({
    phase,
    item: { id, label, kind: 'derived', status: done ? 'done' : 'pending', section, ...(count ? { count } : {}) },
  });

  // Section completion → one item per data section, in its phase, with its count.
  const sectionCount = (key: keyof typeof sc): ReadinessCount => ({ done: sc[key].done, total: sc[key].total });

  // Judge contracting milestones (D): sum done/total across the ACTIVE judges.
  const activeJudges = contest.adjudicators.slice(0, contest.details.numJudges);
  const milestoneRows = activeJudges.flatMap((j) => adjudicatorMilestoneStatus(j));
  const milestonesDone = milestoneRows.filter((m) => m.done).length;

  // Compliance (A): a school is resolved when its tracker is green.
  const items = complianceItems(contest);
  const compliantSchools = contest.schools.filter((s) => complianceProgress(s, items).color === 'green').length;

  // Company rosters (E): a school counts entered once it has any roster member.
  const schoolsWithRoster = contest.schools.filter((s) => companyCounts(s).total > 0).length;
  const numSchools = contest.schools.length;

  return [
    // ── Preliminary Info ──
    derived('preliminary', 'cm', 'Contest Manager info', 'sec-cm', sectionDone(sc.cm), sectionCount('cm')),
    derived('preliminary', 'identity', 'Contest identity', 'sec-identity', sectionDone(sc.identity), sectionCount('identity')),
    derived('preliminary', 'validation', 'No validation errors', 'sec-identity', validateContest(contest).length === 0),
    // ── Planning Meeting ──
    derived('planning', 'details', 'Planning-meeting details', 'sec-details', sectionDone(sc.details), sectionCount('details')),
    // ── Contracting ──
    derived('contracting', 'judges', 'Judges entered', 'sec-adjudicators', sectionDone(sc.adjudicators), sectionCount('adjudicators')),
    derived(
      'contracting',
      'judge_milestones',
      'Judge contracting milestones',
      'sec-adjudicators',
      milestoneRows.length > 0 && milestonesDone === milestoneRows.length,
      { done: milestonesDone, total: milestoneRows.length },
    ),
    // ── Entry ──
    derived('entry', 'schools', 'Schools entered', 'sec-schools', sectionDone(sc.schools), sectionCount('schools')),
    derived('entry', 'plays', 'Play titles entered', 'sec-plays', sectionDone(sc.plays), sectionCount('plays')),
    derived('entry', 'compliance', 'Compliance resolved', 'sec-compliance', compliantSchools === numSchools, {
      done: compliantSchools,
      total: numSchools,
    }),
    derived('entry', 'rosters', 'Company rosters entered', 'sec-companies', schoolsWithRoster === numSchools, {
      done: schoolsWithRoster,
      total: numSchools,
    }),
    // ── Draw & Schedule ──
    derived('draw_schedule', 'draw', 'Performance-order draw locked', 'sec-draw', contest.draw?.locked === true),
    derived('draw_schedule', 'schedule', 'Contest-day schedule builds', 'sec-schedule', computeSchedule(contest).length > 0),
    derived('draw_schedule', 'critique', 'Critique assignment set', 'sec-critique', contest.critique !== null),
    // ── Contest Day ──
    derived('contest_day', 'documents', 'Ready to generate documents', 'sec-generate', generationWarnings(contest).length === 0),
    // ── Results & Advancement ──
    derived('results_advancement', 'results', 'Results entered', 'sec-results', resolveResults(contest) !== null),
  ];
}

/** Turns a manual/custom item definition into a report item with its stored status. */
function manualItem(contest: Contest, def: ReadinessItemDef, kind: 'manual' | 'custom'): ReadinessReportItem {
  return { id: def.id, label: def.label, kind, status: resolveReadinessStatus(contest, def.id) };
}

/**
 * Composes the full readiness report for a contest. Derived items come first in
 * each phase (read-only, computed), then the fixed built-in manual items, then the
 * CM's custom items — each in its declared phase. Phase and overall rollups follow
 * Group A's applicable/N-A counting.
 */
export function readinessReport(contest: Contest): ReadinessReport {
  const derived = derivedItems(contest);

  const phases: ReadinessPhaseReport[] = READINESS_PHASES.map((phase) => {
    const items: ReadinessReportItem[] = [
      ...derived.filter((d) => d.phase === phase).map((d) => d.item),
      ...BUILT_IN_READINESS_ITEMS.filter((d) => d.phase === phase).map((d) => manualItem(contest, d, 'manual')),
      ...contest.customReadinessItems.filter((d) => d.phase === phase).map((d) => manualItem(contest, d, 'custom')),
    ];
    let done = 0;
    let applicable = 0;
    for (const item of items) {
      if (item.status === 'na') continue;
      applicable++;
      if (item.status === 'done') done++;
    }
    return { phase, label: PHASE_LABELS[phase], items, done, applicable, color: colorFor(done, applicable) };
  });

  const done = phases.reduce((sum, p) => sum + p.done, 0);
  const applicable = phases.reduce((sum, p) => sum + p.applicable, 0);
  return { phases, done, applicable, color: colorFor(done, applicable) };
}

/**
 * Dashboard contest sorting (PRD #142) — pure, no React, no DOM.
 *
 * The comparator is the deep, isolated core: it owns blanks-always-at-bottom and
 * the tie-break rules, so the Dashboard just picks a key + direction and renders
 * the result. This slice covers the keys already present on ContestSummary
 * (contest date, last edited, name); level/classification/year land in a later
 * slice by extending SortKey and the compare switch.
 *
 * Persistence (localStorage) deliberately lives with the Dashboard, not here, so
 * this module stays pure and unit-testable without a browser.
 */
import { CLASSIFICATIONS, CONTEST_LEVELS } from '../model/contest';
import type { ContestSummary } from '../storage/contestStore';

export type SortKey = 'date' | 'lastEdited' | 'name' | 'level' | 'classification' | 'year';
export type SortDirection = 'asc' | 'desc';

export interface SortPref {
  key: SortKey;
  direction: SortDirection;
}

/** First-ever load: newest-edited first — the app's original default order. */
export const DEFAULT_SORT: SortPref = { key: 'lastEdited', direction: 'desc' };

/** Sort keys in menu order, with their labels. */
export const SORT_KEYS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'lastEdited', label: 'Last edited' },
  { key: 'date', label: 'Contest date' },
  { key: 'level', label: 'Level' },
  { key: 'classification', label: 'Classification' },
  { key: 'year', label: 'Contest year' },
  { key: 'name', label: 'Name' },
];

/** Direction labels that read naturally per key (e.g. date → "Soonest first"). */
export function directionLabel(key: SortKey, direction: SortDirection): string {
  const asc = direction === 'asc';
  switch (key) {
    case 'date':
      return asc ? 'Soonest first' : 'Latest first';
    case 'lastEdited':
      return asc ? 'Oldest first' : 'Newest first';
    case 'name':
      return asc ? 'A → Z' : 'Z → A';
    case 'level':
      return asc ? 'Zone → Region' : 'Region → Zone';
    case 'classification':
      return asc ? '1A → 6A' : '6A → 1A';
    case 'year':
      return asc ? 'Earliest first' : 'Latest first';
  }
}

/** Whether a summary has no value for the given key (drives blanks-to-bottom). */
function isBlank(s: ContestSummary, key: SortKey): boolean {
  switch (key) {
    case 'date':
      return s.contestDate.trim() === '';
    case 'name':
      return s.name.trim() === '';
    case 'year':
      return s.contestYear.trim() === '';
    case 'lastEdited':
      return s.updatedAt.trim() === ''; // always set in practice
    case 'level':
    case 'classification':
      return false; // always set on a valid contest (enum with a default)
  }
}

const byName = (a: ContestSummary, b: ContestSummary): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** Compare on the primary key value (ascending sense; direction applied by caller). */
function comparePrimary(a: ContestSummary, b: ContestSummary, key: SortKey): number {
  switch (key) {
    case 'date':
      return a.contestDate.localeCompare(b.contestDate); // ISO yyyy-mm-dd sorts chronologically
    case 'lastEdited':
      return a.updatedAt.localeCompare(b.updatedAt); // ISO timestamp sorts chronologically
    case 'name':
      return byName(a, b);
    case 'level':
      // UIL progression, not alphabetical: Zone → District → BiDistrict → Area → Region.
      return CONTEST_LEVELS.indexOf(a.contestLevel) - CONTEST_LEVELS.indexOf(b.contestLevel);
    case 'classification':
      // Conference order 1A → 6A, not string order.
      return CLASSIFICATIONS.indexOf(a.classification) - CLASSIFICATIONS.indexOf(b.classification);
    case 'year': {
      // Numeric when both parse (so "2026" < "2027"); fall back to string order.
      const ay = Number(a.contestYear);
      const by = Number(b.contestYear);
      if (Number.isNaN(ay) || Number.isNaN(by)) return a.contestYear.localeCompare(b.contestYear);
      return ay - by;
    }
  }
}

/** Ties break by contest date (soonest, blanks last), then name A→Z. */
function compareByDateThenName(a: ContestSummary, b: ContestSummary): number {
  const ab = a.contestDate.trim() === '';
  const bb = b.contestDate.trim() === '';
  if (ab !== bb) return ab ? 1 : -1; // undated sinks within the tie
  if (!ab) {
    const byDate = a.contestDate.localeCompare(b.contestDate); // soonest first
    if (byDate !== 0) return byDate;
  }
  return byName(a, b);
}

/** Secondary ordering within a primary tie (and within a group of blanks). */
function tieBreak(a: ContestSummary, b: ContestSummary, key: SortKey): number {
  // When Name is the key, ties fall back to last-edited (newest first).
  if (key === 'name') return b.updatedAt.localeCompare(a.updatedAt);
  return compareByDateThenName(a, b);
}

/**
 * Returns a new array sorted by the chosen key + direction. Contests missing a
 * value for the key always sink to the bottom regardless of direction; ties (and
 * groups of blanks) resolve by the tie-break so ordering is fully deterministic.
 */
export function sortContests(summaries: ContestSummary[], { key, direction }: SortPref): ContestSummary[] {
  const dir = direction === 'asc' ? 1 : -1;
  return [...summaries].sort((a, b) => {
    const ab = isBlank(a, key);
    const bb = isBlank(b, key);
    if (ab !== bb) return ab ? 1 : -1; // blanks always last, regardless of direction
    if (!ab) {
      const primary = comparePrimary(a, b, key);
      if (primary !== 0) return primary * dir;
    }
    return tieBreak(a, b, key);
  });
}

/** Narrowing guards for restoring a persisted preference. */
export function isSortKey(v: unknown): v is SortKey {
  return (
    v === 'date' ||
    v === 'lastEdited' ||
    v === 'name' ||
    v === 'level' ||
    v === 'classification' ||
    v === 'year'
  );
}
export function isSortDirection(v: unknown): v is SortDirection {
  return v === 'asc' || v === 'desc';
}

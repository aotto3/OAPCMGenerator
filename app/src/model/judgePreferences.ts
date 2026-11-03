/**
 * Judge preference calculator (PRD #202). Pure and total: preference lists in,
 * the computed call list out, with no React, storage, or clock. The order is
 * always derived, never stored, so it can't drift from the lists.
 *
 * Points: with N the longest list's length, rank r earns N + 1 - r, and an
 * unlisted judge earns 0 from that list. Ties break by most lists naming the
 * judge, then best single rank; judges equal on all three are flagged as tied
 * and listed alphabetically.
 */
import { normalizeJudgeName, type Contest, type ContestLevel } from './contest';

/** One list as the calculator sees it, whichever school or group it came from. */
export interface PreferenceList {
  id: string;
  label: string;
  /** Judge names, best first. */
  ranked: string[];
}

export interface CallListEntry {
  /** The first spelling encountered, in list order. */
  name: string;
  points: number;
  /** How many lists name this judge. */
  listCount: number;
  /** Best (lowest) 1-based rank on any list. */
  bestRank: number;
  /** True when another judge matches on points, list count, and best rank. */
  tied: boolean;
}

/** Levels where preferences apply. Area and Region judges are picked by the state. */
const LEVELS_WITH_PREFERENCES: readonly ContestLevel[] = ['Zone', 'District'];

export function preferencesAvailable(level: ContestLevel): boolean {
  return LEVELS_WITH_PREFERENCES.includes(level);
}

/** The lists that count for this contest's level, in display order. */
export function activePreferenceLists(contest: Contest): PreferenceList[] {
  if (!preferencesAvailable(contest.identity.contestLevel)) return [];
  return contest.schools.map((school, i) => ({
    id: `school-${i}`,
    label: school.name.trim() || `School ${i + 1}`,
    ranked: school.judgePreferences.ranked,
  }));
}

/** Drops blanks and repeats, keeping each judge's best rank on the list. */
function cleanRanked(ranked: readonly string[]): string[] {
  const seen = new Set<string>();
  return ranked.filter((name) => {
    const key = normalizeJudgeName(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** How many lists have at least one name, out of all lists. */
export function preferenceProgress(lists: readonly PreferenceList[]): { entered: number; total: number } {
  return {
    entered: lists.filter((list) => cleanRanked(list.ranked).length > 0).length,
    total: lists.length,
  };
}

export function combinePreferenceLists(lists: readonly PreferenceList[]): CallListEntry[] {
  const cleaned = lists.map((list) => cleanRanked(list.ranked));
  const longest = Math.max(0, ...cleaned.map((ranked) => ranked.length));

  const byJudge = new Map<string, Omit<CallListEntry, 'tied'>>();
  for (const ranked of cleaned) {
    ranked.forEach((name, i) => {
      const key = normalizeJudgeName(name);
      const rank = i + 1;
      const points = longest + 1 - rank;
      const entry = byJudge.get(key);
      if (entry) {
        entry.points += points;
        entry.listCount += 1;
        entry.bestRank = Math.min(entry.bestRank, rank);
      } else {
        byJudge.set(key, { name, points, listCount: 1, bestRank: rank });
      }
    });
  }

  const standing = (e: Omit<CallListEntry, 'tied'>) => `${e.points}|${e.listCount}|${e.bestRank}`;
  const standingCounts = new Map<string, number>();
  for (const entry of byJudge.values()) {
    standingCounts.set(standing(entry), (standingCounts.get(standing(entry)) ?? 0) + 1);
  }

  return [...byJudge.entries()]
    .sort(([keyA, a], [keyB, b]) => {
      if (a.points !== b.points) return b.points - a.points;
      if (a.listCount !== b.listCount) return b.listCount - a.listCount;
      if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank;
      return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
    })
    .map(([, entry]) => ({ ...entry, tied: (standingCounts.get(standing(entry)) ?? 0) > 1 }));
}

/**
 * Judge preference calculator (PRD #202). Pure and total: preference lists in,
 * the computed call list out, with no React, storage, or clock. The order is
 * always derived, never stored, so it can't drift from the lists.
 *
 * Points: with N the longest list's length, rank r earns N + 1 - r, and an
 * unlisted judge earns 0 from that list. Ties break by most lists naming the
 * judge, then best single rank; judges equal on all three are flagged as tied
 * and listed alphabetically.
 *
 * Vetoes: one veto on any list takes a judge off the call list and into the
 * Vetoed section. N is computed before vetoes apply, so a veto never changes
 * another judge's points.
 *
 * Unavailable: a mark flags the judge but changes nothing else, so they keep their
 * computed position and any tie.
 *
 * Judge slots: whether a judge is hired is read from the active slots on demand and
 * never stored, so the call list and the Judges section can't disagree.
 */
import {
  normalizeJudgeName,
  withAdjudicator,
  type Adjudicator,
  type Contest,
  type ContestLevel,
  type PreferenceListRef,
} from './contest';

/** One list as the calculator sees it, whichever school or group it came from. */
export interface PreferenceList {
  id: string;
  label: string;
  /** Judge names, best first. */
  ranked: string[];
  vetoes: string[];
}

/** A list that counts at this contest's level, with the ref its edits go through. */
export interface ActivePreferenceList extends PreferenceList {
  ref: PreferenceListRef;
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
  /** The CM marked this judge Unavailable. */
  unavailable: boolean;
}

export interface VetoedJudge {
  name: string;
  /** Labels of every list that vetoed this judge, in list order. */
  vetoedBy: string[];
}

/** One list both ranks and vetoes a judge. The veto wins until the CM fixes it. */
export interface PreferenceConflict {
  listId: string;
  listLabel: string;
  name: string;
}

export interface CombinedPreferences {
  callList: CallListEntry[];
  vetoed: VetoedJudge[];
  conflicts: PreferenceConflict[];
}

/** Levels where preferences apply. Area and Region judges are picked by the state. */
const LEVELS_WITH_PREFERENCES: readonly ContestLevel[] = ['Zone', 'District', 'BiDistrict'];

export function preferencesAvailable(level: ContestLevel): boolean {
  return LEVELS_WITH_PREFERENCES.includes(level);
}

function districtLabel(number: string, fallback: string): string {
  return number.trim() ? `District ${number.trim()}` : fallback;
}

/**
 * The lists that count for this contest's level, in display order: one per school
 * at Zone and District, one per district at BiDistrict, then any custom lists.
 * Lists for other levels stay stored but inactive, so a level switch loses nothing.
 */
export function activePreferenceLists(contest: Contest): ActivePreferenceList[] {
  const { contestLevel, district, districtSecond } = contest.identity;
  if (!preferencesAvailable(contestLevel)) return [];
  const { firstDistrict, secondDistrict, customLists } = contest.judgePreferences;

  const levelLists: ActivePreferenceList[] =
    contestLevel === 'BiDistrict'
      ? [
          {
            id: 'district-first',
            label: districtLabel(district, 'First district'),
            ref: { kind: 'firstDistrict' },
            ranked: firstDistrict.ranked,
            vetoes: firstDistrict.vetoes,
          },
          {
            id: 'district-second',
            label: districtLabel(districtSecond, 'Second district'),
            ref: { kind: 'secondDistrict' },
            ranked: secondDistrict.ranked,
            vetoes: secondDistrict.vetoes,
          },
        ]
      : contest.schools.map((school, i) => ({
          id: `school-${i}`,
          label: school.name.trim() || `School ${i + 1}`,
          ref: { kind: 'school', index: i },
          ranked: school.judgePreferences.ranked,
          vetoes: school.judgePreferences.vetoes,
        }));

  return [
    ...levelLists,
    ...customLists.map(
      (list, i): ActivePreferenceList => ({
        id: `custom-${list.id}`,
        label: list.name.trim() || `Custom list ${i + 1}`,
        ref: { kind: 'custom', id: list.id },
        ranked: list.ranked,
        vetoes: list.vetoes,
      }),
    ),
  ];
}

/** Drops blanks and repeats, keeping each name's first (best) position. */
function cleanNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = normalizeJudgeName(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** How many lists have at least one name, ranked or vetoed, out of all lists. */
export function preferenceProgress(lists: readonly PreferenceList[]): { entered: number; total: number } {
  return {
    entered: lists.filter((list) => cleanNames([...list.ranked, ...list.vetoes]).length > 0).length,
    total: lists.length,
  };
}

/** The names left to call, in order and one per line, for pasting elsewhere. */
export function callListText(callList: readonly CallListEntry[]): string {
  return callList
    .filter((entry) => !entry.unavailable)
    .map((entry) => entry.name)
    .join('\n');
}

function activeJudgeSlots(contest: Contest): Adjudicator[] {
  return contest.adjudicators.slice(0, contest.details.numJudges);
}

/** The 1-based active slot holding this judge, or null if none does. */
export function judgeSlotNumber(contest: Contest, name: string): number | null {
  const key = normalizeJudgeName(name);
  if (!key) return null;
  const index = activeJudgeSlots(contest).findIndex((judge) => normalizeJudgeName(judge.name) === key);
  return index < 0 ? null : index + 1;
}

/** The index of the first blank active slot, or null when every active slot is full. */
export function firstOpenJudgeSlot(contest: Contest): number | null {
  const index = activeJudgeSlots(contest).findIndex((judge) => !normalizeJudgeName(judge.name));
  return index < 0 ? null : index;
}

/** Puts a judge in the first blank active slot. Blank, already in a slot, or no open slot ⇒ no-op. */
export function addAsJudge(contest: Contest, name: string, now?: string): Contest {
  const slot = firstOpenJudgeSlot(contest);
  if (slot === null || !normalizeJudgeName(name) || judgeSlotNumber(contest, name) !== null) return contest;
  return withAdjudicator(contest, slot, { name }, now);
}

/** Every name entered in this contest, once each: active lists first, then active judge slots. */
export function enteredJudgeNames(contest: Contest): string[] {
  return cleanNames([
    ...activePreferenceLists(contest).flatMap((list) => [...list.ranked, ...list.vetoes]),
    ...activeJudgeSlots(contest).map((judge) => judge.name),
  ]);
}

type Standing = Omit<CallListEntry, 'tied' | 'unavailable'>;

export function combinePreferenceLists(
  lists: readonly PreferenceList[],
  unavailable: readonly string[] = [],
): CombinedPreferences {
  const cleaned = lists.map((list) => ({
    list,
    ranked: cleanNames(list.ranked),
    vetoes: cleanNames(list.vetoes),
  }));
  const longest = Math.max(0, ...cleaned.map(({ ranked }) => ranked.length));

  const byJudge = new Map<string, Standing>();
  const byVeto = new Map<string, VetoedJudge>();
  const spellings = new Map<string, string>();
  const conflicts: PreferenceConflict[] = [];

  for (const { list, ranked, vetoes } of cleaned) {
    ranked.forEach((name, i) => {
      const key = normalizeJudgeName(name);
      if (!spellings.has(key)) spellings.set(key, name);
      const rank = i + 1;
      const points = longest + 1 - rank;
      const entry = byJudge.get(key);
      if (entry) {
        entry.points += points;
        entry.listCount += 1;
        entry.bestRank = Math.min(entry.bestRank, rank);
      } else {
        byJudge.set(key, { name: spellings.get(key) ?? name, points, listCount: 1, bestRank: rank });
      }
    });

    const rankedKeys = new Map(ranked.map((name) => [normalizeJudgeName(name), name]));
    for (const name of vetoes) {
      const key = normalizeJudgeName(name);
      if (!spellings.has(key)) spellings.set(key, name);
      const entry = byVeto.get(key);
      if (entry) entry.vetoedBy.push(list.label);
      else byVeto.set(key, { name: spellings.get(key) ?? name, vetoedBy: [list.label] });
      const rankedName = rankedKeys.get(key);
      if (rankedName !== undefined) conflicts.push({ listId: list.id, listLabel: list.label, name: rankedName });
    }
  }

  const callable = [...byJudge.entries()].filter(([key]) => !byVeto.has(key));

  const standing = (e: Standing) => `${e.points}|${e.listCount}|${e.bestRank}`;
  const standingCounts = new Map<string, number>();
  for (const [, entry] of callable) {
    standingCounts.set(standing(entry), (standingCounts.get(standing(entry)) ?? 0) + 1);
  }

  const callList = callable
    .sort(([keyA, a], [keyB, b]) => {
      if (a.points !== b.points) return b.points - a.points;
      if (a.listCount !== b.listCount) return b.listCount - a.listCount;
      if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank;
      return compareKeys(keyA, keyB);
    })
    .map(([key, entry]) => ({
      ...entry,
      tied: (standingCounts.get(standing(entry)) ?? 0) > 1,
      unavailable: unavailable.includes(key),
    }));

  const vetoed = [...byVeto.entries()]
    .sort(([keyA], [keyB]) => compareKeys(keyA, keyB))
    .map(([, entry]) => entry);

  return { callList, vetoed, conflicts };
}

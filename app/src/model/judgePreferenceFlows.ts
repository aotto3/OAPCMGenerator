/**
 * Judge preference flows (RFC #267, slice #269): the data rules behind pasting a list of
 * names, the "vetoed but in a slot" warning, and merging two spellings of one judge. Pure:
 * the contest (and, for paste, a roster) goes in, previews and the next contest come out.
 * The Judge Preferences section only renders these results and dispatches the contest.
 */
import {
  addRankedJudge,
  addVetoedJudge,
  normalizeJudgeName,
  type Contest,
  type PreferenceListRef,
} from './contest';
import {
  activePreferenceLists,
  combinePreferenceLists,
  enteredJudgeNames,
  judgeSlotNumber,
  parseJudgeList,
} from './judgePreferences';
import { matchPastedName, type RosterJudge } from './ttaoRoster';
import { TTAO_SNAPSHOT } from './ttaoRosterSnapshot';

/** Which names a paste adds to: one list's rankings or its vetoes. */
export interface PasteTarget {
  ref: PreferenceListRef;
  part: 'ranked' | 'vetoes';
}

export interface PastePreviewRow {
  /** The name as written in the pasted text (after list markers and spacing are tidied). */
  raw: string;
  /** The name this row adds: the CM's pick if they made one, otherwise the suggested match. */
  chosen: string;
  /** Roster judges this might be, for the CM to choose from. Empty when there is nothing to choose. */
  choices: RosterJudge[];
  /** The roster judge this name already is, ignoring case and spacing. */
  exact: RosterJudge | null;
  /** True when the chosen name is already on the target list, ignoring case and spacing. */
  duplicate: boolean;
  /** True when there are choices but the CM is using the name as written. */
  asWritten: boolean;
}

export interface PastePreview {
  rows: PastePreviewRow[];
  /** The names `applyPaste` adds, in order: each chosen name once, minus any already on the list. */
  toAdd: string[];
}

function sameList(a: PreferenceListRef, b: PreferenceListRef): boolean {
  if (a.kind === 'school' && b.kind === 'school') return a.index === b.index;
  if (a.kind === 'custom' && b.kind === 'custom') return a.id === b.id;
  return a.kind === b.kind;
}

function listNames(contest: Contest, target: PasteTarget): string[] {
  const list = activePreferenceLists(contest).find((l) => sameList(l.ref, target.ref));
  return list ? list[target.part] : [];
}

/**
 * Reads pasted text into one preview row per name. Each name is matched against the
 * roster and the names already in this contest; `chosen` holds the CM's picks keyed by
 * the row's `raw` name, and a pick overrides the suggested match.
 */
export function previewPaste(
  contest: Contest,
  target: PasteTarget,
  text: string,
  chosen: Readonly<Record<string, string>> = {},
  roster: readonly RosterJudge[] = TTAO_SNAPSHOT.judges,
): PastePreview {
  const entered = enteredJudgeNames(contest);
  const onList = new Set(listNames(contest, target).map(normalizeJudgeName));
  const rows = parseJudgeList(text).map((raw): PastePreviewRow => {
    const match = matchPastedName(raw, { roster, entered });
    const pick = chosen[raw] ?? match.suggested;
    return {
      raw,
      chosen: pick,
      choices: match.candidates,
      exact: match.exact,
      duplicate: onList.has(normalizeJudgeName(pick)),
      asWritten: match.candidates.length > 0 && pick === raw,
    };
  });
  const toAdd = [...new Set(rows.map((row) => row.chosen))].filter((name) => !onList.has(normalizeJudgeName(name)));
  return { rows, toAdd };
}

/** Adds a preview's names to the target list, in order. Nothing to add ⇒ the contest unchanged. */
export function applyPaste(contest: Contest, target: PasteTarget, preview: PastePreview, now?: string): Contest {
  const add = target.part === 'ranked' ? addRankedJudge : addVetoedJudge;
  return preview.toAdd.reduce((next, name) => add(next, target.ref, name, now), contest);
}

/** Vetoed judges who are in an active judge slot, in the Vetoed section's order. */
export function vetoedInSlots(contest: Contest): { name: string; slot: number }[] {
  const { vetoed } = combinePreferenceLists(activePreferenceLists(contest), contest.judgePreferences.unavailable);
  return vetoed.flatMap(({ name }) => {
    const slot = judgeSlotNumber(contest, name);
    return slot === null ? [] : [{ name, slot }];
  });
}

/** The names the CM can merge: everyone on the call list or in the Vetoed section, alphabetically. */
export function mergeCandidates(contest: Contest): string[] {
  const { callList, vetoed } = combinePreferenceLists(
    activePreferenceLists(contest),
    contest.judgePreferences.unavailable,
  );
  return [...callList, ...vetoed].map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
}

export interface MergeImpact {
  /** The kept name if it is still a merge candidate, otherwise blank. */
  keep: string;
  /** The merged name if it is still a candidate and differs from `keep`, otherwise blank. */
  merge: string;
  /** True when both names are set, so the merge can run. */
  valid: boolean;
  warnings: string[];
}

/**
 * What merging `merge` into `keep` would do, before it is done. A pick that is no longer
 * a candidate (the lists changed) reads as blank. Warns when the merged name holds a judge
 * slot, and when both names do.
 */
export function mergeImpact(contest: Contest, keepChoice: string, mergeChoice: string): MergeImpact {
  const candidates = mergeCandidates(contest);
  const keep = candidates.includes(keepChoice) ? keepChoice : '';
  const merge = candidates.includes(mergeChoice) && mergeChoice !== keep ? mergeChoice : '';
  const warnings: string[] = [];
  const mergeSlot = merge ? judgeSlotNumber(contest, merge) : null;
  if (keep && mergeSlot !== null) {
    const keepSlot = judgeSlotNumber(contest, keep);
    warnings.push(
      `${merge} is in the Judge ${mergeSlot} slot. Merging changes that slot to ${keep}, so generated documents will use that spelling.` +
        (keepSlot !== null ? ` ${keep} is also in the Judge ${keepSlot} slot, so you'll need to clear one of them.` : ''),
    );
  }
  return { keep, merge, valid: keep !== '' && merge !== '', warnings };
}

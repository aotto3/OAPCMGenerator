/**
 * Judge name suggestions (PRD #202). Pure: the roster and the names already entered go
 * in, ordered suggestions come out. The UI reaches the bundled TTAO snapshot only through
 * this shape, and the app never calls TTAO; scripts/refresh-ttao-roster.mjs regenerates
 * the snapshot by hand.
 */
import { normalizeJudgeName } from './contest';

export interface RosterJudge {
  name: string;
  city: string;
  /** Nearest ESC region, blank when TTAO lists none. */
  esc: string;
}

export interface RosterSnapshot {
  /** The day the snapshot was taken, as YYYY-MM-DD. */
  asOf: string;
  judges: RosterJudge[];
}

export interface SuggestionSources {
  roster: readonly RosterJudge[];
  /** Names already entered in this contest. These come first, in their entered spelling. */
  entered?: readonly string[];
  /** Names not worth offering, such as those already on the list being edited. */
  exclude?: readonly string[];
  limit?: number;
}

const DEFAULT_LIMIT = 8;

function compareNames(a: string, b: string): number {
  const keyA = normalizeJudgeName(a);
  const keyB = normalizeJudgeName(b);
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
}

/** Every typed word must start some word of the name, so "smi" finds "Jane Smith". */
export function suggestJudges(query: string, sources: SuggestionSources): RosterJudge[] {
  const { roster, entered = [], exclude = [], limit = DEFAULT_LIMIT } = sources;
  const typed = normalizeJudgeName(query);
  if (!typed) return [];
  const typedWords = typed.split(' ');
  const excluded = new Set(exclude.map(normalizeJudgeName));

  const matches = (name: string) => {
    const words = normalizeJudgeName(name).split(/[\s\-()]+/);
    return !excluded.has(normalizeJudgeName(name)) && typedWords.every((t) => words.some((w) => w.startsWith(t)));
  };
  const order = (a: RosterJudge, b: RosterJudge) => {
    const startsA = normalizeJudgeName(a.name).startsWith(typed) ? 0 : 1;
    const startsB = normalizeJudgeName(b.name).startsWith(typed) ? 0 : 1;
    return startsA - startsB || compareNames(a.name, b.name);
  };

  const enteredKeys = new Set<string>();
  const fromContest = entered.filter(matches).flatMap((name): RosterJudge[] => {
    const key = normalizeJudgeName(name);
    if (enteredKeys.has(key)) return [];
    enteredKeys.add(key);
    const onRoster = roster.filter((judge) => normalizeJudgeName(judge.name) === key);
    return onRoster.length > 0 ? onRoster.map((judge) => ({ ...judge, name })) : [{ name, city: '', esc: '' }];
  });
  const fromRoster = roster.filter(
    (judge) => matches(judge.name) && !enteredKeys.has(normalizeJudgeName(judge.name)),
  );

  return [...fromContest.sort(order), ...[...fromRoster].sort(order)].slice(0, limit);
}

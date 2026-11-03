import { describe, expect, it } from 'vitest';
import {
  CONTEST_SCHEMA_VERSION,
  addCustomPreferenceList,
  addRankedJudge,
  addVetoedJudge,
  advanceContest,
  createContest,
  defaultJudgePreferences,
  duplicateContest,
  moveRankedJudge,
  normalizeJudgeName,
  parseContest,
  removeCustomPreferenceList,
  removeRankedJudge,
  removeVetoedJudge,
  renameCustomPreferenceList,
  sectionCompletion,
  serializeContest,
  setAdvancing,
  setJudgeUnavailable,
  setNumSchools,
  withIdentity,
  withSchool,
  type Contest,
  type PreferenceListRef,
} from './contest';
import {
  activePreferenceLists,
  callListText,
  combinePreferenceLists,
  preferenceProgress,
  preferencesAvailable,
  type CallListEntry,
  type PreferenceList,
} from './judgePreferences';

const NOW = '2026-07-05T12:00:00.000Z';
const LATER = '2026-07-06T12:00:00.000Z';

function contest(): Contest {
  return createContest({ id: 'test-id', now: NOW });
}

const school = (index: number): PreferenceListRef => ({ kind: 'school', index });
const FIRST: PreferenceListRef = { kind: 'firstDistrict' };
const SECOND: PreferenceListRef = { kind: 'secondDistrict' };

function biDistrict(district = '19', districtSecond = '20'): Contest {
  return withIdentity(contest(), { contestLevel: 'BiDistrict', district, districtSecond });
}

/** Adds a custom list and returns the contest with a ref to the new list. */
function withCustom(c: Contest, name: string): { contest: Contest; ref: PreferenceListRef; id: string } {
  const next = addCustomPreferenceList(c, name);
  const { id } = next.judgePreferences.customLists[next.judgePreferences.customLists.length - 1];
  return { contest: next, ref: { kind: 'custom', id }, id };
}

function lists(...ranked: string[][]): PreferenceList[] {
  return ranked.map((r, i) => ({ id: `list-${i}`, label: `List ${i + 1}`, ranked: r, vetoes: [] }));
}

/** A list with both rankings and vetoes, labeled by its own name. */
function list(label: string, ranked: string[], vetoes: string[] = []): PreferenceList {
  return { id: label, label, ranked, vetoes };
}

const callList = (l: PreferenceList[]) => combinePreferenceLists(l).callList;

const names = (entries: CallListEntry[]) => entries.map((e) => e.name);

describe('normalizeJudgeName', () => {
  it('ignores case, surrounding space, and repeated inner space', () => {
    expect(normalizeJudgeName('  Jane   SMITH ')).toBe('jane smith');
  });
});

describe('combinePreferenceLists: points', () => {
  it('returns an empty call list when there are no lists or only empty ones', () => {
    expect(callList([])).toEqual([]);
    expect(callList(lists([], []))).toEqual([]);
  });

  it('gives rank r on a longest list of N a score of N + 1 - r', () => {
    const result = callList(lists(['A', 'B', 'C']));
    expect(result.map((e) => [e.name, e.points])).toEqual([
      ['A', 3],
      ['B', 2],
      ['C', 1],
    ]);
  });

  it('uses the longest list for N, so a short list scores on the same scale', () => {
    const result = callList(lists(['A', 'B', 'C', 'D', 'E'], ['F']));
    expect(result.find((e) => e.name === 'A')?.points).toBe(5);
    expect(result.find((e) => e.name === 'F')?.points).toBe(5);
    expect(result.find((e) => e.name === 'E')?.points).toBe(1);
  });

  it('adds points across lists, so broad support beats one first place', () => {
    const result = callList(lists(['Solo', 'Broad', 'X'], ['Y', 'Broad', 'Z'], ['W', 'Broad', 'V']));
    expect(result[0]).toMatchObject({ name: 'Broad', points: 6, listCount: 3, bestRank: 2 });
  });

  it('does not let empty lists change the scale', () => {
    const withEmpty = callList(lists(['A', 'B'], []));
    expect(withEmpty.map((e) => e.points)).toEqual([2, 1]);
  });
});

describe('combinePreferenceLists: name matching', () => {
  it('combines names differing only by case or spacing into one judge', () => {
    const result = callList(lists(['Jane Smith'], ['  jane   smith ']));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ points: 2, listCount: 2 });
  });

  it('displays the first spelling encountered, in list order', () => {
    expect(names(callList(lists(['Jane Smith'], ['jane smith'])))).toEqual(['Jane Smith']);
    expect(names(callList(lists(['jane smith'], ['Jane Smith'])))).toEqual(['jane smith']);
  });

  it('ignores blank names, which also do not count toward N', () => {
    const result = callList(lists(['A', '  ', 'B']));
    expect(result.map((e) => [e.name, e.points])).toEqual([
      ['A', 2],
      ['B', 1],
    ]);
  });

  it('counts a judge named twice on one list once, at the better rank', () => {
    const result = callList(lists(['A', 'B', 'a']));
    expect(result.map((e) => [e.name, e.points, e.listCount, e.bestRank])).toEqual([
      ['A', 2, 1, 1],
      ['B', 1, 1, 2],
    ]);
  });
});

describe('combinePreferenceLists: ordering and ties', () => {
  it('sorts by points first', () => {
    expect(names(callList(lists(['A', 'B'], ['A', 'C'])))).toEqual(['A', 'B', 'C']);
  });

  it('breaks equal points by most lists naming the judge', () => {
    // N = 3. Both score 3: One is 1st on one list, Two is 3rd on three lists.
    const result = callList(
      lists(['One', 'P', 'Two'], ['Q', 'R', 'Two'], ['S', 'T', 'Two']),
    );
    const one = result.findIndex((e) => e.name === 'One');
    const two = result.findIndex((e) => e.name === 'Two');
    expect(result[one].points).toBe(result[two].points);
    expect(two).toBeLessThan(one);
    expect(result[two].tied).toBe(false);
  });

  it('breaks equal points and list counts by best single rank', () => {
    // N = 4. Both score 5 on two lists: Best earns 4 + 1, Even earns 3 + 2.
    const result = callList(
      lists(['Best', 'Even', 'P', 'Q'], ['R', 'S', 'Even', 'Best']),
    );
    const best = result.find((e) => e.name === 'Best')!;
    const even = result.find((e) => e.name === 'Even')!;
    expect([best.points, best.listCount]).toEqual([even.points, even.listCount]);
    expect(result.indexOf(best)).toBeLessThan(result.indexOf(even));
    expect(best.tied).toBe(false);
    expect(even.tied).toBe(false);
  });

  it('lists remaining ties alphabetically and flags them as tied', () => {
    const result = callList(lists(['Zed'], ['amy'], ['Moe', 'Other']));
    expect(names(result)).toEqual(['amy', 'Moe', 'Zed', 'Other']);
    expect(result.map((e) => e.tied)).toEqual([true, true, true, false]);
  });

  it('gives the same order whichever way the lists are arranged', () => {
    const a = ['A', 'B', 'C'];
    const b = ['C', 'D'];
    const c = ['E', 'A'];
    expect(names(callList(lists(a, b, c)))).toEqual(names(callList(lists(c, b, a))));
  });
});

describe('combinePreferenceLists: vetoes', () => {
  it('removes a vetoed judge from the call list, even a top scorer', () => {
    const result = combinePreferenceLists([
      list('A', ['Top', 'Other']),
      list('B', ['Top', 'Other']),
      list('C', [], ['Top']),
    ]);
    expect(names(result.callList)).toEqual(['Other']);
    expect(result.vetoed).toEqual([{ name: 'Top', vetoedBy: ['C'] }]);
  });

  it('lists every list that vetoed a judge, in list order', () => {
    const { vetoed } = combinePreferenceLists([list('A', [], ['Jane Smith']), list('B', ['X']), list('C', [], ['jane  smith'])]);
    expect(vetoed).toEqual([{ name: 'Jane Smith', vetoedBy: ['A', 'C'] }]);
  });

  it('sorts the Vetoed section alphabetically', () => {
    const { vetoed } = combinePreferenceLists([list('A', [], ['Zed', 'amy', 'Moe'])]);
    expect(vetoed.map((v) => v.name)).toEqual(['amy', 'Moe', 'Zed']);
  });

  it('includes a vetoed judge nobody ranked', () => {
    const { callList: rows, vetoed } = combinePreferenceLists([list('A', [], ['Nobody Ranked'])]);
    expect(rows).toEqual([]);
    expect(vetoed).toEqual([{ name: 'Nobody Ranked', vetoedBy: ['A'] }]);
  });

  it('matches veto names with the same normalization as rankings', () => {
    const { callList: rows } = combinePreferenceLists([list('A', ['Jane Smith', 'B']), list('C', [], ['  JANE   smith '])]);
    expect(names(rows)).toEqual(['B']);
  });

  it('ignores blank vetoes and counts a repeated veto once', () => {
    const { vetoed } = combinePreferenceLists([list('A', [], ['  ', 'Dup', 'dup'])]);
    expect(vetoed).toEqual([{ name: 'Dup', vetoedBy: ['A'] }]);
  });

  it('computes N before vetoes, so a veto does not change other points', () => {
    const ranked = ['Vetoed', 'Second', 'Third'];
    const without = combinePreferenceLists([list('A', ranked)]).callList;
    const withVeto = combinePreferenceLists([list('A', ranked), list('B', [], ['Vetoed'])]).callList;
    expect(withVeto.map((e) => [e.name, e.points])).toEqual([
      ['Second', 2],
      ['Third', 1],
    ]);
    expect(without.find((e) => e.name === 'Second')?.points).toBe(2);
  });

  it('does not count a vetoed judge as a tie partner', () => {
    const { callList: rows } = combinePreferenceLists([list('A', ['Kept']), list('B', ['Gone']), list('C', [], ['Gone'])]);
    expect(rows).toEqual([expect.objectContaining({ name: 'Kept', tied: false })]);
  });

  it('flags a list that ranks and vetoes one judge, and the veto wins', () => {
    const result = combinePreferenceLists([list('A', ['Both', 'Fine'], ['both']), list('B', ['Other'], ['Fine'])]);
    expect(result.conflicts).toEqual([{ listId: 'A', listLabel: 'A', name: 'Both' }]);
    expect(names(result.callList)).toEqual(['Other']);
    expect(result.vetoed.map((v) => v.name)).toEqual(['Both', 'Fine']);
  });

  it('returns empty parts for no lists', () => {
    expect(combinePreferenceLists([])).toEqual({ callList: [], vetoed: [], conflicts: [] });
  });
});

describe('preferencesAvailable', () => {
  it('is on for Zone, District, and BiDistrict and off where the state picks judges', () => {
    expect(preferencesAvailable('Zone')).toBe(true);
    expect(preferencesAvailable('District')).toBe(true);
    expect(preferencesAvailable('BiDistrict')).toBe(true);
    expect(preferencesAvailable('Area')).toBe(false);
    expect(preferencesAvailable('Region')).toBe(false);
  });
});

describe('activePreferenceLists', () => {
  it('gives one list per school at Zone and District', () => {
    const c = withSchool(setNumSchools(contest(), 3), 0, { name: 'Westlake HS' });
    expect(activePreferenceLists(c).map((l) => l.label)).toEqual(['Westlake HS', 'School 2', 'School 3']);
    const zone = withIdentity(c, { contestLevel: 'Zone' });
    expect(activePreferenceLists(zone)).toHaveLength(3);
  });

  it('gives no lists at Area and Region', () => {
    expect(activePreferenceLists(withIdentity(contest(), { contestLevel: 'Area' }))).toEqual([]);
    expect(activePreferenceLists(withIdentity(contest(), { contestLevel: 'Region' }))).toEqual([]);
  });

  it('keeps stored rankings across a level switch and back', () => {
    const c = addRankedJudge(contest(), school(0), 'Jane Smith');
    const away = withIdentity(c, { contestLevel: 'Area' });
    expect(activePreferenceLists(away)).toEqual([]);
    const back = withIdentity(away, { contestLevel: 'District' });
    expect(activePreferenceLists(back)[0].ranked).toEqual(['Jane Smith']);
  });

  it('carries a list through a school rename', () => {
    const c = withSchool(addRankedJudge(contest(), school(0), 'Jane Smith'), 0, { name: 'Renamed HS' });
    expect(activePreferenceLists(c)[0]).toMatchObject({ label: 'Renamed HS', ranked: ['Jane Smith'] });
  });

  it('drops a removed school\'s list from the combined order', () => {
    let c = setNumSchools(contest(), 4);
    c = addRankedJudge(c, school(0), 'Stays');
    c = addRankedJudge(c, school(3), 'Goes');
    expect(names(callList(activePreferenceLists(c)))).toContain('Goes');
    const fewer = setNumSchools(c, 3);
    expect(names(callList(activePreferenceLists(fewer)))).toEqual(['Stays']);
  });
});

describe('activePreferenceLists: BiDistrict', () => {
  it('gives the two district lists, labeled from Identity, in place of school lists', () => {
    expect(activePreferenceLists(biDistrict()).map((l) => l.label)).toEqual(['District 19', 'District 20']);
  });

  it('falls back to a sensible label when a district number is blank', () => {
    expect(activePreferenceLists(biDistrict('', '')).map((l) => l.label)).toEqual([
      'First district',
      'Second district',
    ]);
    expect(activePreferenceLists(biDistrict('19', '  ')).map((l) => l.label)).toEqual([
      'District 19',
      'Second district',
    ]);
  });

  it('keeps school lists stored but out of the call list', () => {
    let c = addRankedJudge(contest(), school(0), 'School Pick');
    c = withIdentity(c, { contestLevel: 'BiDistrict' });
    c = addRankedJudge(c, FIRST, 'District Pick');
    expect(names(callList(activePreferenceLists(c)))).toEqual(['District Pick']);
    expect(c.schools[0].judgePreferences.ranked).toEqual(['School Pick']);
  });

  it('feeds both district lists to the calculator and the progress count', () => {
    let c = addRankedJudge(biDistrict(), FIRST, 'Jane Smith');
    c = addRankedJudge(c, SECOND, 'jane smith');
    c = addVetoedJudge(c, SECOND, 'Sam Jones');
    const active = activePreferenceLists(c);
    const combined = combinePreferenceLists(active);
    expect(combined.callList).toEqual([expect.objectContaining({ name: 'Jane Smith', points: 2, listCount: 2 })]);
    expect(combined.vetoed).toEqual([{ name: 'Sam Jones', vetoedBy: ['District 20'] }]);
    expect(preferenceProgress(active)).toEqual({ entered: 2, total: 2 });
  });
});

describe('activePreferenceLists: other levels', () => {
  it('does not use district lists at Zone or District', () => {
    const c = addRankedJudge(contest(), FIRST, 'District Pick');
    for (const contestLevel of ['Zone', 'District'] as const) {
      const active = activePreferenceLists(withIdentity(c, { contestLevel, district: '19' }));
      expect(active.map((l) => l.ref.kind).every((kind) => kind === 'school')).toBe(true);
      expect(names(callList(active))).toEqual([]);
    }
  });

  it('keeps every list across a level round trip', () => {
    let c = addRankedJudge(contest(), school(0), 'School Pick');
    c = addRankedJudge(c, FIRST, 'District Pick');
    const { contest: withList, ref } = withCustom(c, 'Committee');
    const stored = addRankedJudge(withList, ref, 'Custom Pick');

    const area = withIdentity(stored, { contestLevel: 'Area' });
    expect(activePreferenceLists(area)).toEqual([]);

    const bi = withIdentity(area, { contestLevel: 'BiDistrict' });
    expect(names(callList(activePreferenceLists(bi))).sort()).toEqual(['Custom Pick', 'District Pick']);

    const district = withIdentity(bi, { contestLevel: 'District' });
    expect(names(callList(activePreferenceLists(district))).sort()).toEqual(['Custom Pick', 'School Pick']);
  });
});

describe('custom preference lists', () => {
  it('adds a tidied named list after the school lists, at each active level', () => {
    const { contest: c } = withCustom(contest(), '  District   committee ');
    expect(c.judgePreferences.customLists[0]).toMatchObject({ name: 'District committee', ranked: [], vetoes: [] });
    expect(activePreferenceLists(c).map((l) => l.label).slice(-1)).toEqual(['District committee']);

    for (const contestLevel of ['Zone', 'District', 'BiDistrict'] as const) {
      const active = activePreferenceLists(withIdentity(c, { contestLevel }));
      expect(active[active.length - 1].label).toBe('District committee');
    }
  });

  it('gives each list its own stable id, kept through a rename', () => {
    const first = withCustom(contest(), 'One');
    const second = withCustom(first.contest, 'Two');
    expect(second.id).not.toBe(first.id);
    const renamed = renameCustomPreferenceList(second.contest, first.id, 'Uno');
    expect(renamed.judgePreferences.customLists.map((l) => [l.id, l.name])).toEqual([
      [first.id, 'Uno'],
      [second.id, 'Two'],
    ]);
  });

  it('ignores adding a blank name', () => {
    const c = contest();
    expect(addCustomPreferenceList(c, '   ')).toBe(c);
  });

  it('renames a list and bumps updatedAt; an unknown id or the same name is a no-op', () => {
    const { contest: c, id } = withCustom(contest(), 'Committee');
    const renamed = renameCustomPreferenceList(c, id, 'Board', LATER);
    expect(renamed.judgePreferences.customLists[0].name).toBe('Board');
    expect(renamed.updatedAt).toBe(LATER);
    expect(renameCustomPreferenceList(c, 'nope', 'Board')).toBe(c);
    expect(renameCustomPreferenceList(c, id, 'Committee')).toBe(c);
  });

  it('labels a list whose name was cleared by its position, keeping its data', () => {
    const { contest: c, ref, id } = withCustom(contest(), 'Committee');
    const cleared = renameCustomPreferenceList(addRankedJudge(c, ref, 'Jane Smith'), id, '  ');
    const active = activePreferenceLists(cleared);
    expect(active[active.length - 1]).toMatchObject({ label: 'Custom list 1', ranked: ['Jane Smith'] });
  });

  it('removes a list, taking its names out of the call list; an unknown id is a no-op', () => {
    const { contest: c, ref, id } = withCustom(contest(), 'Committee');
    const stored = addRankedJudge(c, ref, 'Jane Smith');
    expect(names(callList(activePreferenceLists(stored)))).toEqual(['Jane Smith']);
    const removed = removeCustomPreferenceList(stored, id, LATER);
    expect(removed.judgePreferences.customLists).toEqual([]);
    expect(names(callList(activePreferenceLists(removed)))).toEqual([]);
    expect(removed.updatedAt).toBe(LATER);
    expect(removeCustomPreferenceList(stored, 'nope')).toBe(stored);
  });

  it('feeds the calculator and the progress count like any other list', () => {
    const { contest: c, ref } = withCustom(contest(), 'Committee');
    const stored = addVetoedJudge(addRankedJudge(addRankedJudge(c, school(0), 'Vetoed Judge'), ref, 'Kept'), ref, 'Vetoed Judge');
    const active = activePreferenceLists(stored);
    const combined = combinePreferenceLists(active);
    expect(names(combined.callList)).toEqual(['Kept']);
    expect(combined.vetoed).toEqual([{ name: 'Vetoed Judge', vetoedBy: ['Committee'] }]);
    expect(preferenceProgress(active)).toEqual({ entered: 2, total: stored.schools.length + 1 });
  });
});

describe('list updaters work on any list', () => {
  it('edits rankings and vetoes on a district list, leaving the others alone', () => {
    let c = addRankedJudge(biDistrict(), FIRST, 'A', LATER);
    c = addRankedJudge(c, FIRST, 'B');
    c = moveRankedJudge(c, FIRST, 1, -1);
    c = addVetoedJudge(c, SECOND, 'V');
    expect(c.judgePreferences.firstDistrict).toEqual({ ranked: ['B', 'A'], vetoes: [] });
    expect(c.judgePreferences.secondDistrict).toEqual({ ranked: [], vetoes: ['V'] });
    expect(c.schools.every((s) => s.judgePreferences.ranked.length === 0)).toBe(true);
    c = removeRankedJudge(c, FIRST, 0);
    c = removeVetoedJudge(c, SECOND, 0);
    expect(c.judgePreferences.firstDistrict.ranked).toEqual(['A']);
    expect(c.judgePreferences.secondDistrict.vetoes).toEqual([]);
  });

  it('edits rankings and vetoes on a custom list', () => {
    const { contest: base, ref } = withCustom(contest(), 'Committee');
    let c = addRankedJudge(addRankedJudge(base, ref, 'A'), ref, 'B');
    c = moveRankedJudge(c, ref, 0, 1);
    c = addVetoedJudge(c, ref, 'V');
    expect(c.judgePreferences.customLists[0]).toMatchObject({ name: 'Committee', ranked: ['B', 'A'], vetoes: ['V'] });
  });

  it('treats an unknown custom list as a no-op', () => {
    const c = contest();
    const ghost: PreferenceListRef = { kind: 'custom', id: 'nope' };
    expect(addRankedJudge(c, ghost, 'A')).toBe(c);
    expect(addVetoedJudge(c, ghost, 'A')).toBe(c);
    expect(moveRankedJudge(c, ghost, 0, 1)).toBe(c);
    expect(removeRankedJudge(c, ghost, 0)).toBe(c);
    expect(removeVetoedJudge(c, ghost, 0)).toBe(c);
  });
});

describe('setJudgeUnavailable', () => {
  it('stores the mark by normalized name and bumps updatedAt', () => {
    const c = setJudgeUnavailable(contest(), '  Jane   SMITH ', true, LATER);
    expect(c.judgePreferences.unavailable).toEqual(['jane smith']);
    expect(c.updatedAt).toBe(LATER);
  });

  it('clears the mark whatever the spelling', () => {
    const c = setJudgeUnavailable(contest(), 'Jane Smith', true);
    expect(setJudgeUnavailable(c, 'jane  smith', false).judgePreferences.unavailable).toEqual([]);
  });

  it('is a no-op for a blank name or a mark already in that state', () => {
    const c = setJudgeUnavailable(contest(), 'Jane Smith', true);
    expect(setJudgeUnavailable(c, '   ', true)).toBe(c);
    expect(setJudgeUnavailable(c, 'JANE SMITH', true)).toBe(c);
    expect(setJudgeUnavailable(c, 'Nobody', false)).toBe(c);
  });
});

describe('combinePreferenceLists: Unavailable', () => {
  const ranked = [list('A', ['First', 'Second', 'Third'])];

  it('flags a marked judge and keeps every position and point', () => {
    const plain = combinePreferenceLists(ranked).callList;
    const marked = combinePreferenceLists(ranked, ['second']).callList;
    expect(marked.map((e) => [e.name, e.points, e.unavailable])).toEqual([
      ['First', 3, false],
      ['Second', 2, true],
      ['Third', 1, false],
    ]);
    expect(names(marked)).toEqual(names(plain));
  });

  it('defaults to no marks', () => {
    expect(combinePreferenceLists(ranked).callList.every((e) => !e.unavailable)).toBe(true);
  });

  it('keeps a marked judge in a tie', () => {
    const { callList: rows } = combinePreferenceLists([list('A', ['Amy']), list('B', ['Zed'])], ['amy']);
    expect(rows.map((e) => [e.name, e.tied])).toEqual([
      ['Amy', true],
      ['Zed', true],
    ]);
  });

  it('keeps the mark with the judge when list edits change the order', () => {
    let c = addRankedJudge(addRankedJudge(contest(), school(0), 'A'), school(0), 'B');
    c = setJudgeUnavailable(c, 'B', true);
    c = moveRankedJudge(c, school(0), 1, -1);
    const rows = combinePreferenceLists(activePreferenceLists(c), c.judgePreferences.unavailable).callList;
    expect(rows.map((e) => [e.name, e.unavailable])).toEqual([
      ['B', true],
      ['A', false],
    ]);
  });

  it('keeps the mark when a judge leaves every list and comes back', () => {
    let c = setJudgeUnavailable(addRankedJudge(contest(), school(0), 'Jane Smith'), 'Jane Smith', true);
    c = removeRankedJudge(c, school(0), 0);
    c = addRankedJudge(c, school(1), 'jane smith');
    const rows = combinePreferenceLists(activePreferenceLists(c), c.judgePreferences.unavailable).callList;
    expect(rows[0]).toMatchObject({ name: 'jane smith', unavailable: true });
  });
});

describe('callListText', () => {
  it('gives names in call order, one per line, with no points', () => {
    const rows = combinePreferenceLists([list('A', ['First', 'Second'])]).callList;
    expect(callListText(rows)).toBe('First\nSecond');
  });

  it('leaves out vetoed and Unavailable judges', () => {
    const rows = combinePreferenceLists(
      [list('A', ['Keep', 'Busy', 'Gone', 'Also Keep']), list('B', [], ['Gone'])],
      ['busy'],
    ).callList;
    expect(callListText(rows)).toBe('Keep\nAlso Keep');
  });

  it('is empty when nobody is left to call', () => {
    expect(callListText([])).toBe('');
    expect(callListText(combinePreferenceLists([list('A', ['Busy'])], ['busy']).callList)).toBe('');
  });
});

describe('preferenceProgress', () => {
  it('counts lists with at least one name out of all lists', () => {
    expect(preferenceProgress(lists(['A'], [], ['B'], ['  ']))).toEqual({ entered: 2, total: 4 });
    expect(preferenceProgress([])).toEqual({ entered: 0, total: 0 });
  });

  it('counts a list with only vetoes as entered', () => {
    expect(preferenceProgress([list('A', [], ['Vetoed']), list('B', [])])).toEqual({ entered: 1, total: 2 });
  });
});

describe('ranked-judge updaters', () => {
  it('adds a tidied name to the end of a school list and bumps updatedAt', () => {
    const c = addRankedJudge(addRankedJudge(contest(), school(1), 'First', LATER), school(1), '  Second   Name ', LATER);
    expect(c.schools[1].judgePreferences.ranked).toEqual(['First', 'Second Name']);
    expect(c.schools[0].judgePreferences.ranked).toEqual([]);
    expect(c.updatedAt).toBe(LATER);
  });

  it('ignores blank names, duplicates on that list, and bad indexes', () => {
    const c = addRankedJudge(contest(), school(0), 'Jane Smith');
    expect(addRankedJudge(c, school(0), '   ')).toBe(c);
    expect(addRankedJudge(c, school(0), 'jane  smith')).toBe(c);
    expect(addRankedJudge(c, school(99), 'New')).toBe(c);
    // The same judge on a different school's list is fine.
    expect(addRankedJudge(c, school(1), 'Jane Smith').schools[1].judgePreferences.ranked).toEqual(['Jane Smith']);
  });

  it('moves a name one place and ignores moves off either end', () => {
    let c = addRankedJudge(contest(), school(0), 'A');
    c = addRankedJudge(c, school(0), 'B');
    expect(moveRankedJudge(c, school(0), 1, -1, LATER).schools[0].judgePreferences.ranked).toEqual(['B', 'A']);
    expect(moveRankedJudge(c, school(0), 0, -1)).toBe(c);
    expect(moveRankedJudge(c, school(0), 1, 1)).toBe(c);
  });

  it('removes a name and ignores a bad index', () => {
    let c = addRankedJudge(contest(), school(0), 'A');
    c = addRankedJudge(c, school(0), 'B');
    expect(removeRankedJudge(c, school(0), 0, LATER).schools[0].judgePreferences.ranked).toEqual(['B']);
    expect(removeRankedJudge(c, school(0), 5)).toBe(c);
  });

  it('never shares list arrays with the source contest', () => {
    const c = addRankedJudge(contest(), school(0), 'A');
    const next = addRankedJudge(c, school(0), 'B');
    expect(c.schools[0].judgePreferences.ranked).toEqual(['A']);
    expect(next.schools[0].judgePreferences.ranked).toEqual(['A', 'B']);
  });
});

describe('persistence and clearing', () => {
  function withPreferences(): Contest {
    let c = withSchool(contest(), 0, { name: 'Westlake HS' });
    c = withSchool(c, 1, { name: 'Anderson HS' });
    c = addRankedJudge(c, school(0), 'Jane Smith');
    return addRankedJudge(c, school(1), 'Sam Jones');
  }

  it('starts blank on a new contest', () => {
    const c = contest();
    expect(c.judgePreferences).toEqual(defaultJudgePreferences());
    expect(c.schools[0].judgePreferences).toEqual({ ranked: [], vetoes: [] });
  });

  it('round-trips through serialize and parse', () => {
    const parsed = parseContest(serializeContest(withPreferences()));
    expect(parsed.schools[0].judgePreferences.ranked).toEqual(['Jane Smith']);
    expect(parsed.judgePreferences).toEqual(defaultJudgePreferences());
  });

  it('migrates a v13 contest to empty preferences, keeping its data', () => {
    const { judgePreferences: _top, speechwire: _dev, ...rest } = withSchool(contest(), 0, { name: 'Westlake HS' });
    const v13Contest = {
      ...rest,
      schools: rest.schools.map(({ judgePreferences: _school, ...s }) => s),
    };
    const migrated = parseContest(JSON.stringify({ schemaVersion: 13, contest: v13Contest }));
    expect(migrated.judgePreferences).toEqual(defaultJudgePreferences());
    expect(migrated.schools.every((s) => s.judgePreferences.ranked.length === 0)).toBe(true);
    expect(migrated.schools[0].name).toBe('Westlake HS');
    expect(JSON.parse(serializeContest(migrated)).schemaVersion).toBe(CONTEST_SCHEMA_VERSION);
    expect(callList(activePreferenceLists(migrated))).toEqual([]);
  });

  it('clears on roll-forward, leaving the source untouched', () => {
    const source = withPreferences();
    const next = duplicateContest(source);
    expect(next.schools.map((s) => s.judgePreferences.ranked)).toEqual(next.schools.map(() => []));
    expect(next.judgePreferences).toEqual(defaultJudgePreferences());
    expect(source.schools[0].judgePreferences.ranked).toEqual(['Jane Smith']);
  });

  it('clears on advance, even for schools that carry up', () => {
    const next = advanceContest(setAdvancing(withPreferences(), [0, 1]))!;
    expect(next.schools.map((s) => s.name)).toEqual(['Westlake HS', 'Anderson HS']);
    expect(next.schools.map((s) => s.judgePreferences.ranked)).toEqual([[], []]);
    expect(next.judgePreferences).toEqual(defaultJudgePreferences());
  });

  it('round-trips district and custom lists, and clears them on roll-forward and advance', () => {
    const { contest: base, ref } = withCustom(withPreferences(), 'Committee');
    let c = addRankedJudge(base, ref, 'Custom Pick');
    c = addRankedJudge(c, FIRST, 'First Pick');
    c = addVetoedJudge(c, SECOND, 'Second Veto');

    const parsed = parseContest(serializeContest(c));
    expect(parsed.judgePreferences).toEqual(c.judgePreferences);

    expect(duplicateContest(c).judgePreferences).toEqual(defaultJudgePreferences());
    expect(advanceContest(setAdvancing(c, [0, 1]))!.judgePreferences).toEqual(defaultJudgePreferences());
    expect(c.judgePreferences.customLists[0].ranked).toEqual(['Custom Pick']);
  });

  it('round-trips Unavailable marks and clears them on roll-forward and advance', () => {
    const c = setJudgeUnavailable(withPreferences(), 'Jane Smith', true);
    expect(parseContest(serializeContest(c)).judgePreferences.unavailable).toEqual(['jane smith']);
    expect(duplicateContest(c).judgePreferences.unavailable).toEqual([]);
    expect(advanceContest(setAdvancing(c, [0, 1]))!.judgePreferences.unavailable).toEqual([]);
  });

  it('does not count toward section completion', () => {
    const before = sectionCompletion(contest());
    expect(sectionCompletion(addRankedJudge(contest(), school(0), 'Jane Smith'))).toEqual(before);
  });
});

describe('veto updaters', () => {
  it('adds a tidied veto without touching rankings, and bumps updatedAt', () => {
    const c = addVetoedJudge(addRankedJudge(contest(), school(0), 'Ranked'), school(0), '  Jane   Smith ', LATER);
    expect(c.schools[0].judgePreferences).toEqual({ ranked: ['Ranked'], vetoes: ['Jane Smith'] });
    expect(c.updatedAt).toBe(LATER);
  });

  it('ignores blank names, duplicate vetoes on that list, and bad indexes', () => {
    const c = addVetoedJudge(contest(), school(0), 'Jane Smith');
    expect(addVetoedJudge(c, school(0), '   ')).toBe(c);
    expect(addVetoedJudge(c, school(0), 'jane  smith')).toBe(c);
    expect(addVetoedJudge(c, school(99), 'New')).toBe(c);
  });

  it('allows vetoing a judge the same list ranks, so the conflict can be flagged', () => {
    const c = addVetoedJudge(addRankedJudge(contest(), school(0), 'Jane Smith'), school(0), 'Jane Smith');
    expect(c.schools[0].judgePreferences).toEqual({ ranked: ['Jane Smith'], vetoes: ['Jane Smith'] });
  });

  it('removes a veto and ignores a bad index', () => {
    let c = addVetoedJudge(contest(), school(0), 'A');
    c = addVetoedJudge(c, school(0), 'B');
    expect(removeVetoedJudge(c, school(0), 0, LATER).schools[0].judgePreferences.vetoes).toEqual(['B']);
    expect(removeVetoedJudge(c, school(0), 5)).toBe(c);
  });

  it('feeds the school list through to the calculator', () => {
    let c = addRankedJudge(contest(), school(0), 'Jane Smith');
    c = addVetoedJudge(c, school(1), 'Jane Smith');
    const result = combinePreferenceLists(activePreferenceLists(c));
    expect(result.callList).toEqual([]);
    expect(result.vetoed).toEqual([{ name: 'Jane Smith', vetoedBy: ['School 2'] }]);
  });

  it('round-trips vetoes and clears them on roll-forward and advance', () => {
    let c = withSchool(contest(), 0, { name: 'Westlake HS' });
    c = withSchool(c, 1, { name: 'Anderson HS' });
    c = addVetoedJudge(c, school(0), 'Jane Smith');
    expect(parseContest(serializeContest(c)).schools[0].judgePreferences.vetoes).toEqual(['Jane Smith']);
    expect(duplicateContest(c).schools[0].judgePreferences.vetoes).toEqual([]);
    expect(advanceContest(setAdvancing(c, [0, 1]))!.schools[0].judgePreferences.vetoes).toEqual([]);
  });
});

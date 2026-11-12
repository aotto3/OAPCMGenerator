import { describe, expect, it } from 'vitest';
import {
  addCustomPreferenceList,
  addRankedJudge,
  addVetoedJudge,
  createContest,
  type Contest,
  type PreferenceListRef,
} from './contest';
import { setJudge } from './judgePanel';
import {
  applyPaste,
  mergeCandidates,
  mergeImpact,
  previewPaste,
  vetoedInSlots,
  type PasteTarget,
} from './judgePreferenceFlows';
import type { RosterJudge } from './ttaoRoster';

const NOW = '2026-07-05T12:00:00.000Z';
const LATER = '2026-07-06T12:00:00.000Z';

const contest = (): Contest => createContest({ id: 'test-id', now: NOW });
const school = (index: number): PreferenceListRef => ({ kind: 'school', index });
const ranked = (ref: PreferenceListRef): PasteTarget => ({ ref, part: 'ranked' });
const vetoes = (ref: PreferenceListRef): PasteTarget => ({ ref, part: 'vetoes' });

const ROSTER: RosterJudge[] = [
  { name: 'Jane Smith', city: 'Austin', esc: '13' },
  { name: 'Robert Scott Allen', city: 'Tyler', esc: '7' },
  { name: 'Sam Jones', city: 'Waco', esc: '12' },
  { name: 'Sam Jordan', city: 'Bryan', esc: '6' },
];

const paste = (c: Contest, target: PasteTarget, text: string, chosen: Record<string, string> = {}) =>
  previewPaste(c, target, text, chosen, ROSTER);

describe('previewPaste', () => {
  it('gives one row per pasted name, in order, with list markers dropped', () => {
    const { rows } = paste(contest(), ranked(school(0)), '1. Jane Smith\n2) Pat Newcomer\n');
    expect(rows.map((r) => r.raw)).toEqual(['Jane Smith', 'Pat Newcomer']);
  });

  it('marks a name already on the list as a duplicate, ignoring case and spacing, and leaves it out', () => {
    const c = addRankedJudge(contest(), school(0), 'Jane Smith');
    const preview = paste(c, ranked(school(0)), 'jane   SMITH\nPat Newcomer');
    expect(preview.rows.map((r) => [r.raw, r.duplicate])).toEqual([
      ['jane SMITH', true],
      ['Pat Newcomer', false],
    ]);
    expect(preview.toAdd).toEqual(['Pat Newcomer']);
  });

  it('checks duplicates against the target part only: a vetoed name can still be ranked', () => {
    const c = addVetoedJudge(contest(), school(0), 'Jane Smith');
    expect(paste(c, ranked(school(0)), 'Jane Smith').toAdd).toEqual(['Jane Smith']);
    expect(paste(c, vetoes(school(0)), 'Jane Smith').toAdd).toEqual([]);
  });

  it('checks duplicates against the target list only, not other lists', () => {
    const c = addRankedJudge(contest(), school(1), 'Jane Smith');
    expect(paste(c, ranked(school(0)), 'Jane Smith').rows[0].duplicate).toBe(false);
  });

  it('uses the roster spelling for an exact match and offers no choices', () => {
    const [row] = paste(contest(), ranked(school(0)), 'jane smith').rows;
    expect(row).toMatchObject({ chosen: 'Jane Smith', choices: [], asWritten: false });
    expect(row.exact?.city).toBe('Austin');
  });

  it('keeps a name nobody fits as written, with no choices and no roster match', () => {
    const [row] = paste(contest(), ranked(school(0)), 'Pat Newcomer').rows;
    expect(row).toMatchObject({ chosen: 'Pat Newcomer', choices: [], exact: null, asWritten: false });
  });

  it('suggests the one judge fitting every word, while still offering a choice', () => {
    const [row] = paste(contest(), ranked(school(0)), 'Scott Allen').rows;
    expect(row.chosen).toBe('Robert Scott Allen');
    expect(row.choices.map((j) => j.name)).toEqual(['Robert Scott Allen']);
    expect(row.asWritten).toBe(false);
  });

  it('leaves an ambiguous name as written until the CM picks, then uses the pick', () => {
    const before = paste(contest(), ranked(school(0)), 'Sam');
    expect(before.rows[0]).toMatchObject({ chosen: 'Sam', asWritten: true });
    expect(before.rows[0].choices.map((j) => j.name)).toEqual(['Sam Jones', 'Sam Jordan']);

    const after = paste(contest(), ranked(school(0)), 'Sam', { Sam: 'Sam Jordan' });
    expect(after.rows[0]).toMatchObject({ chosen: 'Sam Jordan', asWritten: false });
    expect(after.toAdd).toEqual(['Sam Jordan']);
  });

  it('marks a pick that is already on the list as a duplicate', () => {
    const c = addRankedJudge(contest(), school(0), 'Sam Jordan');
    const preview = paste(c, ranked(school(0)), 'Sam', { Sam: 'Sam Jordan' });
    expect(preview.rows[0].duplicate).toBe(true);
    expect(preview.toAdd).toEqual([]);
  });

  it('adds a name once when two rows resolve to the same judge', () => {
    const preview = paste(contest(), ranked(school(0)), 'Jane Smith\nJ Smith', { 'J Smith': 'Jane Smith' });
    expect(preview.toAdd).toEqual(['Jane Smith']);
  });

  it('offers names already entered in this contest as matches', () => {
    const c = addRankedJudge(contest(), school(1), 'Local Hero');
    const [row] = paste(c, ranked(school(0)), 'local hero').rows;
    expect(row.chosen).toBe('Local Hero');
  });

  it('works on a custom list', () => {
    const c = addCustomPreferenceList(contest(), 'Committee');
    const ref: PreferenceListRef = { kind: 'custom', id: c.judgePreferences.customLists[0].id };
    const withName = addRankedJudge(c, ref, 'Jane Smith');
    expect(paste(withName, ranked(ref), 'Jane Smith\nSam Jones').toAdd).toEqual(['Sam Jones']);
  });

  it('gives no rows for blank text', () => {
    expect(paste(contest(), ranked(school(0)), '  \n')).toEqual({ rows: [], toAdd: [] });
  });
});

describe('applyPaste', () => {
  it('appends exactly the non-duplicate rows to the rankings, using the chosen match', () => {
    const c = addRankedJudge(contest(), school(0), 'Jane Smith');
    const target = ranked(school(0));
    const preview = paste(c, target, 'Pat Newcomer\njane smith\nSam\nScott Allen', { Sam: 'Sam Jones' });
    const next = applyPaste(c, target, preview, LATER);
    expect(next.schools[0].judgePreferences.ranked).toEqual([
      'Jane Smith',
      'Pat Newcomer',
      'Sam Jones',
      'Robert Scott Allen',
    ]);
    expect(next.schools[0].judgePreferences.vetoes).toEqual([]);
    expect(next.updatedAt).toBe(LATER);
  });

  it('appends to the vetoes when the target is vetoes', () => {
    const target = vetoes(school(2));
    const next = applyPaste(contest(), target, paste(contest(), target, 'Sam Jones\nPat Newcomer'));
    expect(next.schools[2].judgePreferences.vetoes).toEqual(['Sam Jones', 'Pat Newcomer']);
    expect(next.schools[2].judgePreferences.ranked).toEqual([]);
  });

  it('returns the contest unchanged when there is nothing to add', () => {
    const c = addRankedJudge(contest(), school(0), 'Jane Smith');
    const target = ranked(school(0));
    expect(applyPaste(c, target, paste(c, target, 'Jane Smith'))).toBe(c);
  });
});

describe('vetoedInSlots', () => {
  it('lists each vetoed judge who holds an active slot, with the 1-based slot', () => {
    let c = addVetoedJudge(contest(), school(0), 'Sam Jones');
    c = addVetoedJudge(c, school(1), 'Jane Smith');
    c = addVetoedJudge(c, school(1), 'Not Hired');
    c = setJudge(c, 0, { name: 'jane smith' });
    c = setJudge(c, 2, { name: 'Sam Jones' });
    expect(vetoedInSlots(c)).toEqual([
      { name: 'Jane Smith', slot: 1 },
      { name: 'Sam Jones', slot: 3 },
    ]);
  });

  it('ignores a hired judge who is only ranked', () => {
    const c = setJudge(addRankedJudge(contest(), school(0), 'Jane Smith'), 0, { name: 'Jane Smith' });
    expect(vetoedInSlots(c)).toEqual([]);
  });

  it('ignores a stored slot beyond the judge count', () => {
    let c = addVetoedJudge(contest(), school(0), 'Jane Smith');
    c = setJudge(c, 3, { name: 'Jane Smith' });
    c = { ...c, details: { ...c.details, numJudges: 3 } };
    expect(vetoedInSlots(c)).toEqual([]);
  });
});

describe('mergeImpact', () => {
  function twoSpellings(): Contest {
    const c = addRankedJudge(contest(), school(0), 'J. Smith');
    return addRankedJudge(c, school(1), 'Jane Smith');
  }

  it('offers every name on the call list and in the Vetoed section, alphabetically', () => {
    let c = addRankedJudge(twoSpellings(), school(2), 'Zed');
    c = addVetoedJudge(c, school(2), 'Alpha');
    expect(mergeCandidates(c)).toEqual(['Alpha', 'J. Smith', 'Jane Smith', 'Zed']);
  });

  it('is valid with two different candidate names and no warnings when neither is in a slot', () => {
    expect(mergeImpact(twoSpellings(), 'Jane Smith', 'J. Smith')).toEqual({
      keep: 'Jane Smith',
      merge: 'J. Smith',
      valid: true,
      warnings: [],
    });
  });

  it('is not valid until both names are picked', () => {
    expect(mergeImpact(twoSpellings(), 'Jane Smith', '')).toMatchObject({ valid: false, merge: '' });
    expect(mergeImpact(twoSpellings(), '', 'J. Smith')).toMatchObject({ valid: false, keep: '' });
  });

  it('drops the merged pick when it is the kept name', () => {
    expect(mergeImpact(twoSpellings(), 'Jane Smith', 'Jane Smith')).toMatchObject({ merge: '', valid: false });
  });

  it('reads a pick that is no longer a candidate as blank', () => {
    expect(mergeImpact(twoSpellings(), 'Gone Judge', 'J. Smith')).toMatchObject({ keep: '', valid: false });
    expect(mergeImpact(twoSpellings(), 'Jane Smith', 'Gone Judge')).toMatchObject({ merge: '', valid: false });
  });

  it('warns that the merged name\'s slot will take the kept spelling', () => {
    const c = setJudge(twoSpellings(), 1, { name: 'J. Smith' });
    expect(mergeImpact(c, 'Jane Smith', 'J. Smith').warnings).toEqual([
      'J. Smith is in the Judge 2 slot. Merging changes that slot to Jane Smith, so generated documents will use that spelling.',
    ]);
  });

  it('adds a slot collision when both names hold a slot', () => {
    let c = setJudge(twoSpellings(), 0, { name: 'Jane Smith' });
    c = setJudge(c, 2, { name: 'J. Smith' });
    expect(mergeImpact(c, 'Jane Smith', 'J. Smith').warnings).toEqual([
      "J. Smith is in the Judge 3 slot. Merging changes that slot to Jane Smith, so generated documents will use that spelling. Jane Smith is also in the Judge 1 slot, so you'll need to clear one of them.",
    ]);
  });

  it('does not warn when only the kept name holds a slot', () => {
    const c = setJudge(twoSpellings(), 0, { name: 'Jane Smith' });
    expect(mergeImpact(c, 'Jane Smith', 'J. Smith').warnings).toEqual([]);
  });

  it('does not warn before a kept name is picked', () => {
    const c = setJudge(twoSpellings(), 0, { name: 'J. Smith' });
    expect(mergeImpact(c, '', 'J. Smith').warnings).toEqual([]);
  });
});

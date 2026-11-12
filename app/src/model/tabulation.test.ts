import { describe, expect, it } from 'vitest';
import {
  advanceContest,
  createContest,
  duplicateContest,
  parseContest,
  serializeContest,
  setAdvancing,
  setNumSchools,
  setTabulationConfirmed,
  setTabulationNotRanked,
  setTabulationRank,
  withAdjudicator,
  withDetails,
  withIdentity,
  withSchool,
  type Contest,
} from './contest';
import { cellIssueMessage, tabulationView } from './tabulation';

const NOW = '2026-11-12T12:00:00.000Z';

/** A 3-school, 3-judge contest with named schools and plays. */
function contest(): Contest {
  let c = createContest({ id: 'c1', now: NOW, identity: { contestLevel: 'Zone' } });
  c = setNumSchools(c, 3, NOW);
  c = withDetails(c, { numJudges: 3 }, NOW);
  ['School 1', 'School 2', 'School 3'].forEach((name, i) => {
    c = withSchool(c, i, { name, playTitle: 'Play Name', performanceOrder: i + 1 }, NOW);
  });
  c = withAdjudicator(c, 0, { name: 'John Doe' }, NOW);
  c = withAdjudicator(c, 1, { name: 'Karen Hager' }, NOW);
  c = withAdjudicator(c, 2, { name: 'Smith Wesley' }, NOW);
  return c;
}

/** Enters ranks by school form index: ranks[i] = [acting, B, C]. */
function enter(c: Contest, ranks: string[][]): Contest {
  ranks.forEach((r, i) => r.forEach((text, j) => (c = setTabulationRank(c, i, j, text, NOW))));
  return c;
}

/** The user's UIL sample: School 1 (2,3,1), School 2 (3,1,3), School 3 (1,2,2). */
const SAMPLE = [
  ['2', '3', '1'],
  ['3', '1', '3'],
  ['1', '2', '2'],
];

describe('tabulation record (schema v16)', () => {
  it('a new contest starts with an empty, unconfirmed tabulation', () => {
    expect(createContest({ now: NOW }).tabulation).toEqual({ entries: {}, judgesConfirmed: false });
  });

  it('migrates a v15 contest to an empty tabulation and changes nothing else', () => {
    const c = contest();
    const { speechwire: _dev, tabulation: _t, ...v15Contest } = c;
    const migrated = parseContest(JSON.stringify({ schemaVersion: 15, contest: v15Contest }));
    expect(migrated.tabulation).toEqual({ entries: {}, judgesConfirmed: false });
    expect({ ...migrated, tabulation: c.tabulation }).toEqual(c);
  });

  it('round-trips ranks, Not-ranked flags, and confirmation through serialize and parse', () => {
    let c = enter(contest(), SAMPLE);
    c = setTabulationNotRanked(c, 1, true, NOW);
    c = setTabulationConfirmed(c, true, NOW);
    expect(parseContest(serializeContest(c)).tabulation).toEqual(c.tabulation);
  });

  it('stores raw text as typed, so a mistake is kept and flagged rather than lost', () => {
    const c = setTabulationRank(contest(), 0, 1, '2.5', NOW);
    expect(c.tabulation.entries['0'].ranks).toEqual(['', '2.5', '']);
  });

  it('keys entries by school form index, so a performance-order change cannot move a rank', () => {
    let c = setTabulationRank(contest(), 0, 0, '3', NOW);
    c = withSchool(c, 0, { performanceOrder: 3 }, NOW);
    c = withSchool(c, 2, { performanceOrder: 1 }, NOW);
    const row = tabulationView(c).rows.find((r) => r.schoolIndex === 0)!;
    expect(row.ranks[0]).toBe('3');
  });

  it('ignores out-of-range schools and judges', () => {
    const c = contest();
    expect(setTabulationRank(c, 5, 0, '1', NOW)).toBe(c);
    expect(setTabulationRank(c, 0, 3, '1', NOW)).toBe(c);
    expect(setTabulationNotRanked(c, -1, true, NOW)).toBe(c);
  });

  it('any rank or Not-ranked change clears the judges confirmation', () => {
    const confirmed = setTabulationConfirmed(enter(contest(), SAMPLE), true, NOW);
    expect(confirmed.tabulation.judgesConfirmed).toBe(true);
    expect(setTabulationRank(confirmed, 0, 0, '3', NOW).tabulation.judgesConfirmed).toBe(false);
    expect(setTabulationNotRanked(confirmed, 0, true, NOW).tabulation.judgesConfirmed).toBe(false);
  });

  it('dropping schools drops their entries; the rest are kept', () => {
    let c = setNumSchools(contest(), 5, NOW);
    c = enter(c, [['1'], ['2'], ['3'], ['4'], ['5']]);
    c = setNumSchools(c, 3, NOW);
    expect(Object.keys(c.tabulation.entries).sort()).toEqual(['0', '1', '2']);
  });

  it('duplicate and advance reset the tabulation', () => {
    let c = setTabulationConfirmed(enter(contest(), SAMPLE), true, NOW);
    c = setAdvancing(c, [2, 0, 1], NOW);
    expect(duplicateContest(c, { now: NOW }).tabulation).toEqual({ entries: {}, judgesConfirmed: false });
    expect(advanceContest(c, { now: NOW })!.tabulation).toEqual({ entries: {}, judgesConfirmed: false });
  });

  it('keeps saved ranks when the panel drops below 3 judges', () => {
    const c = withDetails(enter(contest(), SAMPLE), { numJudges: 1 }, NOW);
    expect(tabulationView(c).applicable).toBe(false);
    expect(tabulationView(withDetails(c, { numJudges: 3 }, NOW)).results).not.toBeNull();
  });
});

describe('tabulationView: rows and judges', () => {
  it('lists schools in performance order labeled "School - Play"', () => {
    let c = contest();
    c = withSchool(c, 0, { performanceOrder: 2 }, NOW);
    c = withSchool(c, 1, { performanceOrder: 3 }, NOW);
    c = withSchool(c, 2, { performanceOrder: 1, playTitle: 'Our Town' }, NOW);
    expect(tabulationView(c).rows.map((r) => [r.schoolIndex, r.label])).toEqual([
      [2, 'School 3 - Our Town'],
      [0, 'School 1 - Play Name'],
      [1, 'School 2 - Play Name'],
    ]);
  });

  it('falls back to form order when performance orders tie (no draw yet)', () => {
    let c = contest();
    [0, 1, 2].forEach((i) => (c = withSchool(c, i, { performanceOrder: 1 }, NOW)));
    expect(tabulationView(c).rows.map((r) => r.schoolIndex)).toEqual([0, 1, 2]);
  });

  it('reads labels live, with fallbacks for a blank school or play', () => {
    let c = withSchool(contest(), 0, { name: 'Renamed HS' }, NOW);
    c = withSchool(c, 1, { playTitle: '' }, NOW);
    c = withSchool(c, 2, { name: '' }, NOW);
    expect(tabulationView(c).rows.map((r) => r.label)).toEqual([
      'Renamed HS - Play Name',
      'School 2',
      'School 3 - Play Name',
    ]);
  });

  it('names the judge columns from the Judges section, Judge 1 first (Acting Judge)', () => {
    expect(tabulationView(contest()).judgeNames).toEqual(['John Doe', 'Karen Hager', 'Smith Wesley']);
    const c = withAdjudicator(contest(), 1, { name: '  ' }, NOW);
    expect(tabulationView(c).judgeNames).toEqual(['John Doe', 'Judge 2', 'Smith Wesley']);
  });

  it('applies only to 3-judge contests', () => {
    expect(tabulationView(contest()).applicable).toBe(true);
    expect(tabulationView(withDetails(contest(), { numJudges: 2 }, NOW)).applicable).toBe(false);
  });
});

describe('tabulationView: validation', () => {
  const issuesOf = (c: Contest, schoolIndex: number) =>
    tabulationView(c).rows.find((r) => r.schoolIndex === schoolIndex)!.issues;

  it('a fresh tabulation is all blank, with no errors and no results', () => {
    const v = tabulationView(contest());
    expect(v.blankCount).toBe(9);
    expect(v.errorCount).toBe(0);
    expect(v.results).toBeNull();
  });

  it('flags a value that is not a whole number', () => {
    for (const bad of ['2.5', 'x', '-1', '1e1']) {
      const c = setTabulationRank(contest(), 0, 0, bad, NOW);
      expect(issuesOf(c, 0)[0], bad).toBe('notWholeNumber');
    }
  });

  it('accepts surrounding spaces', () => {
    const c = setTabulationRank(contest(), 0, 0, ' 2 ', NOW);
    expect(issuesOf(c, 0)[0]).toBeNull();
  });

  it('flags a rank below 1 or above the number of ranked schools', () => {
    let c = setTabulationRank(contest(), 0, 0, '0', NOW);
    c = setTabulationRank(c, 1, 0, '4', NOW);
    expect(issuesOf(c, 0)[0]).toBe('outOfRange');
    expect(issuesOf(c, 1)[0]).toBe('outOfRange');
    expect(cellIssueMessage('outOfRange', 3)).toBe('Must be 1-3');
  });

  it('flags a rank used twice by one judge on both cells', () => {
    const c = enter(contest(), [['1'], ['1'], ['2']]);
    expect(issuesOf(c, 0)[0]).toBe('duplicate');
    expect(issuesOf(c, 1)[0]).toBe('duplicate');
    expect(issuesOf(c, 2)[0]).toBeNull();
  });

  it('allows the same rank from different judges', () => {
    const c = enter(contest(), [['1', '1', '1']]);
    expect(issuesOf(c, 0)).toEqual([null, null, null]);
  });

  it('names a judge missing ranks once that column is fully entered', () => {
    let c = enter(contest(), [['1', '1'], ['1', '2'], ['2']]);
    const v = tabulationView(c);
    expect(v.missingRanks[0]).toEqual([3]);
    // Judge B still has a blank, so no note yet.
    expect(v.missingRanks[1]).toEqual([]);
    c = setTabulationRank(c, 2, 1, '3', NOW);
    expect(tabulationView(c).missingRanks[1]).toEqual([]);
  });

  it('produces results only when every ballot is valid', () => {
    let c = enter(contest(), SAMPLE);
    expect(tabulationView(c).results).not.toBeNull();
    c = setTabulationRank(c, 0, 2, '', NOW);
    expect(tabulationView(c).results).toBeNull();
    c = setTabulationRank(c, 0, 2, '9', NOW);
    expect(tabulationView(c).errorCount).toBe(1);
    expect(tabulationView(c).results).toBeNull();
  });
});

describe('tabulationView: Not ranked', () => {
  it('drops the school from validation and results, and shrinks the valid range', () => {
    let c = setNumSchools(contest(), 4, NOW);
    c = withSchool(c, 3, { name: 'School 4', playTitle: 'Play Name', performanceOrder: 4 }, NOW);
    c = setTabulationNotRanked(c, 3, true, NOW);
    c = setTabulationRank(c, 3, 0, '9', NOW); // ignored while not ranked
    c = enter(c, [...SAMPLE]);
    const v = tabulationView(c);
    expect(v.rankedCount).toBe(3);
    expect(v.rows.find((r) => r.schoolIndex === 3)!.issues).toEqual([null, null, null]);
    expect(v.errorCount).toBe(0);
    expect(v.results!.map((r) => r.schoolIndex)).toEqual([2, 0, 1]);
  });

  it('flags a 4 once a school is not ranked in a 4-school contest', () => {
    let c = setNumSchools(contest(), 4, NOW);
    c = setTabulationRank(c, 0, 0, '4', NOW);
    expect(tabulationView(c).rows.find((r) => r.schoolIndex === 0)!.issues[0]).toBeNull();
    c = setTabulationNotRanked(c, 3, true, NOW);
    expect(tabulationView(c).rows.find((r) => r.schoolIndex === 0)!.issues[0]).toBe('outOfRange');
  });

  it('keeps typed ranks when a school goes back to ranked', () => {
    let c = setTabulationRank(contest(), 0, 0, '2', NOW);
    c = setTabulationNotRanked(setTabulationNotRanked(c, 0, true, NOW), 0, false, NOW);
    expect(c.tabulation.entries['0'].ranks[0]).toBe('2');
  });
});

describe('tabulationView: results', () => {
  it('reproduces the UIL printout for the user sample', () => {
    const v = tabulationView(withIdentity(enter(contest(), SAMPLE), { contestLevel: 'Zone' }, NOW));
    expect(v.results!.map((r) => [r.label, r.place, ...r.ranks, r.diagnostic])).toEqual([
      ['School 3 - Play Name', 1, 1, 2, 2, 'Lowest Total'],
      ['School 1 - Play Name', 2, 2, 3, 1, 'Majority of or better'],
      ['School 2 - Play Name', 3, 3, 1, 3, 'Majority of or better'],
    ]);
  });

  it('marks an Acting-Judge-broken tie', () => {
    const v = tabulationView(
      enter(contest(), [
        ['1', '2', '3'],
        ['2', '3', '1'],
        ['3', '1', '2'],
      ]),
    );
    expect(v.results!.every((r) => r.tie && r.diagnostic === 'Tie broken by Acting Judge')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { TTAO_SNAPSHOT } from './ttaoRosterSnapshot';
import { matchPastedName, suggestJudges, type RosterJudge } from './ttaoRoster';

const ROSTER: RosterJudge[] = [
  { name: 'Jane Smith', city: 'Austin', esc: 'Region 13: Austin' },
  { name: 'John Smithers', city: 'Dallas', esc: 'Region 10: Richardson' },
  { name: 'Adam Jones', city: 'Waco', esc: '' },
  { name: 'Mary Smith-Lee', city: 'Lubbock', esc: 'Region 17: Lubbock' },
  { name: 'Smitty Brown', city: 'Tyler', esc: 'Region 7: Kilgore' },
];

const names = (query: string, entered: string[] = [], exclude: string[] = []) =>
  suggestJudges(query, { roster: ROSTER, entered, exclude }).map((s) => s.name);

describe('suggestJudges', () => {
  it('matches the start of any word in the name, ignoring case', () => {
    expect(names('SMI')).toContain('Jane Smith');
    expect(names('jan')).toEqual(['Jane Smith']);
    expect(names('ane')).toEqual([]);
  });

  it('matches each part of a hyphenated name', () => {
    expect(names('lee')).toEqual(['Mary Smith-Lee']);
  });

  it('matches a nickname in parentheses', () => {
    const roster = [{ name: 'Rosendo (Ross) DeLeon', city: 'San Antonio', esc: '' }];
    expect(suggestJudges('ross del', { roster }).map((s) => s.name)).toEqual(['Rosendo (Ross) DeLeon']);
  });

  it('requires every typed word to match, in any order and with any spacing', () => {
    expect(names('  jane   smi ')).toEqual(['Jane Smith']);
    expect(names('smith jane')).toEqual(['Jane Smith']);
    expect(names('jane jones')).toEqual([]);
  });

  it('shows city and ESC from the roster', () => {
    expect(suggestJudges('jane', { roster: ROSTER })).toEqual([
      { name: 'Jane Smith', city: 'Austin', esc: 'Region 13: Austin' },
    ]);
  });

  it('suggests nothing for a blank query', () => {
    expect(names('')).toEqual([]);
    expect(names('   ')).toEqual([]);
  });

  it('lists names starting with the query first, then alphabetically', () => {
    expect(names('smi')).toEqual(['Smitty Brown', 'Jane Smith', 'John Smithers', 'Mary Smith-Lee']);
  });

  it('suggests names already entered that are not on the roster, with no details', () => {
    expect(suggestJudges('pat', { roster: ROSTER, entered: ['Pat Doe'] })).toEqual([
      { name: 'Pat Doe', city: '', esc: '' },
    ]);
  });

  it('lists entered names ahead of roster names', () => {
    expect(names('smi', ['Zed Smith'])[0]).toBe('Zed Smith');
  });

  it('shows one row for a name both entered and on the roster, in the entered spelling with roster details', () => {
    expect(suggestJudges('jane', { roster: ROSTER, entered: ['JANE  smith'] })).toEqual([
      { name: 'JANE  smith', city: 'Austin', esc: 'Region 13: Austin' },
    ]);
  });

  it('keeps two roster judges who share a name, since city tells them apart', () => {
    const roster = [
      { name: 'Pat Lee', city: 'Austin', esc: '' },
      { name: 'Pat Lee', city: 'Waco', esc: '' },
    ];
    expect(suggestJudges('pat', { roster }).map((s) => s.city)).toEqual(['Austin', 'Waco']);
  });

  it('leaves out excluded names, ignoring case and spacing', () => {
    expect(names('jane', [], ['jane  SMITH'])).toEqual([]);
    expect(names('pat', ['Pat Doe'], ['Pat Doe'])).toEqual([]);
  });

  it('returns at most the limit, keeping the best matches', () => {
    const found = suggestJudges('smi', { roster: ROSTER, limit: 2 }).map((s) => s.name);
    expect(found).toEqual(['Smitty Brown', 'Jane Smith']);
  });

  it('works with an empty roster, using entered names alone', () => {
    expect(suggestJudges('jan', { roster: [] })).toEqual([]);
    expect(suggestJudges('jan', { roster: [], entered: ['Jan Doe'] }).map((s) => s.name)).toEqual(['Jan Doe']);
  });
});

describe('matchPastedName', () => {
  const roster: RosterJudge[] = [
    { name: 'Aaron Brown', city: 'Seguin', esc: 'Region 12: Waco' },
    { name: 'Joe Brown', city: 'Fort Worth', esc: '' },
    { name: 'Robert Scott Allen', city: 'Highlands', esc: 'Region 4: Houston' },
    { name: 'Charles (Gary) Cooper', city: 'New Braunfels', esc: '' },
    { name: 'Michael Cooper', city: 'Texarkana', esc: '' },
    { name: 'Jane Smith', city: 'Austin', esc: '' },
    { name: 'Jane Smithers', city: 'Dallas', esc: '' },
  ];

  it('uses the roster spelling for an exact match, with nothing to choose', () => {
    expect(matchPastedName('aaron  BROWN', { roster })).toEqual({
      typed: 'aaron  BROWN',
      suggested: 'Aaron Brown',
      exact: roster[0],
      candidates: [],
    });
  });

  it('prefers an exact match over a longer name that also matches', () => {
    const match = matchPastedName('Jane Smith', { roster });
    expect(match.exact?.name).toBe('Jane Smith');
    expect(match.candidates).toEqual([]);
  });

  it('suggests the only roster judge a partial name fits', () => {
    expect(matchPastedName('Scott Allen', { roster })).toMatchObject({
      suggested: 'Robert Scott Allen',
      exact: null,
    });
    expect(matchPastedName('Gary Cooper', { roster }).suggested).toBe('Charles (Gary) Cooper');
  });

  it('still lists that one judge as a candidate, so the CM can decline it', () => {
    expect(matchPastedName('Scott Allen', { roster }).candidates.map((c) => c.name)).toEqual(['Robert Scott Allen']);
  });

  it('keeps the name as typed when several judges fit, and lists them', () => {
    const match = matchPastedName('Brown', { roster });
    expect(match.suggested).toBe('Brown');
    expect(match.candidates.map((c) => c.name)).toEqual(['Aaron Brown', 'Joe Brown']);
  });

  it('keeps the name as typed when nobody fits', () => {
    expect(matchPastedName('Travis Springfield', { roster })).toEqual({
      typed: 'Travis Springfield',
      suggested: 'Travis Springfield',
      exact: null,
      candidates: [],
    });
  });

  it('offers a close spelling but never picks it, since it could be a different person', () => {
    const match = matchPastedName('Janae Smith', { roster });
    expect(match.suggested).toBe('Janae Smith');
    expect(match.exact).toBeNull();
    expect(match.candidates.map((c) => c.name)).toEqual(['Jane Smith']);
  });

  it('does not offer a spelling more than two letters off', () => {
    expect(matchPastedName('Janice Smyth', { roster }).candidates).toEqual([]);
  });

  it('matches a name already entered in this contest, in its entered spelling', () => {
    const match = matchPastedName('travis springfield', { roster, entered: ['Travis Springfield'] });
    expect(match.suggested).toBe('Travis Springfield');
    expect(match.exact?.name).toBe('Travis Springfield');
  });

  it('works with an empty roster', () => {
    expect(matchPastedName('Aaron Brown', { roster: [] }).suggested).toBe('Aaron Brown');
  });
});

describe('bundled snapshot', () => {
  it('holds only name, city, and nearest ESC for each judge', () => {
    for (const judge of TTAO_SNAPSHOT.judges) {
      expect(Object.keys(judge).sort()).toEqual(['city', 'esc', 'name']);
    }
  });

  it('has a date to show', () => {
    expect(TTAO_SNAPSHOT.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

import { describe, expect, it } from 'vitest';
import { TTAO_SNAPSHOT } from './ttaoRosterSnapshot';
import { suggestJudges, type RosterJudge } from './ttaoRoster';

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

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SORT,
  directionLabel,
  isSortDirection,
  isSortKey,
  sortContests,
  type SortPref,
} from './contestSort';
import type { ContestSummary } from '../storage/contestStore';

/** A summary with sensible defaults; override only what a case cares about. */
function s(partial: Partial<ContestSummary> & { id: string }): ContestSummary {
  return {
    name: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
    contestDate: '',
    hostSchoolName: '',
    archived: false,
    contestLevel: 'District',
    classification: '5A',
    contestYear: '2026',
    ...partial,
  };
}

const ids = (list: ContestSummary[], pref: SortPref) => sortContests(list, pref).map((c) => c.id);

describe('sortContests', () => {
  it('sorts by contest date, soonest first when ascending', () => {
    const a = s({ id: 'a', contestDate: '2026-03-10' });
    const b = s({ id: 'b', contestDate: '2026-01-05' });
    expect(ids([a, b], { key: 'date', direction: 'asc' })).toEqual(['b', 'a']);
    expect(ids([a, b], { key: 'date', direction: 'desc' })).toEqual(['a', 'b']);
  });

  it('keeps undated contests at the bottom regardless of direction', () => {
    const dated1 = s({ id: 'd1', contestDate: '2026-03-10' });
    const dated2 = s({ id: 'd2', contestDate: '2026-01-05' });
    const blank = s({ id: 'blank', contestDate: '' });
    expect(ids([dated1, blank, dated2], { key: 'date', direction: 'asc' })).toEqual(['d2', 'd1', 'blank']);
    expect(ids([dated1, blank, dated2], { key: 'date', direction: 'desc' })).toEqual(['d1', 'd2', 'blank']);
  });

  it('sorts by last edited, newest first when descending (the default sense)', () => {
    const older = s({ id: 'older', updatedAt: '2026-05-01T00:00:00.000Z' });
    const newer = s({ id: 'newer', updatedAt: '2026-05-03T00:00:00.000Z' });
    expect(ids([older, newer], { key: 'lastEdited', direction: 'desc' })).toEqual(['newer', 'older']);
    expect(ids([older, newer], { key: 'lastEdited', direction: 'asc' })).toEqual(['older', 'newer']);
  });

  it('sorts by name case-insensitively', () => {
    const beta = s({ id: 'beta', name: 'Beta' });
    const alpha = s({ id: 'alpha', name: 'alpha' });
    expect(ids([beta, alpha], { key: 'name', direction: 'asc' })).toEqual(['alpha', 'beta']);
    expect(ids([beta, alpha], { key: 'name', direction: 'desc' })).toEqual(['beta', 'alpha']);
  });

  it('breaks ties on the date key by name A→Z', () => {
    const zed = s({ id: 'zed', name: 'Zed', contestDate: '2026-03-10' });
    const amy = s({ id: 'amy', name: 'Amy', contestDate: '2026-03-10' });
    expect(ids([zed, amy], { key: 'date', direction: 'asc' })).toEqual(['amy', 'zed']);
    // Same tie-break even descending — the tie-break is not reversed by direction.
    expect(ids([zed, amy], { key: 'date', direction: 'desc' })).toEqual(['amy', 'zed']);
  });

  it('breaks ties on other keys by contest date (soonest), then name', () => {
    const t = '2026-05-01T00:00:00.000Z';
    const march = s({ id: 'march', updatedAt: t, contestDate: '2026-03-10' });
    const january = s({ id: 'january', updatedAt: t, contestDate: '2026-01-01' });
    expect(ids([march, january], { key: 'lastEdited', direction: 'desc' })).toEqual(['january', 'march']);
  });

  it('falls back to last-edited (newest) when Name is the key and names tie', () => {
    const older = s({ id: 'older', name: 'Same', updatedAt: '2026-05-01T00:00:00.000Z' });
    const newer = s({ id: 'newer', name: 'Same', updatedAt: '2026-05-03T00:00:00.000Z' });
    expect(ids([older, newer], { key: 'name', direction: 'asc' })).toEqual(['newer', 'older']);
  });

  it('does not mutate the input array', () => {
    const input = [s({ id: 'a', contestDate: '2026-03-10' }), s({ id: 'b', contestDate: '2026-01-05' })];
    sortContests(input, { key: 'date', direction: 'asc' });
    expect(input.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('sorts by level in UIL progression, not alphabetically', () => {
    // Alphabetical would give Area, BiDistrict, District, Region, Zone — progression must not.
    const region = s({ id: 'region', contestLevel: 'Region' });
    const zone = s({ id: 'zone', contestLevel: 'Zone' });
    const bi = s({ id: 'bi', contestLevel: 'BiDistrict' });
    expect(ids([region, zone, bi], { key: 'level', direction: 'asc' })).toEqual(['zone', 'bi', 'region']);
    expect(ids([region, zone, bi], { key: 'level', direction: 'desc' })).toEqual(['region', 'bi', 'zone']);
  });

  it('sorts by classification 1A → 6A numerically', () => {
    const sixA = s({ id: '6a', classification: '6A' });
    const oneA = s({ id: '1a', classification: '1A' });
    const threeA = s({ id: '3a', classification: '3A' });
    expect(ids([sixA, oneA, threeA], { key: 'classification', direction: 'asc' })).toEqual(['1a', '3a', '6a']);
    expect(ids([sixA, oneA, threeA], { key: 'classification', direction: 'desc' })).toEqual(['6a', '3a', '1a']);
  });

  it('sorts by contest year numerically, blanks at the bottom in both directions', () => {
    const y2027 = s({ id: 'y2027', contestYear: '2027' });
    const y2025 = s({ id: 'y2025', contestYear: '2025' });
    const blank = s({ id: 'blank', contestYear: '' });
    expect(ids([y2027, blank, y2025], { key: 'year', direction: 'asc' })).toEqual(['y2025', 'y2027', 'blank']);
    expect(ids([y2027, blank, y2025], { key: 'year', direction: 'desc' })).toEqual(['y2027', 'y2025', 'blank']);
  });
});

describe('sort metadata', () => {
  it('defaults to last edited, newest first', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'lastEdited', direction: 'desc' });
  });

  it('labels directions naturally per key', () => {
    expect(directionLabel('date', 'asc')).toBe('Soonest first');
    expect(directionLabel('date', 'desc')).toBe('Latest first');
    expect(directionLabel('lastEdited', 'desc')).toBe('Newest first');
    expect(directionLabel('name', 'asc')).toBe('A → Z');
  });

  it('guards persisted values', () => {
    expect(isSortKey('date')).toBe(true);
    expect(isSortKey('bogus')).toBe(false);
    expect(isSortDirection('asc')).toBe(true);
    expect(isSortDirection(2)).toBe(false);
  });
});

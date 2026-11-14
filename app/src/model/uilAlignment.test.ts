import { describe, expect, it } from 'vitest';
import { createContest, withDirector, withIdentity, withSchool, type Contest, type ContestIdentity } from './contest';
import {
  canFillDistrictSchools,
  districtPlacement,
  districtSchools,
  snapshotIsStale,
  withAlignmentFill,
  withDistrictSchools,
  type AlignmentSnapshot,
} from './uilAlignment';
import { UIL_ALIGNMENT_SNAPSHOT } from './uilAlignmentSnapshot';

const NOW = '2026-11-14T12:00:00.000Z';

const district = (n: number, size: number) => Array.from({ length: size }, (_, i) => `D${n} School ${i + 1}`);
const conference = () => Array.from({ length: 32 }, (_, i) => district(i + 1, i === 12 ? 12 : 4));
const SNAPSHOT: AlignmentSnapshot = {
  asOf: '2026-11-14',
  schoolYear: '2026-2027',
  conferences: { '1A': conference(), '2A': conference(), '3A': conference(), '4A': conference(), '5A': conference(), '6A': conference() },
};

function contest(identity: Partial<ContestIdentity> = {}): Contest {
  return createContest({ id: 'c', now: NOW, identity });
}

/** Types an identity edit the way the Contest Identity section does. */
function edit(c: Contest, patch: Partial<ContestIdentity>): Contest {
  return withAlignmentFill(c, withIdentity(c, patch, NOW), SNAPSHOT);
}

const names = (c: Contest) => c.schools.map((s) => s.name);

describe('districtPlacement', () => {
  it('follows the fixed grid: pairs, columns of four, regions of eight', () => {
    expect(districtPlacement(1)).toEqual({ partner: 2, area: 1, region: 1 });
    expect(districtPlacement(20)).toEqual({ partner: 19, area: 5, region: 3 });
    expect(districtPlacement(32)).toEqual({ partner: 31, area: 8, region: 4 });
  });
});

describe('level numbers', () => {
  it('fills a BiDistrict partner, area, and region from the first district', () => {
    const c = edit(contest({ contestLevel: 'BiDistrict' }), { district: '19' });
    expect(c.identity).toMatchObject({ district: '19', districtSecond: '20', area: '5', region: '3' });
  });

  it('fills a Zone area and region but leaves the zone number to the CM', () => {
    const c = edit(contest({ contestLevel: 'Zone' }), { district: '20' });
    expect(c.identity).toMatchObject({ area: '5', region: '3', zone: '' });
  });

  it('fills an Area contest region from the area', () => {
    expect(edit(contest({ contestLevel: 'Area' }), { area: '5' }).identity.region).toBe('3');
  });

  it('follows the district while the derived numbers are untouched', () => {
    let c = edit(contest({ contestLevel: 'BiDistrict' }), { district: '2' });
    c = edit(c, { district: '20' });
    expect(c.identity).toMatchObject({ districtSecond: '19', area: '5', region: '3' });
  });

  it('never overwrites a number the CM typed', () => {
    let c = edit(contest({ contestLevel: 'BiDistrict' }), { district: '19' });
    c = edit(c, { region: '4' });
    c = edit(c, { district: '1' });
    expect(c.identity).toMatchObject({ districtSecond: '2', area: '1', region: '4' });
  });

  it('clears derived numbers when the district is cleared or invalid', () => {
    let c = edit(contest({ contestLevel: 'BiDistrict' }), { district: '19' });
    c = edit(c, { district: '' });
    expect(c.identity).toMatchObject({ districtSecond: '', area: '', region: '' });
    expect(edit(contest({ contestLevel: 'BiDistrict' }), { district: '33' }).identity.region).toBe('');
  });
});

describe('district schools', () => {
  it('fills the school count and names for a District contest', () => {
    const c = edit(contest(), { district: '5' });
    expect(names(c)).toEqual(district(5, 4));
  });

  it('swaps an untouched fill when the district or conference changes', () => {
    let c = edit(contest(), { district: '5' });
    c = edit(c, { district: '6' });
    expect(names(c).slice(0, 4)).toEqual(district(6, 4));
    c = edit(c, { classification: '4A' });
    expect(names(c).slice(0, 4)).toEqual(district(6, 4));
  });

  it('leaves a district with more than eight schools for the CM to pick', () => {
    const c = edit(contest(), { district: '13' });
    expect(names(c).every((n) => n === '')).toBe(true);
    expect(canFillDistrictSchools(c, null)).toBe(true);
    const picked = withDistrictSchools(c, district(13, 12).slice(0, 7));
    expect(names(picked)).toEqual(district(13, 12).slice(0, 7));
  });

  it('never touches schools the CM has started on', () => {
    const typed = edit(withSchool(contest(), 0, { name: 'Friendswood' }), { district: '5' });
    expect(names(typed)[0]).toBe('Friendswood');
    expect(names(typed).slice(1).every((n) => n === '')).toBe(true);

    const withDirectorOnly = edit(withDirector(contest(), 2, 0, { email: 'a@b.org' }), { district: '5' });
    expect(names(withDirectorOnly).every((n) => n === '')).toBe(true);
  });

  it('blanks an untouched fill when the district is cleared, keeping the count', () => {
    let c = edit(contest(), { district: '5' });
    c = edit(c, { district: '' });
    expect(names(c).every((n) => n === '')).toBe(true);
    expect(c.schools).toHaveLength(4);
  });

  it('only fills at District level', () => {
    expect(names(edit(contest({ contestLevel: 'BiDistrict' }), { district: '5' })).every((n) => n === '')).toBe(true);
  });
});

describe('bundled snapshot', () => {
  it('has 32 non-empty districts for every conference', () => {
    for (const districts of Object.values(UIL_ALIGNMENT_SNAPSHOT.conferences)) {
      expect(districts).toHaveLength(32);
      expect(districts.every((d) => d.length > 0)).toBe(true);
    }
  });

  it('finds a known school in its district', () => {
    expect(districtSchools(UIL_ALIGNMENT_SNAPSHOT, '5A', '20')).toContain('Friendswood');
  });
});

describe('snapshotIsStale', () => {
  it('turns stale eleven calendar months after the snapshot date', () => {
    expect(snapshotIsStale('2026-01-15', '2026-12-14')).toBe(false);
    expect(snapshotIsStale('2026-01-15', '2026-12-15')).toBe(true);
  });
});

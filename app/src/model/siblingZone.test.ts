import { describe, expect, it } from 'vitest';
import {
  addBreak,
  addComplianceItem,
  addCustomPreferenceList,
  addReadinessItem,
  createContest,
  defaultDocumentSelection,
  defaultJudgePreferences,
  defaultNextContest,
  defaultSchools,
  defaultSpeechwire,
  runDraw,
  setAdjudicatorMilestone,
  setArrival,
  setBestCrew,
  setComplianceStatus,
  setCritiqueAssignment,
  setDocumentSelected,
  setNumSchools,
  setReadinessStatus,
  withAdjudicator,
  withArchived,
  withCmInfo,
  withDetails,
  withNextContest,
  withSchool,
  withSpeechwire,
  withTitleOverride,
  type Contest,
  type ContestLevel,
} from './contest';
import { computeSchedule } from './schedule';
import { createSiblingZone, findSiblingZones, siblingZoneNumber } from './siblingZone';

const NOW = '2026-07-05T12:00:00.000Z';
const LATER = '2026-07-06T00:00:00.000Z';

/** A Zone contest with every area the field policy covers filled in. */
function fullZone(zoneNumber: string): Contest {
  let c = createContest({
    id: 'source',
    now: NOW,
    identity: {
      contestYear: '2027',
      contestLevel: 'Zone',
      classification: '4A',
      region: '2',
      area: '1',
      district: '20',
      zone: zoneNumber,
      hostSchoolName: 'Friendswood High School',
      hostVenueName: 'Friendswood PAC',
      hostAddress: '702 Greenbriar Dr.',
    },
  });
  c = withCmInfo(c, { name: 'Casey Manager', email: 'casey@example.com' }, NOW);
  c = withDetails(
    c,
    {
      contestDate: '2027-03-10',
      directorsMeetingTime: '10:00 AM',
      firstShowTime: '11:00 AM',
      critiqueFormat: 'after_each',
      numJudges: 2,
      rehearsalDate1: '2027-03-08',
      rehearsalDate2: '2027-03-09',
      rehearsalStartTime1: '4:00 PM',
      rehearsalStartTime2: '5:00 PM',
      rehearsalDay1Count: 4,
      rehearsalLengthMinutes: 90,
      entryFee: '50',
      admissionFee: '5',
      entrySystemDeadline: '2027-02-10',
      lightCueDeadlineDate: '2027-02-20',
      lightCueDeadlineTime: '5:00 PM',
      bidcContestDate: '2027-03-20',
    },
    NOW,
  );
  c = setDocumentSelected(c, 'checklist', false, NOW);
  c = withAdjudicator(c, 0, { name: 'Jane Doe', mailingAddress: '1 Main St', dietary: 'Vegan', bio: 'Bio' }, NOW);
  c = setAdjudicatorMilestone(c, 0, 'ttaoContractDate', true, NOW);
  c = withAdjudicator(c, 1, { name: 'Sam Lee', needsHotel: true, hotelNights: 2, needsPower: true }, NOW);
  c = setNumSchools(c, 8, NOW);
  c = withSchool(c, 0, { name: 'Clear Lake', playTitle: 'Our Town' }, NOW);
  c = addComplianceItem(c, { id: 'custom-c', label: 'Bus form' }, NOW);
  c = setComplianceStatus(c, 0, 'custom-c', 'received', NOW);
  c = addReadinessItem(c, { id: 'custom-r', label: 'Book risers', phase: 'planning' }, NOW);
  c = setReadinessStatus(c, 'custom-r', 'done', NOW);
  c = addBreak(c, 'show:1', 30, 'Lunch', NOW);
  c = setArrival(c, 480, NOW);
  c = setCritiqueAssignment(c, [0, 1, 0, 1, 0, 1, 0, 1], NOW);
  c = runDraw(c, [1, 2, 3, 4, 5, 6, 7, 8], NOW);
  c = setBestCrew(c, 0, NOW);
  c = withNextContest(c, { location: 'Elsewhere' }, NOW);
  c = addCustomPreferenceList(c, 'Host panel', NOW);
  c = withSpeechwire(c, { username: 'casey', password: 'secret' }, NOW);
  c = withTitleOverride(c, 'My custom title', NOW);
  return c;
}

function create(source: Contest): Contest {
  const sibling = createSiblingZone(source, { id: 'sibling', now: LATER });
  if (!sibling) throw new Error('expected a sibling');
  return sibling;
}

describe('siblingZoneNumber', () => {
  it('pairs zone 1 with zone 2 and back', () => {
    expect(siblingZoneNumber(fullZone('1').identity)).toBe('2');
    expect(siblingZoneNumber(fullZone('2').identity)).toBe('1');
  });

  it('trims the zone number first', () => {
    expect(siblingZoneNumber(fullZone(' 1 ').identity)).toBe('2');
  });

  it.each(['', '   ', '3', '12', 'one'])('has no sibling for zone %j', (zone) => {
    expect(siblingZoneNumber(fullZone(zone).identity)).toBeNull();
  });

  it.each(['District', 'BiDistrict', 'Area', 'Region'] satisfies ContestLevel[])(
    'has no sibling at %s level, even with a leftover zone number',
    (contestLevel) => {
      expect(siblingZoneNumber({ ...fullZone('1').identity, contestLevel })).toBeNull();
    },
  );
});

describe.each([
  ['1', '2'],
  ['2', '1'],
])('createSiblingZone from zone %s to zone %s', (from, to) => {
  const source = fullZone(from);
  const sibling = create(source);

  it('gets the given id and timestamps', () => {
    expect(sibling.id).toBe('sibling');
    expect(sibling.createdAt).toBe(LATER);
    expect(sibling.updatedAt).toBe(LATER);
  });

  it('carries identity with the zone number swapped', () => {
    expect(sibling.identity).toEqual({ ...source.identity, zone: to });
  });

  it('carries CM info and the document selection', () => {
    expect(sibling.cmInfo).toEqual(source.cmInfo);
    expect(sibling.documents).toEqual(source.documents);
    expect(sibling.documents).not.toEqual(defaultDocumentSelection());
  });

  it('carries critique format, judge count, fees, and rehearsal length', () => {
    expect(sibling.details).toMatchObject({
      critiqueFormat: 'after_each',
      numJudges: 2,
      entryFee: '50',
      admissionFee: '5',
      rehearsalLengthMinutes: 90,
    });
  });

  it('carries clock times', () => {
    expect(sibling.details).toMatchObject({
      directorsMeetingTime: '10:00 AM',
      firstShowTime: '11:00 AM',
      rehearsalStartTime1: '4:00 PM',
      rehearsalStartTime2: '5:00 PM',
      lightCueDeadlineTime: '5:00 PM',
    });
  });

  it('blanks the contest date, rehearsal dates, and date-based deadlines', () => {
    expect(sibling.details).toMatchObject({
      contestDate: '',
      rehearsalDate1: '',
      rehearsalDate2: '',
      entrySystemDeadline: '',
      lightCueDeadlineDate: '',
      bidcContestDate: '',
    });
  });

  it('resets rehearsal day 1 count to the default split', () => {
    expect(sibling.details.rehearsalDay1Count).toBeNull();
  });

  it('carries judges in full, including checklist dates', () => {
    expect(sibling.adjudicators).toEqual(source.adjudicators);
    expect(sibling.adjudicators[0].ttaoContractDate).not.toBe('');
  });

  it('starts with the 6 default blank school slots', () => {
    expect(sibling.schools).toEqual(defaultSchools());
    expect(sibling.schools).toHaveLength(6);
  });

  it('carries custom item definitions and resets their status', () => {
    expect(sibling.customComplianceItems).toEqual([{ id: 'custom-c', label: 'Bus form' }]);
    expect(sibling.customReadinessItems).toEqual(source.customReadinessItems);
    expect(sibling.readinessChecks).toEqual({});
  });

  it('carries schedule breaks and the arrival override', () => {
    expect(sibling.scheduleOverrides).toEqual(source.scheduleOverrides);
    expect(sibling.scheduleOverrides.gaps).toHaveLength(1);
    expect(sibling.scheduleOverrides.arrival).toBe(480);
  });

  it("resets everything from the other zone's contest day", () => {
    expect(sibling.draw).toBeNull();
    expect(sibling.critique).toBeNull();
    expect(sibling.results).toBeNull();
    expect(sibling.nextContest).toEqual(defaultNextContest());
  });

  it('resets judge preferences, the custom title, and Speechwire credentials', () => {
    expect(sibling.judgePreferences).toEqual(defaultJudgePreferences());
    expect(sibling.titleOverride).toBe('');
    expect(sibling.speechwire).toEqual(defaultSpeechwire());
  });
});

describe('createSiblingZone', () => {
  it.each(['', '3'])('returns null for zone %j', (zone) => {
    expect(createSiblingZone(fullZone(zone))).toBeNull();
  });

  it('returns null at another level', () => {
    const source = fullZone('1');
    const district = { ...source, identity: { ...source.identity, contestLevel: 'District' as const } };
    expect(createSiblingZone(district)).toBeNull();
  });

  it('writes the swapped number even when the source zone has stray spaces', () => {
    expect(create(fullZone(' 2 ')).identity.zone).toBe('1');
  });

  it('is active even when the source is archived', () => {
    expect(create(withArchived(fullZone('1'), true, NOW)).archived).toBe(false);
  });

  it('makes a fresh id and uses the clock when none is given', () => {
    const sibling = createSiblingZone(fullZone('1'));
    expect(sibling?.id).not.toBe('source');
    expect(sibling?.createdAt).toBe(sibling?.updatedAt);
    expect(sibling?.createdAt).not.toBe(NOW);
  });

  it('leaves the source unchanged', () => {
    const source = fullZone('1');
    const before = structuredClone(source);
    create(source);
    expect(source).toEqual(before);
  });

  it('shares no references with the source', () => {
    const source = fullZone('1');
    const sibling = create(source);
    const before = structuredClone(source);

    sibling.identity.hostSchoolName = 'changed';
    sibling.cmInfo.name = 'changed';
    sibling.details.entryFee = 'changed';
    sibling.documents[Object.keys(sibling.documents)[0] as keyof typeof sibling.documents] = true;
    sibling.adjudicators[0].name = 'changed';
    sibling.adjudicators.pop();
    sibling.customComplianceItems[0].label = 'changed';
    sibling.customReadinessItems[0].label = 'changed';
    sibling.scheduleOverrides.gaps[0].label = 'changed';
    sibling.scheduleOverrides.gaps.pop();

    expect(source).toEqual(before);
  });

  it('keeps a break whose show does not exist yet and leaves the schedule untouched by it', () => {
    const source = addBreak(
      withDetails(fullZone('1'), { directorsMeetingTime: '10:00 AM', firstShowTime: '11:00 AM' }, NOW),
      'show:7',
      25,
      'Late break',
      NOW,
    );
    const sibling = create(source);
    const breakRows = (contest: Contest) =>
      computeSchedule(contest).filter((event) => event.label === 'Late break');

    expect(sibling.scheduleOverrides.gaps.map((gap) => gap.anchor)).toContain('show:7');
    expect(breakRows(sibling)).toHaveLength(0);
    expect(computeSchedule(sibling).length).toBeGreaterThan(0);
  });
});

describe('findSiblingZones', () => {
  const open = {
    id: 'open',
    identity: fullZone('1').identity,
  };
  const match = {
    id: 'match',
    archived: false,
    contestLevel: 'Zone',
    contestYear: '2027',
    classification: '4A',
    district: '20',
    zone: '2',
  };
  const ids = (found: { id: string }[]) => found.map((c) => c.id);

  it('finds the other zone', () => {
    expect(ids(findSiblingZones(open, [match]))).toEqual(['match']);
  });

  it('works from zone 2 back to zone 1', () => {
    const fromTwo = { id: 'open', identity: fullZone('2').identity };
    expect(ids(findSiblingZones(fromTwo, [{ ...match, zone: '1' }]))).toEqual(['match']);
  });

  it('returns the matching row itself, with its other fields', () => {
    const row = { ...match, name: 'Zone 2' };
    expect(findSiblingZones(open, [row])).toEqual([row]);
  });

  it.each([
    ['level', { contestLevel: 'District' }],
    ['year', { contestYear: '2028' }],
    ['classification', { classification: '5A' }],
    ['district', { district: '21' }],
    ['zone number', { zone: '3' }],
    ['same zone number', { zone: '1' }],
  ])('rejects a different %s', (_label, patch) => {
    expect(findSiblingZones(open, [{ ...match, ...patch }])).toEqual([]);
  });

  it('ignores archived contests', () => {
    expect(findSiblingZones(open, [{ ...match, archived: true }])).toEqual([]);
  });

  it('compares trimmed values', () => {
    const spaced = { ...match, contestYear: ' 2027 ', district: ' 20', zone: '2 ' };
    expect(ids(findSiblingZones(open, [spaced]))).toEqual(['match']);
    const openSpaced = {
      id: 'open',
      identity: { ...open.identity, contestYear: '2027 ', district: ' 20 ', zone: ' 1 ' },
    };
    expect(ids(findSiblingZones(openSpaced, [match]))).toEqual(['match']);
  });

  it('never matches on a blank district', () => {
    const blank = { id: 'open', identity: { ...open.identity, district: '  ' } };
    expect(findSiblingZones(blank, [{ ...match, district: '' }])).toEqual([]);
  });

  it('never matches when the open contest has no sibling number', () => {
    const noZone = { id: 'open', identity: { ...open.identity, zone: '' } };
    expect(findSiblingZones(noZone, [match])).toEqual([]);
    const zoneThree = { id: 'open', identity: { ...open.identity, zone: '3' } };
    expect(findSiblingZones(zoneThree, [match])).toEqual([]);
  });

  it('never matches a candidate with a blank zone', () => {
    expect(findSiblingZones(open, [{ ...match, zone: ' ' }])).toEqual([]);
  });

  it('ignores region and area', () => {
    const elsewhere = { id: 'open', identity: { ...open.identity, region: '9', area: '' } };
    expect(ids(findSiblingZones(elsewhere, [match]))).toEqual(['match']);
  });

  it('returns every match', () => {
    expect(ids(findSiblingZones(open, [match, { ...match, id: 'second' }]))).toEqual(['match', 'second']);
  });

  it("never matches the open contest's own stored row, which can lag a zone edit", () => {
    const stale = { ...match, id: 'open', zone: '2' };
    expect(findSiblingZones(open, [stale])).toEqual([]);
  });
});

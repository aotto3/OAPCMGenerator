import { describe, it, expect } from 'vitest';
import { contestSummaryFromRecord } from './contestStore';
import {
  contestDisplayName,
  createContest,
  effectiveContestTitle,
  serializeContest,
  withArchived,
  withDetails,
  withIdentity,
  withTitleOverride,
  type Contest,
} from '../model/contest';

/**
 * Builds the stored record for a contest exactly as saveContest does — including
 * the denormalized date/school fields. Used to fixture "current" records.
 */
function record(contest: Contest) {
  return {
    id: contest.id,
    name: effectiveContestTitle(contest), // mirrors saveContest (custom title or auto name)
    updatedAt: contest.updatedAt,
    contestDate: contest.details.contestDate,
    hostSchoolName: contest.identity.hostSchoolName,
    archived: contest.archived,
    contestLevel: contest.identity.contestLevel,
    classification: contest.identity.classification,
    contestYear: contest.identity.contestYear,
    payload: serializeContest(contest),
  };
}

/** A contest with a known date and host school. */
function contestWithDateAndSchool(): Contest {
  let c = createContest();
  c = withDetails(c, { contestDate: '2026-03-14' });
  c = withIdentity(c, { hostSchoolName: 'Westlake HS' });
  return c;
}

describe('contestSummaryFromRecord', () => {
  it('returns the denormalized date and host school from a current record', () => {
    const summary = contestSummaryFromRecord(record(contestWithDateAndSchool()));
    expect(summary.contestDate).toBe('2026-03-14');
    expect(summary.hostSchoolName).toBe('Westlake HS');
  });

  it('preserves empty denormalized fields without falling back to the payload', () => {
    // A contest with neither set stores '' for both; the summary must keep ''
    // (present-but-empty), not treat it as a missing pre-denormalization field.
    const summary = contestSummaryFromRecord(record(createContest()));
    expect(summary.contestDate).toBe('');
    expect(summary.hostSchoolName).toBe('');
  });

  it('falls back to parsing the payload for records saved before denormalization', () => {
    const contest = contestWithDateAndSchool();
    // Simulate an old record: the denormalized fields simply do not exist.
    const legacy = {
      id: contest.id,
      name: contestDisplayName(contest.identity),
      updatedAt: contest.updatedAt,
      payload: serializeContest(contest),
    };
    const summary = contestSummaryFromRecord(legacy);
    expect(summary.contestDate).toBe('2026-03-14');
    expect(summary.hostSchoolName).toBe('Westlake HS');
  });

  it('carries id, name, and updatedAt straight through', () => {
    const contest = contestWithDateAndSchool();
    const summary = contestSummaryFromRecord(record(contest));
    expect(summary.id).toBe(contest.id);
    expect(summary.name).toBe(contestDisplayName(contest.identity));
    expect(summary.updatedAt).toBe(contest.updatedAt);
  });

  it('shows the custom title as the summary name when one is set (PRD #143)', () => {
    const named = withTitleOverride(contestWithDateAndSchool(), 'My Big Contest');
    expect(contestSummaryFromRecord(record(named)).name).toBe('My Big Contest');
  });

  it('carries the denormalized archived flag from a current record', () => {
    expect(contestSummaryFromRecord(record(createContest())).archived).toBe(false);
    const archived = withArchived(createContest(), true);
    expect(contestSummaryFromRecord(record(archived)).archived).toBe(true);
  });

  it('falls back to the payload archived flag for records saved before the field existed', () => {
    const contest = withArchived(contestWithDateAndSchool(), true);
    // An old record predating the denormalized archived field: it simply is absent.
    const legacy = {
      id: contest.id,
      name: contestDisplayName(contest.identity),
      updatedAt: contest.updatedAt,
      contestDate: contest.details.contestDate,
      hostSchoolName: contest.identity.hostSchoolName,
      payload: serializeContest(contest),
    };
    expect(contestSummaryFromRecord(legacy).archived).toBe(true);
  });

  it('carries the denormalized sort keys (level, classification, year) from a current record', () => {
    const c = withIdentity(createContest(), { contestLevel: 'Area', classification: '3A', contestYear: '2027' });
    const summary = contestSummaryFromRecord(record(c));
    expect(summary.contestLevel).toBe('Area');
    expect(summary.classification).toBe('3A');
    expect(summary.contestYear).toBe('2027');
  });

  it('falls back to the payload for sort keys on records saved before those fields existed', () => {
    const c = withIdentity(createContest(), { contestLevel: 'Region', classification: '1A', contestYear: '2025' });
    const legacy = {
      id: c.id,
      name: contestDisplayName(c.identity),
      updatedAt: c.updatedAt,
      payload: serializeContest(c),
    };
    const summary = contestSummaryFromRecord(legacy);
    expect(summary.contestLevel).toBe('Region');
    expect(summary.classification).toBe('1A');
    expect(summary.contestYear).toBe('2025');
  });
});

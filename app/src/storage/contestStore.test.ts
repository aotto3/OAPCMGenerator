import { describe, it, expect } from 'vitest';
import { contestSummaryFromRecord } from './contestStore';
import {
  contestDisplayName,
  createContest,
  serializeContest,
  withDetails,
  withIdentity,
  type Contest,
} from '../model/contest';

/**
 * Builds the stored record for a contest exactly as saveContest does — including
 * the denormalized date/school fields. Used to fixture "current" records.
 */
function record(contest: Contest) {
  return {
    id: contest.id,
    name: contestDisplayName(contest.identity),
    updatedAt: contest.updatedAt,
    contestDate: contest.details.contestDate,
    hostSchoolName: contest.identity.hostSchoolName,
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
});

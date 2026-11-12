import { describe, expect, it } from 'vitest';
import { createContest, withAdjudicator, withDetails, type Contest } from '../model/contest';
import type { RosterContest } from './roster';
import {
  applySubmission,
  applySubmissions,
  blankAnswers,
  groupContests,
  readGroup,
  writeGroup,
  type JudgeSubmission,
} from './submission';

const NOW = '2026-11-01T12:00:00.000Z';
const LATER = '2026-11-20T12:00:00.000Z';

function contest(id: string): Contest {
  let c = createContest({ id, now: NOW });
  c = withDetails(c, { numJudges: 2 }, NOW);
  c = withAdjudicator(
    c,
    0,
    {
      name: 'Jane Judge',
      email: 'Jane@X.org',
      ttaoContractDate: '2026-10-01',
      paymentPaperworkSentDate: '2026-10-02',
      mailingAddress: 'old address',
    },
    NOW,
  );
  return withAdjudicator(c, 1, { name: 'Sam Lee', email: 'sam@x.org', mailingAddress: 'Sam address' }, NOW);
}

function submission(submittedAt: string, patch: Partial<JudgeSubmission['answers']> = {}): JudgeSubmission {
  return {
    email: 'jane@x.org',
    submittedAt,
    answers: {
      ...blankAnswers(['c1']),
      cellPhone: '512-555-0100',
      mailingAddress: '1 Main St',
      dietary: 'vegetarian',
      needsPower: true,
      bio: 'A bio',
      notes: 'Arriving late',
      contests: { c1: { hotelBefore: true, hotelAfter: false, requestingFlight: true } },
      ...patch,
    },
  };
}

describe('applySubmission', () => {
  it("writes the judge's answers into the matching row and stamps it", () => {
    const next = applySubmission(contest('c1'), submission('2026-11-10T00:00:00.000Z'), LATER);
    const j = next.adjudicators[0];
    expect(j).toMatchObject({
      cellPhone: '512-555-0100',
      mailingAddress: '1 Main St',
      dietary: 'vegetarian',
      needsPower: true,
      bio: 'A bio',
      judgeNotes: 'Arriving late',
      needsHotel: true,
      hotelNights: { before: true, after: false },
      requestingFlight: true,
      questionnaireUpdatedAt: '2026-11-10T00:00:00.000Z',
    });
    expect(next.updatedAt).toBe(LATER);
  });

  it('never touches name, email, contracting dates, or other judges', () => {
    const next = applySubmission(contest('c1'), submission('2026-11-10T00:00:00.000Z'), LATER);
    expect(next.adjudicators[0]).toMatchObject({
      name: 'Jane Judge',
      email: 'Jane@X.org',
      ttaoContractDate: '2026-10-01',
      paymentPaperworkSentDate: '2026-10-02',
    });
    expect(next.adjudicators[1].mailingAddress).toBe('Sam address');
  });

  it('turns the hotel need off when no nights are chosen', () => {
    let c = withAdjudicator(contest('c1'), 0, { needsHotel: true, hotelNights: { before: true, after: true } }, NOW);
    c = applySubmission(
      c,
      submission('2026-11-10T00:00:00.000Z', {
        contests: { c1: { hotelBefore: false, hotelAfter: false, requestingFlight: false } },
      }),
      LATER,
    );
    expect(c.adjudicators[0].needsHotel).toBe(false);
  });

  it('is a no-op for the same submission twice, an older one, another contest, or an inactive slot', () => {
    const once = applySubmission(contest('c1'), submission('2026-11-10T00:00:00.000Z'), LATER);
    expect(applySubmission(once, submission('2026-11-10T00:00:00.000Z'), '2026-12-01T00:00:00.000Z')).toBe(once);
    expect(applySubmission(once, submission('2026-11-09T00:00:00.000Z'), '2026-12-01T00:00:00.000Z')).toBe(once);
    const other = contest('c2');
    expect(applySubmission(other, submission('2026-11-10T00:00:00.000Z'), LATER)).toBe(other);
    const hidden = withDetails(contest('c1'), { numJudges: 1 }, NOW);
    const samOnly = { ...submission('2026-11-10T00:00:00.000Z'), email: 'sam@x.org' };
    expect(applySubmission(hidden, samOnly, LATER)).toBe(hidden);
  });

  it('a newer resubmission replaces the earlier answers', () => {
    const next = applySubmissions(
      contest('c1'),
      [submission('2026-11-12T00:00:00.000Z', { dietary: 'vegan' }), submission('2026-11-10T00:00:00.000Z')],
      LATER,
    );
    expect(next.adjudicators[0].dietary).toBe('vegan');
    expect(next.adjudicators[0].questionnaireUpdatedAt).toBe('2026-11-12T00:00:00.000Z');
  });
});

const rc = (id: string, level: string, date: string): RosterContest => ({
  id,
  title: id,
  level,
  date,
  host: '',
  cmEmail: '',
});

describe('groupContests', () => {
  it('pairs back-to-back Zone contests and leaves everything else single', () => {
    const groups = groupContests([
      rc('z1', 'Zone', '2027-03-04'),
      rc('z2', 'Zone', '2027-03-05'),
      rc('d', 'District', '2027-03-25'),
      rc('bi', 'BiDistrict', '2027-03-26'),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['zonePair', 'single', 'single']);
  });

  it('does not pair Zones on non-consecutive or missing dates', () => {
    expect(groupContests([rc('z1', 'Zone', '2027-03-04'), rc('z2', 'Zone', '2027-03-06')]).map((g) => g.kind)).toEqual([
      'single',
      'single',
    ]);
    expect(groupContests([rc('z1', 'Zone', ''), rc('z2', 'Zone', '')]).map((g) => g.kind)).toEqual(['single', 'single']);
  });

  it('pairs across a month boundary', () => {
    expect(groupContests([rc('z1', 'Zone', '2027-02-28'), rc('z2', 'Zone', '2027-03-01')])[0].kind).toBe('zonePair');
  });
});

describe('readGroup / writeGroup', () => {
  const pair = groupContests([rc('z1', 'Zone', '2027-03-04'), rc('z2', 'Zone', '2027-03-05')])[0];
  const single = groupContests([rc('d', 'District', '2027-03-25')])[0];

  it('saves a Zone pair\'s "between" night as the first zone\'s after and the second\'s before', () => {
    expect(writeGroup(pair, { before: true, between: true, after: false, requestingFlight: true })).toEqual({
      z1: { hotelBefore: true, hotelAfter: true, requestingFlight: true },
      z2: { hotelBefore: true, hotelAfter: false, requestingFlight: true },
    });
  });

  it('round-trips group answers', () => {
    const answers = { before: false, between: true, after: true, requestingFlight: false };
    expect(readGroup(pair, writeGroup(pair, answers))).toEqual(answers);
    const one = { before: true, between: false, after: true, requestingFlight: true };
    expect(readGroup(single, writeGroup(single, one))).toEqual(one);
  });

  it('reads blank answers for contests with none saved', () => {
    expect(readGroup(pair, {})).toEqual({ before: false, between: false, after: false, requestingFlight: false });
  });
});

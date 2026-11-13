/**
 * App/server contract for the judge questionnaire (RFC #270, #275).
 *
 * Imports the server's pure validator module by relative path. Test-only: no
 * production code on either side may import across workspaces, since each
 * Railway service builds only its own.
 */
import { describe, expect, it } from 'vitest';
import * as server from '../../../server/src/judgeRoster';
import { createContest, withCmInfo, withDetails, type Contest } from '../model/contest';
import { setJudge } from '../model/judgePanel';
import { ANSWER_LIMITS, MAX_ROSTER_FIELD_LENGTH } from './limits';
import { buildJudgeRoster } from './roster';
import { blankAnswers, type SubmissionAnswers } from './submission';

const NOW = '2026-11-01T12:00:00.000Z';
const TODAY = '2027-03-01';
const LONG = 'L'.repeat(MAX_ROSTER_FIELD_LENGTH + 100);

function contest(id: string, date: string, judges: { name: string; email: string }[]): Contest {
  let c = createContest({
    id,
    now: NOW,
    identity: { contestYear: '2027', classification: '5A', contestLevel: 'Zone', district: '20', hostSchoolName: 'Friendswood HS' },
  });
  c = withDetails(c, { contestDate: date, numJudges: 3 }, NOW);
  c = withCmInfo(c, { email: 'cm@example.org' }, NOW);
  judges.forEach((j, i) => (c = setJudge(c, i, { name: j.name, email: j.email }, NOW)));
  return c;
}

describe('questionnaire limits match the server', () => {
  it('answer caps are equal', () => {
    expect(ANSWER_LIMITS).toEqual(server.ANSWER_LIMITS);
  });

  it('roster field cap is equal', () => {
    expect(MAX_ROSTER_FIELD_LENGTH).toBe(server.MAX_ROSTER_FIELD_LENGTH);
  });
});

describe('app-built rosters pass the server validator', () => {
  it('trims an over-long title and judge name, omits an invalid email, and is accepted', () => {
    const titled = { ...contest('c1', '2027-03-04', [
      { name: LONG, email: 'long.name@x.org' },
      { name: 'Bad Email', email: 'bad email@x' },
      { name: 'Jane', email: 'Jane@X.org' },
    ]), titleOverride: LONG };
    const plain = contest('c2', '2027-03-05', [{ name: 'Jane', email: 'jane@x.org' }]);
    const roster = buildJudgeRoster([titled, plain], TODAY);

    const parsed = server.parseRoster(JSON.parse(JSON.stringify(roster)));
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(roster);
    expect(parsed!.contests[0].title).toHaveLength(MAX_ROSTER_FIELD_LENGTH);
    expect(parsed!.judges.find((j) => j.email === 'long.name@x.org')!.name).toHaveLength(MAX_ROSTER_FIELD_LENGTH);
    expect(parsed!.judges.map((j) => j.email)).not.toContain('bad email@x');
    expect(parsed!.judges.map((j) => j.name)).not.toContain('Bad Email');
    expect(server.findJudge(parsed!, 'JANE@x.org')!.contests.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('an empty roster is accepted', () => {
    expect(server.parseRoster(buildJudgeRoster([], TODAY))).toEqual({ contests: [], judges: [] });
  });
});

describe('answers at the caps pass the server validator', () => {
  it('accepts every text answer at its cap', () => {
    const answers: SubmissionAnswers = {
      ...blankAnswers(['c1', 'c2']),
      cellPhone: '1'.repeat(ANSWER_LIMITS.cellPhone),
      mailingAddress: 'a'.repeat(ANSWER_LIMITS.mailingAddress),
      dietary: 'd'.repeat(ANSWER_LIMITS.dietary),
      bio: 'b'.repeat(ANSWER_LIMITS.bio),
      notes: 'n'.repeat(ANSWER_LIMITS.notes),
    };
    const parsed = server.parseAnswers(JSON.parse(JSON.stringify(answers)), ['c1', 'c2']);
    expect(parsed).toEqual(answers);
  });

  it('refuses one character over any cap (the caps are the real limits)', () => {
    for (const key of Object.keys(ANSWER_LIMITS) as (keyof typeof ANSWER_LIMITS)[]) {
      const answers = { ...blankAnswers(['c1']), [key]: 'x'.repeat(ANSWER_LIMITS[key] + 1) };
      expect(server.parseAnswers(answers, ['c1'])).toBeNull();
    }
  });
});

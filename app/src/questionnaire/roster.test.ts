import { describe, expect, it } from 'vitest';
import {
  createContest,
  withAdjudicator,
  withArchived,
  withCmInfo,
  withDetails,
  type Contest,
} from '../model/contest';
import { buildJudgeRoster } from './roster';

const NOW = '2026-11-01T12:00:00.000Z';
const TODAY = '2027-03-01';

function contest(id: string, date: string, judges: { name: string; email?: string }[] = []): Contest {
  let c = createContest({
    id,
    now: NOW,
    identity: { contestYear: '2027', classification: '5A', contestLevel: 'District', district: '20', hostSchoolName: 'Friendswood HS' },
  });
  c = withDetails(c, { contestDate: date, numJudges: 3 }, NOW);
  c = withCmInfo(c, { email: 'cm@example.org' }, NOW);
  judges.forEach((j, i) => (c = withAdjudicator(c, i, { name: j.name, email: j.email ?? '' }, NOW)));
  return c;
}

describe('buildJudgeRoster', () => {
  it('lists an upcoming contest with its title, level, date, host, and CM email', () => {
    const roster = buildJudgeRoster([contest('c1', '2027-03-25', [{ name: 'Jane', email: 'jane@x.org' }])], TODAY);
    expect(roster.contests).toEqual([
      {
        id: 'c1',
        title: '2027 — 5A District 20 OAP',
        level: 'District',
        date: '2027-03-25',
        host: 'Friendswood HS',
        cmEmail: 'cm@example.org',
      },
    ]);
    expect(roster.judges).toEqual([{ email: 'jane@x.org', name: 'Jane', contestIds: ['c1'] }]);
  });

  it('includes a contest dated today and drops one already past', () => {
    const roster = buildJudgeRoster(
      [
        contest('today', TODAY, [{ name: 'A', email: 'a@x.org' }]),
        contest('past', '2027-02-28', [{ name: 'B', email: 'b@x.org' }]),
      ],
      TODAY,
    );
    expect(roster.contests.map((c) => c.id)).toEqual(['today']);
    expect(roster.judges.map((j) => j.email)).toEqual(['a@x.org']);
  });

  it('keeps an undated contest (still being planned) and drops archived ones', () => {
    const roster = buildJudgeRoster(
      [
        contest('undated', '', [{ name: 'A', email: 'a@x.org' }]),
        withArchived(contest('archived', '2027-04-01', [{ name: 'B', email: 'b@x.org' }]), true, NOW),
      ],
      TODAY,
    );
    expect(roster.contests.map((c) => c.id)).toEqual(['undated']);
  });

  it('leaves out judges with no email and judges beyond the active count', () => {
    let c = contest('c1', '2027-03-25', [
      { name: 'No Email' },
      { name: 'Active', email: 'active@x.org' },
      { name: 'Hidden', email: 'hidden@x.org' },
    ]);
    c = withDetails(c, { numJudges: 2 }, NOW);
    const roster = buildJudgeRoster([c], TODAY);
    expect(roster.judges.map((j) => j.email)).toEqual(['active@x.org']);
  });

  it('normalizes emails and treats the same email in two contests as one judge', () => {
    const roster = buildJudgeRoster(
      [
        contest('zone2', '2027-03-05', [{ name: 'Jane Judge', email: ' Jane@X.org ' }]),
        contest('zone1', '2027-03-04', [{ name: 'Jane Judge', email: 'jane@x.org' }]),
      ],
      TODAY,
    );
    expect(roster.judges).toEqual([{ email: 'jane@x.org', name: 'Jane Judge', contestIds: ['zone1', 'zone2'] }]);
  });

  it('orders contests by date with undated contests last', () => {
    const roster = buildJudgeRoster(
      [contest('late', '2027-04-01'), contest('undated', ''), contest('early', '2027-03-04')],
      TODAY,
    );
    expect(roster.contests.map((c) => c.id)).toEqual(['early', 'late', 'undated']);
  });

  it('uses the custom title when one is set', () => {
    const c = { ...contest('c1', '2027-03-25'), titleOverride: 'Zones Day 1' };
    expect(buildJudgeRoster([c], TODAY).contests[0].title).toBe('Zones Day 1');
  });

  it('carries no private judge fields', () => {
    let c = contest('c1', '2027-03-25', [{ name: 'Jane', email: 'jane@x.org' }]);
    c = withAdjudicator(c, 0, { mailingAddress: '1 Main', cellPhone: '555', bio: 'Bio', dietary: 'Vegan' }, NOW);
    const text = JSON.stringify(buildJudgeRoster([c], TODAY));
    for (const secret of ['1 Main', '555', 'Bio', 'Vegan']) expect(text).not.toContain(secret);
  });
});

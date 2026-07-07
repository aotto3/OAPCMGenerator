/**
 * Shared fixture contest for the Slice 8 document golden tests.
 *
 * A fully-populated contest with FIXED timestamps and out-of-form-order
 * performance draws, so every generator's output is byte-stable at the XML level
 * (see goldenFile.ts) and the performance-order sort is exercised. Mirrors the
 * fixtureContest in letter.test.ts; extracted here because seven documents share
 * it. Any date a document stamps is injected via ctx.now in the test, never read
 * from the clock.
 */

import {
  createContest,
  withAdjudicator,
  withCmInfo,
  withDetails,
  withDirector,
  withIdentity,
  withSchool,
  type Contest,
} from '../../model/contest';

/** Fixed creation timestamp — keeps createdAt/updatedAt out of the golden's way. */
export const FIXTURE_NOW = '2026-07-05T12:00:00.000Z';

/** Injected "letter date" for documents that stamp today — a stable July 6, 2026. */
export const FIXTURE_LETTER_DATE = new Date(2026, 6, 6);

/** A fully-populated contest — the documents read nearly every field. */
export function fixtureContest(): Contest {
  let c = createContest({ id: 'slice8-doc-fixture', now: FIXTURE_NOW, identity: { districtNumber: '20' } });
  c = withIdentity(
    c,
    {
      contestYear: '2026',
      classification: '5A',
      contestLevel: 'District',
      hostSchoolName: 'Sharpstown High School',
      hostVenueName: 'Performing Arts Center',
      hostAddress: '7504 Bissonnet St, Houston, TX 77074',
    },
    FIXTURE_NOW,
  );
  c = withCmInfo(c, { techContact: 'Chris Technician' }, FIXTURE_NOW);
  c = withDetails(
    c,
    {
      contestDate: '2026-03-21',
      directorsMeetingTime: '9:00 AM',
      firstShowTime: '10:00 AM',
      critiqueFormat: 'after_all',
      numJudges: 3,
      rehearsalDate1: '2026-03-19',
      rehearsalDate2: '2026-03-20',
      entrySystemDeadline: '2026-03-11',
      lightCueDeadlineDate: '2026-03-11',
      lightCueDeadlineTime: '5:00 PM',
      admissionFee: '10',
      rehearsalLengthMinutes: 90,
      bidcContestDate: '2026-03-28',
    },
    FIXTURE_NOW,
  );

  const judges = [
    { name: 'Dr. Jane Judge', mailingAddress: '100 Main St, Austin, TX 78701' },
    { name: 'Prof. John Critic', mailingAddress: '200 Oak Ave, Dallas, TX 75201' },
    { name: 'Ms. Mary Adjudicator', mailingAddress: '300 Elm Blvd, San Antonio, TX 78205' },
  ];
  judges.forEach((j, i) => (c = withAdjudicator(c, i, j, FIXTURE_NOW)));

  const names = ['Alpha HS', 'Bravo HS', 'Charlie HS', 'Delta HS', 'Echo HS', 'Foxtrot HS'];
  // "Romeo & Juliet" exercises XML escaping through every school table.
  const plays = ['Romeo & Juliet', 'The Crucible', 'Antigone', 'Metamorphoses', 'Almost, Maine', 'Radium Girls'];
  const orders = [3, 1, 5, 2, 6, 4]; // out of form order, so sorting is exercised
  names.forEach((name, i) => {
    c = withSchool(c, i, { name, playTitle: plays[i], performanceOrder: orders[i] }, FIXTURE_NOW);
    c = withDirector(c, i, 0, { name: `${name} Director`, email: `dir${i + 1}@example.com` }, FIXTURE_NOW);
  });
  return c;
}

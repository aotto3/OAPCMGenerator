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
  addAwardWinner,
  addDirector,
  addRosterMember,
  createContest,
  setAdvancing,
  setAlternate,
  setBestCrew,
  setOutstandingTechnician,
  withAdjudicator,
  withCmInfo,
  withDetails,
  withDirector,
  withIdentity,
  withNextContest,
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
  // Contracting milestones (PRD #67) with a deliberate mix so the Adjudicator
  // Info Sheet golden exercises both renderings: judge 1 all done (distinct
  // dates), judge 2 partly done, judge 3 all pending.
  c = withAdjudicator(
    c,
    0,
    { ttaoContractDate: '2026-02-15', paymentPaperworkSentDate: '2026-03-01', paymentPaperworkReturnedDate: '2026-03-10' },
    FIXTURE_NOW,
  );
  c = withAdjudicator(c, 1, { ttaoContractDate: '2026-02-20', paymentPaperworkSentDate: '2026-03-05' }, FIXTURE_NOW);

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

/**
 * The shared fixture with recorded results + a next-level block (PRD #66), for
 * the Awards Script "filled" golden. School indices: 0 Alpha / 1 Bravo /
 * 2 Charlie / 3 Delta / 4 Echo / 5 Foxtrot.
 *
 * Advancing is entered in RANK order [3, 1, 5] (Delta 1st, Bravo 2nd, Foxtrot
 * 3rd) precisely so the golden proves the derivation DROPS rank — the script
 * announces them re-sorted into form order (Bravo, Delta, Foxtrot) with no
 * placement. The alternate is Alpha HS, whose "Romeo & Juliet" also exercises XML
 * escaping through the filled advancing path.
 */
export function fixtureContestWithResults(): Contest {
  let c = fixtureContest();
  c = setAdvancing(c, [3, 1, 5], FIXTURE_NOW); // rank order, deliberately not form order
  c = setAlternate(c, 0, FIXTURE_NOW); // Alpha HS (Romeo & Juliet)

  c = addAwardWinner(c, 'bestPerformers', { studentName: 'Jordan Lee', schoolIndex: 1 }, FIXTURE_NOW);
  c = addAwardWinner(c, 'bestPerformers', { studentName: 'Sam Rivera', schoolIndex: 3 }, FIXTURE_NOW);

  c = addAwardWinner(c, 'allStarCast', { studentName: 'Alex Kim', schoolIndex: 0 }, FIXTURE_NOW);
  c = addAwardWinner(c, 'allStarCast', { studentName: 'Taylor Cruz', schoolIndex: 2 }, FIXTURE_NOW);
  c = addAwardWinner(c, 'allStarCast', { studentName: 'Morgan Diaz', schoolIndex: 4 }, FIXTURE_NOW);

  c = addAwardWinner(c, 'honorableMention', { studentName: 'Casey Park', schoolIndex: 5 }, FIXTURE_NOW);
  c = addAwardWinner(c, 'honorableMention', { studentName: 'Riley Fox', schoolIndex: 1 }, FIXTURE_NOW);

  c = setOutstandingTechnician(c, 0, 'Pat Nguyen', FIXTURE_NOW); // Alpha HS
  c = setOutstandingTechnician(c, 2, 'Drew Carter', FIXTURE_NOW); // Charlie HS

  c = setBestCrew(c, 4, FIXTURE_NOW); // Echo HS

  c = withNextContest(
    c,
    {
      date: '2026-03-28',
      location: 'Regional Arts Center, Austin',
      cmName: 'Dana Host',
      cmEmail: 'dana@example.com',
      cmPhone: '512-555-0142',
    },
    FIXTURE_NOW,
  );
  return c;
}

/**
 * The shared fixture with company rosters, production metadata, and bios (PRD #68),
 * for the Audience Program's "full" golden. Chosen to exercise every branch of the
 * program builder:
 *
 * - Bravo HS (index 1, performance slot 1 → first school page): a full PLAY with
 *   author/publisher/setting/runtime/music, TWO directors ("Directed by A, B"), and
 *   a cast + crew + alternate roster.
 * - Alpha HS (index 0, slot 3): a SCENES production of "Romeo & Juliet" — proves the
 *   "Presents scenes from {title}" title line AND XML-escaping of the "&".
 * - Judges 1 and 2 have bios; judge 3 does NOT (proving a blank bio is skipped). The
 *   Contest Manager has a bio (proving the CM entry renders after the adjudicators).
 *
 * Every other school keeps the base fixture's blank company data, so the same golden
 * also covers pages that degrade gracefully to just a name + plain title.
 */
export function fixtureContestWithCompany(): Contest {
  let c = fixtureContest();

  // Bios: two adjudicators + the CM; judge 3 deliberately left blank.
  c = withAdjudicator(c, 0, { bio: 'Dr. Jane Judge has directed competitive theatre for 20 years.' }, FIXTURE_NOW);
  c = withAdjudicator(c, 1, { bio: 'Prof. John Critic teaches dramatic literature at State University.' }, FIXTURE_NOW);
  c = withCmInfo(c, { bio: 'Allen Otto is a longtime UIL contest manager and theatre educator.' }, FIXTURE_NOW);

  // Bravo HS — a full play with two directors and a complete roster.
  c = withSchool(
    c,
    1,
    {
      productionType: 'play',
      author: 'Arthur Miller',
      publisher: 'Dramatists Play Service',
      setting: 'Salem, Massachusetts, 1692',
      runtime: '40 minutes',
      musicCredits: 'Original underscore by Sam Composer',
    },
    FIXTURE_NOW,
  );
  c = addDirector(c, 1, FIXTURE_NOW);
  c = withDirector(c, 1, 1, { name: 'Bravo HS Assistant Director', email: 'asst@example.com' }, FIXTURE_NOW);
  c = addRosterMember(c, 1, { name: 'Jordan Lee', role: 'John Proctor', category: 'cast' }, FIXTURE_NOW);
  c = addRosterMember(c, 1, { name: 'Riley Fox', role: 'Abigail Williams', category: 'cast' }, FIXTURE_NOW);
  c = addRosterMember(c, 1, { name: 'Sam Rivera', role: 'Stage Manager', category: 'crew' }, FIXTURE_NOW);
  c = addRosterMember(c, 1, { name: 'Alexis Stone', role: 'Lighting Designer', category: 'crew' }, FIXTURE_NOW);
  c = addRosterMember(c, 1, { name: 'Casey Park', role: '', category: 'alternate' }, FIXTURE_NOW);

  // Alpha HS — a Scenes production; "Romeo & Juliet" exercises escaping + scenes line.
  c = withSchool(c, 0, { productionType: 'scenes', author: 'William Shakespeare', publisher: 'Public Domain' }, FIXTURE_NOW);
  c = addRosterMember(c, 0, { name: 'Taylor Cruz', role: 'Juliet', category: 'cast' }, FIXTURE_NOW);

  return c;
}

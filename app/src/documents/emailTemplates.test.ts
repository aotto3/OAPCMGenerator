/**
 * Unit tests for the email draft composer templates (Slice 11).
 *
 * Each template is a pure function of the Contest record, so these assert
 * OBSERVABLE outputs against the shared fixture (3 judges, 6 schools): the
 * subject line, that contest data is substituted in, the judges template's
 * performance-order show list and "meeting − 20" arrival time, and that the
 * advancing picker addresses only the checked schools' directors. Internals
 * (exact whitespace, private helpers) are not asserted — behavior is.
 */

import { describe, expect, it } from 'vitest';
import { withAdjudicator, withCmInfo, withDetails, withIdentity } from '../model/contest';
import { fixtureContest, FIXTURE_NOW } from './__fixtures__/fixtureContest';
import {
  advancingEmail,
  announcementEmail,
  dayBeforeEmail,
  deadlineEmail,
  judgeNeedsEmail,
  judgesEmail,
} from './emailTemplates';

/** Fixture contest name — every template opens with this. */
const CONTEST_NAME = 'UIL 5A District 20 One-Act Play Contest';

describe('announcementEmail', () => {
  it('has the contest-information subject', () => {
    expect(announcementEmail(fixtureContest()).subject).toBe(`${CONTEST_NAME} — Contest Information`);
  });

  it('substitutes contest name, level, date, venue, address, times, deadline and CM contact', () => {
    const { body } = announcementEmail(fixtureContest());
    expect(body).toContain('Dear District Directors,');
    expect(body).toContain(CONTEST_NAME);
    expect(body).toContain('held on Saturday, March 21, 2026'); // fmtDate
    expect(body).toContain('Performing Arts Center');
    expect(body).toContain('7504 Bissonnet St, Houston, TX 77074');
    expect(body).toContain('Directors’ Meeting: 9:00 AM');
    expect(body).toContain('First Performance: 10:00 AM');
    expect(body).toContain('submit your entries by March 11, 2026'); // fmtDateShort
    expect(body).toContain('aotto3@gmail.com or 281-777-8672');
    expect(body).toMatch(/Sincerely,\nAllen Otto\nContest Manager$/);
  });

  it('falls back to placeholders when fields are blank', () => {
    let c = fixtureContest();
    c = withIdentity(c, { hostVenueName: '', hostAddress: '' }, FIXTURE_NOW);
    c = withDetails(c, { contestDate: '', directorsMeetingTime: '', firstShowTime: '', entrySystemDeadline: '' }, FIXTURE_NOW);
    const { body } = announcementEmail(c);
    expect(body).toContain('[Venue TBD]');
    expect(body).toContain('[Address TBD]');
    expect(body).toContain('[Contest Date TBD]');
    expect(body).toContain('Directors’ Meeting: [TBD]');
  });

  it('omits the phone clause when the CM phone is blank', () => {
    const c = withCmInfo(fixtureContest(), { phone: '' }, FIXTURE_NOW);
    const { body } = announcementEmail(c);
    expect(body).toContain('please contact me at aotto3@gmail.com.');
    expect(body).not.toContain(' or ');
  });
});

describe('deadlineEmail', () => {
  it('has the deadline subject and lists both deadlines', () => {
    const { subject, body } = deadlineEmail(fixtureContest());
    expect(subject).toBe(`${CONTEST_NAME} — Entry Deadline Reminder`);
    expect(body).toContain('•  Entry Deadline: March 11, 2026');
    expect(body).toContain('•  Light Cue Submission Deadline: March 11, 2026 by 5:00 PM');
  });
});

describe('dayBeforeEmail', () => {
  it('has the tomorrow subject and short contest date', () => {
    const { subject, body } = dayBeforeEmail(fixtureContest());
    expect(subject).toBe(`${CONTEST_NAME} — Tomorrow’s Contest`);
    expect(body).toContain('is tomorrow, March 21, 2026.'); // fmtDateShort, no weekday
    expect(body).toContain('Venue: Performing Arts Center');
    expect(body).toContain('First Performance: 10:00 AM');
  });
});

describe('judgesEmail', () => {
  it('has the judge-information subject', () => {
    expect(judgesEmail(fixtureContest()).subject).toBe(`${CONTEST_NAME} — Judge Information`);
  });

  it('lists shows in performance order with play titles', () => {
    const { body } = judgesEmail(fixtureContest());
    // Fixture draw orders: Bravo=1, Delta=2, Alpha=3, Foxtrot=4, Charlie=5, Echo=6.
    const listing = body.slice(body.indexOf('1. '), body.indexOf('\n\nCritiques'));
    expect(listing).toBe(
      '1. Bravo HS — The Crucible\n' +
        '2. Delta HS — Metamorphoses\n' +
        '3. Alpha HS — Romeo & Juliet\n' +
        '4. Foxtrot HS — Radium Girls\n' +
        '5. Charlie HS — Antigone\n' +
        '6. Echo HS — Almost, Maine',
    );
  });

  it('asks judges to arrive 20 minutes before the directors meeting', () => {
    // Fixture directors meeting is 9:00 AM → arrive by 8:40 AM.
    const { body } = judgesEmail(fixtureContest());
    expect(body).toContain('begins promptly at 9:00 AM');
    expect(body).toContain('please plan to arrive by 8:40 AM');
  });

  it('reflects the after_each critique format', () => {
    const c = withDetails(fixtureContest(), { critiqueFormat: 'after_each' }, FIXTURE_NOW);
    expect(judgesEmail(c).body).toContain('will be held after each show.');
  });

  it('reflects the after_all critique format', () => {
    expect(judgesEmail(fixtureContest()).body).toContain('will be held after all shows.');
  });

  it('falls back to prose arrival when the meeting time is blank', () => {
    const c = withDetails(fixtureContest(), { directorsMeetingTime: '' }, FIXTURE_NOW);
    expect(judgesEmail(c).body).toContain('[at least 20 minutes before the Directors’ Meeting]');
  });

  it('does not leak the critique assignment into the email', () => {
    // Judges must not learn the draw ahead of time (#23 deferred clause, decided out).
    expect(judgesEmail(fixtureContest()).body).not.toMatch(/Judge \d+ \(/);
  });
});

describe('judgeNeedsEmail', () => {
  it('opens with the contest name and the needs preamble', () => {
    const { subject, body } = judgeNeedsEmail(fixtureContest());
    expect(subject).toBe(`${CONTEST_NAME} — Judge Needs`);
    expect(body.startsWith(`For the ${CONTEST_NAME}, the judges' needs are as follows:`)).toBe(true);
  });

  it('lists all three categories for a judge with every need set', () => {
    const c = withAdjudicator(
      fixtureContest(),
      0,
      { name: 'Dr. Jane Judge', needsHotel: true, hotelNights: 2, dietary: 'vegetarian', needsPower: true },
      FIXTURE_NOW,
    );
    const { body } = judgeNeedsEmail(c);
    expect(body).toContain('Dr. Jane Judge:');
    expect(body).toContain('• Hotel: 2 nights');
    expect(body).toContain('• Food/Dietary: vegetarian');
    expect(body).toContain('• Power: yes — power needed at the judge table');
  });

  it('reads "none" for every category a judge does not need', () => {
    // A single judge with no needs set (fixture judges default to no needs).
    const c = withDetails(fixtureContest(), { numJudges: 1 }, FIXTURE_NOW);
    const { body } = judgeNeedsEmail(c);
    expect(body).toContain('• Hotel: none');
    expect(body).toContain('• Food/Dietary: none');
    expect(body).toContain('• Power: none');
  });

  it('lists only the active judges (per numJudges)', () => {
    let c = withDetails(fixtureContest(), { numJudges: 2 }, FIXTURE_NOW);
    c = withAdjudicator(c, 2, { name: 'Ms. Mary Adjudicator' }, FIXTURE_NOW);
    const { body } = judgeNeedsEmail(c);
    expect(body).toContain('Dr. Jane Judge:');
    expect(body).toContain('Prof. John Critic:');
    expect(body).not.toContain('Ms. Mary Adjudicator:'); // judge 3 hidden at numJudges = 2
  });

  it('falls back to "Judge N" for a blank judge name', () => {
    let c = withDetails(fixtureContest(), { numJudges: 1 }, FIXTURE_NOW);
    c = withAdjudicator(c, 0, { name: '' }, FIXTURE_NOW);
    expect(judgeNeedsEmail(c).body).toContain('Judge 1:');
  });

  it('uses a singular "night" for a one-night hotel stay', () => {
    const c = withDetails(
      withAdjudicator(fixtureContest(), 0, { needsHotel: true, hotelNights: 1 }, FIXTURE_NOW),
      { numJudges: 1 },
      FIXTURE_NOW,
    );
    expect(judgeNeedsEmail(c).body).toContain('• Hotel: 1 night');
  });
});

describe('advancingEmail', () => {
  it('has the post-contest evaluation subject', () => {
    expect(advancingEmail(fixtureContest(), [0]).subject).toBe(`${CONTEST_NAME} — Post-Contest Evaluation`);
  });

  it('addresses only the checked schools’ directors', () => {
    // Schools in form order: index 0 = Alpha (dir1@), 3 = Delta (dir4@).
    const { to } = advancingEmail(fixtureContest(), [0, 3]);
    expect(to).toEqual(['dir1@example.com', 'dir4@example.com']);
  });

  it('includes every director email of a multi-director school, blanks skipped', () => {
    let c = fixtureContest();
    // Give Alpha (index 0) a second director and a blank third.
    c = {
      ...c,
      schools: c.schools.map((s, i) =>
        i === 0
          ? { ...s, directors: [...s.directors, { name: 'Co Director', email: 'co@example.com' }, { name: 'Blank', email: '' }] }
          : s,
      ),
    };
    const { to } = advancingEmail(c, [0]);
    expect(to).toEqual(['dir1@example.com', 'co@example.com']);
  });

  it('returns an empty recipient list when no schools are checked', () => {
    expect(advancingEmail(fixtureContest(), []).to).toEqual([]);
  });

  it('ignores out-of-range indices', () => {
    expect(advancingEmail(fixtureContest(), [99]).to).toEqual([]);
  });

  it('carries the CM sign-off from the contest record', () => {
    const { body } = advancingEmail(fixtureContest(), [0]);
    expect(body).toContain('Play with love,\nAllen Otto\n281-777-8672\nwww.allenotto.com');
    expect(body).toContain('[PASTE EVALUATION LINK HERE]');
  });
});

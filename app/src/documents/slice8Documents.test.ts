/**
 * Golden-file + content tests for the seven Slice 8 Word documents.
 *
 * Each document is built from the SHARED fixture contest (fixed timestamps,
 * injected letter date) and compared to an approved golden archive
 * (content-normalized — see goldenFile.ts). Every golden test is paired with
 * content-level assertions that unzip word/document.xml and assert the right
 * names / dates / orderings appear, so intent survives a golden regeneration.
 */

import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { lockCritique, setCritiqueAssignment, withDetails, withIdentity, type Contest } from '../model/contest';
import {
  fixtureContest,
  fixtureContestWithResults,
  FIXTURE_LETTER_DATE,
  FIXTURE_NOW,
} from './__fixtures__/fixtureContest';
import { expectArchiveMatchesGolden, normalizeArchive } from './goldenFile';
import { buildFallAgenda } from './fallAgenda';
import { buildHostChecklist } from './hostChecklist';
import { buildDirectorsMeeting } from './directorsMeeting';
import { buildAwardsScript } from './awardsScript';
import { buildAdvancingLetter } from './advancingLetter';
import { buildTimerDoc } from './timer';
import { buildPreRehearsalMeeting } from './preRehearsalMeeting';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'golden');
const goldenPath = (filename: string) => join(GOLDEN_DIR, filename);

async function documentXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file('word/document.xml')!.async('string');
}

/** The four package parts every well-formed .docx must contain. */
const REQUIRED_PARTS = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels'];

/**
 * Table of the seven documents. `build` normalizes each builder to
 * (contest) => Promise<bytes>, injecting the fixed letter date where a document
 * stamps "today" (only the Advancing Letter does).
 */
const DOCUMENTS: Array<{ filename: string; build: (c: Contest) => Promise<Uint8Array> }> = [
  { filename: 'Fall District Meeting Agenda.docx', build: (c) => buildFallAgenda(c) },
  { filename: 'Host School Checklist.docx', build: (c) => buildHostChecklist(c) },
  { filename: 'Contest Day Directors Meeting Agenda.docx', build: (c) => buildDirectorsMeeting(c) },
  { filename: 'Awards Script.docx', build: (c) => buildAwardsScript(c) },
  { filename: 'Advancing Schools Letter.docx', build: (c) => buildAdvancingLetter(c, { now: FIXTURE_LETTER_DATE }) },
  { filename: 'Timer Instructions and Form.docx', build: (c) => buildTimerDoc(c) },
  { filename: 'Pre-Rehearsal Company Meeting.docx', build: (c) => buildPreRehearsalMeeting(c) },
];

describe.each(DOCUMENTS)('$filename', ({ filename, build }) => {
  it('matches the approved golden file (content-normalized)', async () => {
    const bytes = await build(fixtureContest());
    await expectArchiveMatchesGolden(bytes, goldenPath(filename));
  });

  it('is deterministic — same contest yields identical archive content', async () => {
    const [a, b] = [await build(fixtureContest()), await build(fixtureContest())];
    const [na, nb] = [await normalizeArchive(a), await normalizeArchive(b)];
    expect([...na.entries()]).toEqual([...nb.entries()]);
  });

  it('produces a structurally valid .docx (all four package parts present)', async () => {
    const zip = await JSZip.loadAsync(await build(fixtureContest()));
    for (const part of REQUIRED_PARTS) expect(zip.file(part), part).not.toBeNull();
  });

  it('emits only well-formed XML entities (every & is escaped)', async () => {
    const xml = await documentXml(await build(fixtureContest()));
    // No bare ampersand: each & must begin a named or numeric entity.
    expect(xml).not.toMatch(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/);
  });
});

/** The four documents that render play titles all escape "Romeo & Juliet". */
function assertPlayTitleEscaped(xml: string): void {
  expect(xml).toContain('Romeo &amp; Juliet');
  expect(xml).not.toContain('Romeo & Juliet');
}

/** Bravo(1) → Delta(2) → Alpha(3): performance-order sort common to school tables. */
function assertPerformanceOrder(xml: string): void {
  const iBravo = xml.indexOf('Bravo HS');
  const iDelta = xml.indexOf('Delta HS');
  const iAlpha = xml.indexOf('Alpha HS');
  expect(iBravo).toBeGreaterThan(0);
  expect(iBravo).toBeLessThan(iDelta);
  expect(iDelta).toBeLessThan(iAlpha);
}

describe('Fall District Meeting Agenda — content', () => {
  it('renders the title, host site, and schools in draw order', async () => {
    const xml = await documentXml(await buildFallAgenda(fixtureContest()));
    expect(xml).toContain('2026 5A District OAP Planning Meeting Agenda');
    expect(xml).toContain('Sharpstown High School');
    expect(xml).toContain('Performing Arts Center');
    // Contest date + directors' meeting flow into the "Set Contest Date" table.
    expect(xml).toContain('Saturday, March 21, 2026'); // fmtDate(contestDate)
    expect(xml).toContain('9:00 AM');
    // District contact list shows the first director + email per school.
    expect(xml).toContain('Alpha HS Director');
    expect(xml).toContain('dir1@example.com');
    assertPerformanceOrder(xml);
  });

  it('does not render the BIDC section for a BiDistrict contest (v12 latent gate)', async () => {
    const bidc = withIdentity(fixtureContest(), { contestLevel: 'BiDistrict' }, FIXTURE_NOW);
    const xml = await documentXml(await buildFallAgenda(bidc));
    expect(xml).not.toContain('BIDC Registration');
    expect(xml).toContain('8. Other Business &amp; Adjournment');
  });

  it('falls through to blanks for a contest date that is not set', async () => {
    const noDate = withDetails(fixtureContest(), { contestDate: '', directorsMeetingTime: '', firstShowTime: '' }, FIXTURE_NOW);
    const xml = await documentXml(await buildFallAgenda(noDate));
    // directors' meeting has a bag-level 'TBD'; first show / date fall to "___".
    expect(xml).toContain('TBD');
  });
});

describe('Host School Checklist — content', () => {
  it('renders host site header, school counts, and admission fee', async () => {
    const xml = await documentXml(await buildHostChecklist(fixtureContest()));
    expect(xml).toContain('2026 UIL 5A District 20 One-Act Play Contest');
    expect(xml).toContain('Sharpstown High School • Performing Arts Center • Saturday, March 21, 2026');
    expect(xml).toContain('Chris Technician');
    expect(xml).toContain('Admission: $10 per person');
    // Six schools → "6 total" appears in the dressing-room / storage-box lines.
    expect(xml).toContain('6 total');
    expect(xml).toContain('(6 Classrooms)');
  });

  it('shows the confirm-with-CM admission line when no fee is set', async () => {
    const noFee = withDetails(fixtureContest(), { admissionFee: '' }, FIXTURE_NOW);
    const xml = await documentXml(await buildHostChecklist(noFee));
    expect(xml).toContain('Admission policy: confirm with CM.');
    expect(xml).not.toContain('per person (all-day pass)');
  });
});

describe('Directors Meeting Agenda — content', () => {
  it('renders the header, judges, and per-school cue lines', async () => {
    const xml = await documentXml(await buildDirectorsMeeting(fixtureContest()));
    expect(xml).toContain('2026 UIL 5A District 20 One-Act Play Contest');
    expect(xml).toContain('Dr. Jane Judge');
    expect(xml).toContain('Prof. John Critic');
    // Contest date + directors' meeting time in the sub-header.
    expect(xml).toContain('March 21, 2026'); // fmtDateShort
    assertPerformanceOrder(xml);
    assertPlayTitleEscaped(xml);
  });

  it('reflects the critique format in the Critique Order section (seam for #23)', async () => {
    const xmlAll = await documentXml(await buildDirectorsMeeting(fixtureContest()));
    expect(xmlAll).toContain('after all performances');
    const afterEach = withDetails(fixtureContest(), { critiqueFormat: 'after_each' }, FIXTURE_NOW);
    const xmlEach = await documentXml(await buildDirectorsMeeting(afterEach));
    expect(xmlEach).toContain('after each performance');
    expect(xmlEach).not.toContain('after all performances');
  });

  it('shows the [Judge Names] placeholder when no judges are named', async () => {
    const noJudges = fixtureContest();
    noJudges.adjudicators.forEach((j) => (j.name = ''));
    const xml = await documentXml(await buildDirectorsMeeting(noJudges));
    expect(xml).toContain('[Judge Names]');
  });

  it('lists a LOCKED critique assignment in the Critique Order section (issue #23)', async () => {
    // Fixture schools in performance order: pos 1 = Bravo HS (order 1). Judges:
    // Dr. Jane Judge (1), Prof. John Critic (2), Ms. Mary Adjudicator (3).
    const assigned = setCritiqueAssignment(fixtureContest(), [2, 1, 3, 2, 1, 3], FIXTURE_NOW);

    // Unlocked and absent both leave the section in its no-assignment state
    // (only locked results are consumed — the golden-stable path).
    expect(await documentXml(await buildDirectorsMeeting(assigned))).not.toContain('Judge assignments');
    expect(await documentXml(await buildDirectorsMeeting(fixtureContest()))).not.toContain('Judge assignments');

    const locked = lockCritique(assigned, FIXTURE_NOW);
    const xml = await documentXml(await buildDirectorsMeeting(locked));
    expect(xml).toContain('Judge assignments');
    expect(xml).toContain('1. Bravo HS'); // first performance slot, listed in order
    expect(xml).toContain('Judge 2 — Prof. John Critic'); // its assigned judge
  });

  it('adds the after-each last-school note only when critiques are after each show', async () => {
    const each = withDetails(fixtureContest(), { critiqueFormat: 'after_each' }, FIXTURE_NOW);
    const locked = lockCritique(setCritiqueAssignment(each, [2, 1, 3, 2, 1, 3], FIXTURE_NOW), FIXTURE_NOW);
    const xml = await documentXml(await buildDirectorsMeeting(locked));
    expect(xml).toContain('Judge 1 is not assigned the last school');

    const afterAll = lockCritique(setCritiqueAssignment(fixtureContest(), [2, 1, 3, 2, 1, 3], FIXTURE_NOW), FIXTURE_NOW);
    expect(await documentXml(await buildDirectorsMeeting(afterAll))).not.toContain(
      'Judge 1 is not assigned the last school',
    );
  });
});

describe('Awards Script — content', () => {
  it('renders the panel, per-school technician blocks, and advancing places', async () => {
    const xml = await documentXml(await buildAwardsScript(fixtureContest()));
    expect(xml).toContain('Awards Ceremony Script');
    expect(xml).toContain('congratulate all 6 schools');
    expect(xml).toContain('Dr. Jane Judge');
    // Plural "adjudicators" with 3 judges.
    expect(xml).toContain('recognized by our adjudicators for Outstanding');
    expect(xml).toContain('1st Place — Advancing:');
    assertPerformanceOrder(xml);
    assertPlayTitleEscaped(xml);
  });

  it('uses singular "adjudicator" with a single judge', async () => {
    const oneJudge = withDetails(fixtureContest(), { numJudges: 1 }, FIXTURE_NOW);
    const xml = await documentXml(await buildAwardsScript(oneJudge));
    expect(xml).toContain('recognized by our adjudicator for Outstanding');
  });

  it('leaves the blank fill-in template when no results are recorded', async () => {
    // fixtureContest() has results === null, so the script must NOT fill.
    const xml = await documentXml(await buildAwardsScript(fixtureContest()));
    expect(xml).toContain('USE ACTING AWARDS FORM');
    expect(xml).toContain('1st Place — Advancing:');
    expect(xml).not.toContain('in no particular order');
  });
});

describe('Awards Script (with results) — golden + content', () => {
  const GOLDEN = 'Awards Script (With Results).docx';

  it('matches the approved with-results golden file (content-normalized)', async () => {
    const bytes = await buildAwardsScript(fixtureContestWithResults());
    await expectArchiveMatchesGolden(bytes, goldenPath(GOLDEN));
  });

  it('fills the acting awards, technicians, and best crew with actual winners', async () => {
    const xml = await documentXml(await buildAwardsScript(fixtureContestWithResults()));
    // The blank-template reminders are gone.
    expect(xml).not.toContain('USE ACTING AWARDS FORM');
    // Best Performers / All-Star / Honorable Mention name their students + schools.
    expect(xml).toContain('Jordan Lee — Bravo HS');
    expect(xml).toContain('Alex Kim — Alpha HS');
    expect(xml).toContain('Casey Park — Foxtrot HS');
    // Outstanding Technicians (one per school) and Best Crew.
    expect(xml).toContain('Pat Nguyen — Alpha HS');
    expect(xml).toContain('Drew Carter — Charlie HS');
    expect(xml).toContain('Best Crew');
    expect(xml).toContain('Echo HS — Almost, Maine');
  });

  it('announces advancing companies unordered, with no placement labels', async () => {
    const xml = await documentXml(await buildAwardsScript(fixtureContestWithResults()));
    expect(xml).toContain('in no particular order');
    // Advancing companies: Bravo, Delta, Foxtrot (rank order [3,1,5] dropped).
    expect(xml).toContain('Bravo HS — The Crucible');
    expect(xml).toContain('Delta HS — Metamorphoses');
    expect(xml).toContain('Foxtrot HS — Radium Girls');
    // Alternate named (Romeo & Juliet stays XML-escaped).
    expect(xml).toContain('Alternate: Alpha HS — Romeo &amp; Juliet');
    // No placement anywhere.
    expect(xml).not.toContain('1st Place');
    expect(xml).not.toContain('2nd Place');
    expect(xml).not.toContain('3rd Place');
  });

  it('fills the Next Level of Competition section from nextContest (no clock read)', async () => {
    const xml = await documentXml(await buildAwardsScript(fixtureContestWithResults()));
    expect(xml).toContain('continue to the Bi-District contest'); // District → Bi-District
    expect(xml).toContain('Regional Arts Center, Austin');
    expect(xml).toContain('March 28, 2026'); // fmtDateShort(nextContest.date)
    expect(xml).toContain('Dana Host');
    expect(xml).not.toContain('[Announce the next contest level');
  });
});

describe('Advancing Schools Letter — content', () => {
  it('stamps the injected date and computes the next level', async () => {
    const xml = await documentXml(await buildAdvancingLetter(fixtureContest(), { now: FIXTURE_LETTER_DATE }));
    expect(xml).toContain('July 6, 2026'); // injected, deterministic
    // District advances to Bi-District.
    expect(xml).toContain('advanced to the Bi-District level');
    expect(xml).toContain('March 28, 2026'); // fmtDateShort(bidcContestDate = 2026-03-28)
  });

  it('advances a BiDistrict contest to Area', async () => {
    const bidc = withIdentity(fixtureContest(), { contestLevel: 'BiDistrict' }, FIXTURE_NOW);
    const xml = await documentXml(await buildAdvancingLetter(bidc, { now: FIXTURE_LETTER_DATE }));
    expect(xml).toContain('advanced to the Area level');
  });

  it('prints TBD for the next contest date when unset', async () => {
    const noBidc = withDetails(fixtureContest(), { bidcContestDate: '' }, FIXTURE_NOW);
    const xml = await documentXml(await buildAdvancingLetter(noBidc, { now: FIXTURE_LETTER_DATE }));
    expect(xml).toContain('TBD');
  });
});

describe('Timer Instructions + Form — content', () => {
  it('renders both pages, the conference/level, and the show grid', async () => {
    const xml = await documentXml(await buildTimerDoc(fixtureContest()));
    expect(xml).toContain('UIL One-Act Play Timekeeper Instructions');
    expect(xml).toContain('UIL One-Act Play Timer Form');
    // Form header table.
    expect(xml).toContain('Saturday, March 21, 2026'); // fmtDate(contestDate)
    // A page break separates instructions from the form.
    expect(xml).toContain('<w:br w:type="page"/>');
    // Timer grid header + SHOW rows in performance order.
    expect(xml).toContain('PERFORMANCE');
    expect(xml).toContain('SHOW 1');
    expect(xml).toContain('SHOW 6');
    assertPerformanceOrder(xml);
    assertPlayTitleEscaped(xml);
  });
});

describe('Pre-Rehearsal Company Meeting — content', () => {
  it('renders the title, rehearsal length, and the 4-column school table', async () => {
    const xml = await documentXml(await buildPreRehearsalMeeting(fixtureContest()));
    expect(xml).toContain('Pre-Rehearsal Company Meeting');
    // 90 minutes → "1 hr 30 min".
    expect(xml).toContain('you will have 1 hr 30 min, including strike');
    expect(xml).toContain('Spike Tape');
    expect(xml).toContain('Upstage Curtain');
    assertPerformanceOrder(xml);
    assertPlayTitleEscaped(xml);
  });

  it('formats a whole-hour rehearsal length as hours', async () => {
    const twoHours = withDetails(fixtureContest(), { rehearsalLengthMinutes: 120 }, FIXTURE_NOW);
    const xml = await documentXml(await buildPreRehearsalMeeting(twoHours));
    expect(xml).toContain('you will have 2 hours, including strike');
  });
});

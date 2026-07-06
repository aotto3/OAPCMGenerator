import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import {
  createContest,
  withAdjudicator,
  withCmInfo,
  withDetails,
  withDirector,
  withIdentity,
  withSchool,
  type Contest,
} from '../model/contest';
import { buildDirectorLetter } from './letter';
import { diffArchives, expectArchiveMatchesGolden, normalizeArchive } from './goldenFile';

// Fixed timestamps + letter date so the golden file is byte-stable at the XML
// level (see goldenFile.ts). LETTER_DATE is built from calendar components, so
// it is the same "July 6, 2026" regardless of the machine's timezone.
const NOW = '2026-07-05T12:00:00.000Z';
const LETTER_DATE = new Date(2026, 6, 6); // 2026-07-06

const GOLDEN = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'golden',
  'Director Information Letter.docx',
);

/** A fully-populated contest — the letter reads nearly every field. */
function fixtureContest(): Contest {
  let c = createContest({ id: 'slice6-letter-fixture', now: NOW, identity: { districtNumber: '20' } });
  c = withIdentity(
    c,
    {
      hostSchoolName: 'Sharpstown High School',
      hostVenueName: 'Performing Arts Center',
      hostAddress: '7504 Bissonnet St, Houston, TX 77074',
    },
    NOW,
  );
  c = withCmInfo(c, { techContact: 'Chris Technician' }, NOW);
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
    },
    NOW,
  );

  const judges = [
    { name: 'Dr. Jane Judge', mailingAddress: '100 Main St, Austin, TX 78701' },
    { name: 'Prof. John Critic', mailingAddress: '200 Oak Ave, Dallas, TX 75201' },
    { name: 'Ms. Mary Adjudicator', mailingAddress: '300 Elm Blvd, San Antonio, TX 78205' },
  ];
  judges.forEach((j, i) => (c = withAdjudicator(c, i, j, NOW)));

  const names = ['Alpha HS', 'Bravo HS', 'Charlie HS', 'Delta HS', 'Echo HS', 'Foxtrot HS'];
  // "Romeo & Juliet" exercises XML escaping through the performance-order table.
  const plays = ['Romeo & Juliet', 'The Crucible', 'Antigone', 'Metamorphoses', 'Almost, Maine', 'Radium Girls'];
  const orders = [3, 1, 5, 2, 6, 4]; // out of form order, so sorting is exercised
  names.forEach((name, i) => {
    c = withSchool(c, i, { name, playTitle: plays[i], performanceOrder: orders[i] }, NOW);
    c = withDirector(c, i, 0, { name: `${name} Director`, email: `dir${i + 1}@example.com` }, NOW);
  });
  return c;
}

async function documentXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file('word/document.xml')!.async('string');
}

describe('buildDirectorLetter', () => {
  it('matches the approved golden file (content-normalized)', async () => {
    const bytes = await buildDirectorLetter(fixtureContest(), { now: LETTER_DATE });
    await expectArchiveMatchesGolden(bytes, GOLDEN);
  });

  it('is deterministic — same contest + date yields identical archive content', async () => {
    const a = await buildDirectorLetter(fixtureContest(), { now: LETTER_DATE });
    const b = await buildDirectorLetter(fixtureContest(), { now: LETTER_DATE });
    const [na, nb] = [await normalizeArchive(a), await normalizeArchive(b)];
    expect([...na.entries()]).toEqual([...nb.entries()]);
  });

  it('produces a structurally valid .docx (required OOXML parts present)', async () => {
    const zip = await JSZip.loadAsync(await buildDirectorLetter(fixtureContest(), { now: LETTER_DATE }));
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels']) {
      expect(zip.file(part), part).not.toBeNull();
    }
  });

  it('substitutes contest values into the fixed letter language', async () => {
    const xml = await documentXml(await buildDirectorLetter(fixtureContest(), { now: LETTER_DATE }));
    // Letterhead + injected date, host, contest date, judges, fee.
    expect(xml).toContain('July 6, 2026'); // injected letter date
    expect(xml).toContain('Sharpstown High School');
    expect(xml).toContain('Performing Arts Center');
    expect(xml).toContain('March 21, 2026'); // contest_date_short
    expect(xml).toContain('3/11/2026'); // entry_system_deadline_numeric
    expect(xml).toContain('March 11, 2026'); // light-cue deadline (short)
    expect(xml).toContain('Dr. Jane Judge');
    expect(xml).toContain('300 Elm Blvd, San Antonio, TX 78205');
    expect(xml).toContain('admission charge of $10');
    expect(xml).toContain('90 minutes in length'); // rehearsal length
    // after_all critique wording (not after_each).
    expect(xml).toContain('held after all shows have finished');
    expect(xml).not.toContain('immediately after each show has finished');
  });

  it('escapes special characters and lists schools in performance order', async () => {
    const xml = await documentXml(await buildDirectorLetter(fixtureContest(), { now: LETTER_DATE }));
    // Ampersand is escaped in the play title.
    expect(xml).toContain('Romeo &amp; Juliet');
    expect(xml).not.toContain('Romeo & Juliet');
    // Performance order table: Bravo (1) precedes Delta (2) precedes Alpha (3).
    const iBravo = xml.indexOf('Bravo HS');
    const iDelta = xml.indexOf('Delta HS');
    const iAlpha = xml.indexOf('Alpha HS');
    expect(iBravo).toBeGreaterThan(0);
    expect(iBravo).toBeLessThan(iDelta);
    expect(iDelta).toBeLessThan(iAlpha);
  });

  it('falls back to v12 placeholder text when fields are blank', async () => {
    // A bare contest: no host, no judges, no dates.
    const bare = createContest({ id: 'bare', now: NOW });
    const xml = await documentXml(await buildDirectorLetter(bare, { now: LETTER_DATE }));
    expect(xml).toContain('[Host School]');
    expect(xml).toContain('[Venue TBD]');
    expect(xml).toContain('Adjudicator addresses will be provided once contracting is complete.');
  });

  it('emits the after_each critique wording when selected', async () => {
    const c = withDetails(fixtureContest(), { critiqueFormat: 'after_each' }, NOW);
    const xml = await documentXml(await buildDirectorLetter(c, { now: LETTER_DATE }));
    expect(xml).toContain('immediately after each show has finished');
    expect(xml).not.toContain('held after all shows have finished');
  });
});

describe('golden-file harness', () => {
  it('reports no mismatches for identical archives', async () => {
    const bytes = await buildDirectorLetter(fixtureContest(), { now: LETTER_DATE });
    expect(await diffArchives(bytes, bytes)).toEqual([]);
  });

  it('reports a readable per-part diff when content differs', async () => {
    const a = await buildDirectorLetter(fixtureContest(), { now: LETTER_DATE });
    const b = await buildDirectorLetter(
      withDetails(fixtureContest(), { admissionFee: '15' }, NOW),
      { now: LETTER_DATE },
    );
    const mismatches = await diffArchives(a, b);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].part).toBe('word/document.xml');
    expect(mismatches[0].kind).toBe('changed');
    // The diff calls out both the golden (-) and actual (+) admission charge.
    expect(mismatches[0].diff).toContain('$10');
    expect(mismatches[0].diff).toContain('$15');
  });

  it('detects a part present in one archive but missing from the other', async () => {
    const letter = await buildDirectorLetter(fixtureContest(), { now: LETTER_DATE });
    const extra = new JSZip();
    extra.file('word/document.xml', 'x');
    extra.file('extra/part.xml', 'y');
    const other = await extra.generateAsync({ type: 'uint8array' });
    const kinds = (await diffArchives(letter, other)).map((m) => m.kind);
    expect(kinds).toContain('missing-from-actual'); // parts in `other` but not `letter`
  });
});

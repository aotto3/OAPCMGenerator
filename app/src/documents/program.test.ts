/**
 * Golden-file + content tests for the Audience Program (.docx) — PRD #68 / E5.
 *
 * Two goldens exercise both ends of the graceful-degradation spectrum:
 *  - "Audience Program.docx" from the base fixture (school names + plain titles, but
 *    NO rosters, NO metadata, NO bios) — proves every optional piece omits cleanly.
 *  - "Audience Program (With Company).docx" from the company fixture — full rosters,
 *    a Scenes production, two directors, and adjudicator + CM bios.
 * Each golden is paired with content assertions so intent survives a re-bless.
 */

import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { withCmInfo, type Contest } from '../model/contest';
import { fixtureContest, fixtureContestWithCompany, FIXTURE_NOW } from './__fixtures__/fixtureContest';
import { expectArchiveMatchesGolden, normalizeArchive } from './goldenFile';
import { buildProgram } from './program';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'golden');
const goldenPath = (filename: string) => join(GOLDEN_DIR, filename);

async function documentXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file('word/document.xml')!.async('string');
}

/** The four package parts every well-formed .docx must contain. */
const REQUIRED_PARTS = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels'];

const CASES: Array<{ filename: string; build: () => Contest }> = [
  { filename: 'Audience Program.docx', build: fixtureContest },
  { filename: 'Audience Program (With Company).docx', build: fixtureContestWithCompany },
];

describe.each(CASES)('$filename', ({ filename, build }) => {
  it('matches the approved golden file (content-normalized)', async () => {
    const bytes = await buildProgram(build());
    await expectArchiveMatchesGolden(bytes, goldenPath(filename));
  });

  it('is deterministic — same contest yields identical archive content', async () => {
    const [a, b] = [await buildProgram(build()), await buildProgram(build())];
    const [na, nb] = [await normalizeArchive(a), await normalizeArchive(b)];
    expect([...na.entries()]).toEqual([...nb.entries()]);
  });

  it('produces a structurally valid .docx (all four package parts present)', async () => {
    const zip = await JSZip.loadAsync(await buildProgram(build()));
    for (const part of REQUIRED_PARTS) expect(zip.file(part), part).not.toBeNull();
  });

  it('emits only well-formed XML entities (every & is escaped)', async () => {
    const xml = await documentXml(await buildProgram(build()));
    expect(xml).not.toMatch(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/);
  });
});

describe('Audience Program — cover + performance order', () => {
  it('renders the cover title, venue, date, and first-show time', async () => {
    const xml = await documentXml(await buildProgram(fixtureContest()));
    expect(xml).toContain('2026 UIL 5A District 20 One-Act Play Contest');
    expect(xml).toContain('Audience Program');
    expect(xml).toContain('Performing Arts Center • Sharpstown High School');
    expect(xml).toContain('Saturday, March 21, 2026'); // fmtDate(contestDate)
    expect(xml).toContain('Performances begin at 10:00 AM');
  });

  it('lists school pages in performance order (Bravo 1 → Delta 2 → Alpha 3)', async () => {
    const xml = await documentXml(await buildProgram(fixtureContest()));
    const iBravo = xml.indexOf('Bravo HS');
    const iDelta = xml.indexOf('Delta HS');
    const iAlpha = xml.indexOf('Alpha HS');
    expect(iBravo).toBeGreaterThan(0);
    expect(iBravo).toBeLessThan(iDelta);
    expect(iDelta).toBeLessThan(iAlpha);
    // One hard page break per page boundary: cover + 6 schools = 6 breaks (no bios).
    expect(xml.split('<w:br w:type="page"/>').length - 1).toBe(6);
  });
});

describe('Audience Program — graceful degradation (no company data / no bios)', () => {
  it('omits the bios section and roster groups when nothing is entered', async () => {
    const xml = await documentXml(await buildProgram(fixtureContest()));
    expect(xml).not.toContain('About Our Panel');
    expect(xml).not.toContain('Presents scenes from');
    expect(xml).not.toContain('Cast');
    expect(xml).not.toContain('Crew');
    // Plain play titles still print (productionType is '' in the base fixture).
    expect(xml).toContain('The Crucible');
  });

  it('falls back to "School N" for a blank school name, keyed to form position', async () => {
    const blank = fixtureContest();
    blank.schools[0].name = ''; // Alpha HS is form position 1
    const xml = await documentXml(await buildProgram(blank));
    expect(xml).toContain('School 1');
  });
});

describe('Audience Program (with company) — bios, roster, scenes', () => {
  it('renders adjudicator + CM bios, skipping judges without a bio', async () => {
    const xml = await documentXml(await buildProgram(fixtureContestWithCompany()));
    expect(xml).toContain('About Our Panel');
    expect(xml).toContain('Adjudicators');
    expect(xml).toContain('Dr. Jane Judge has directed competitive theatre');
    expect(xml).toContain('Prof. John Critic teaches dramatic literature');
    expect(xml).toContain('Contest Manager');
    expect(xml).toContain('Allen Otto is a longtime UIL contest manager');
    // Judge 3 has no bio, so its name must not appear anywhere in the program.
    expect(xml).not.toContain('Ms. Mary Adjudicator');
  });

  it('renders the "Presents scenes from" line for a Scenes production, XML-escaped', async () => {
    const xml = await documentXml(await buildProgram(fixtureContestWithCompany()));
    expect(xml).toContain('Presents scenes from Romeo &amp; Juliet');
    expect(xml).not.toContain('Romeo & Juliet'); // bare, unescaped
  });

  it('lists cast, crew, and alternates with roles, and the production credits', async () => {
    const xml = await documentXml(await buildProgram(fixtureContestWithCompany()));
    expect(xml).toContain('Cast');
    expect(xml).toContain('Jordan Lee — John Proctor');
    expect(xml).toContain('Crew');
    expect(xml).toContain('Sam Rivera — Stage Manager');
    expect(xml).toContain('Alternates');
    expect(xml).toContain('Casey Park'); // alternate, no role
    // Two directors joined; author, setting, runtime, music, publisher all present.
    expect(xml).toContain('Directed by Bravo HS Director, Bravo HS Assistant Director');
    expect(xml).toContain('by Arthur Miller');
    expect(xml).toContain('Setting: Salem, Massachusetts, 1692');
    expect(xml).toContain('Running time: 40 minutes');
    expect(xml).toContain('Music &amp; Credits: Original underscore by Sam Composer');
    expect(xml).toContain('Produced by special arrangement with Dramatists Play Service');
  });

  it('renders no bios section when every bio is blanked out', async () => {
    let c = fixtureContestWithCompany();
    c.adjudicators.forEach((j) => (j.bio = ''));
    c = withCmInfo(c, { bio: '' }, FIXTURE_NOW);
    const xml = await documentXml(await buildProgram(c));
    expect(xml).not.toContain('About Our Panel');
  });
});

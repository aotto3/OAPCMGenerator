/**
 * Golden + content tests for Slice 9 — the Adjudicator Packets PDF (the 14th and
 * final document).
 *
 * A .pdf is not a ZIP, so the unzip-normalize golden harness the .docx/.xlsx
 * ports use does not apply. Instead:
 *   • DETERMINISM — pdf-lib stamps date/producer metadata; the builder pins all
 *     four, so the merged bytes are byte-stable. Two builds must hash-match.
 *   • GOLDEN — a SHA-256 hash golden (tiny text file) locks the exact bytes
 *     without committing a ~5 MB binary (see goldenFile.expectHashMatchesGolden).
 *   • INTENT — page count and the actual filled field values (read back from a
 *     real template BEFORE flatten) are asserted, so a golden regeneration can't
 *     silently drop or mis-map a field.
 *
 * Templates are read straight off disk here (Node), independent of the browser
 * `?url` loader in pdfAssets.ts.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { setAllDocuments, setDocumentSelected, withIdentity } from '../model/contest';
import { fixtureContest, FIXTURE_NOW } from './__fixtures__/fixtureContest';
import { docSchools } from './docVars';
import { expectHashMatchesGolden } from './goldenFile';
import { buildContestArchive, normalizeResult } from './generate';
import {
  adjPacketContext,
  buildAdjudicatorPacketsPdf,
  evaluationValues,
  fillEvaluationForm,
  fillRankingForm,
  rankingValues,
  type AdjudicatorPdfTemplates,
} from './adjPackets';
import JSZip from 'jszip';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, 'assets');
const GOLDEN = join(HERE, '__fixtures__', 'golden', 'Adjudicator Packets.pdf.sha256');

const EM_DASH = '—';

function templates(): AdjudicatorPdfTemplates {
  return {
    evaluation: new Uint8Array(readFileSync(join(ASSETS, 'eval.pdf'))),
    ranking: new Uint8Array(readFileSync(join(ASSETS, 'ranking.pdf'))),
    awards: new Uint8Array(readFileSync(join(ASSETS, 'awards.pdf'))),
  };
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

// A full 113-page build takes several seconds; build the fixture packet ONCE and
// share it across the structural assertions rather than rebuilding per test.
let fixtureBuild: ReturnType<typeof buildAdjudicatorPacketsPdf> | null = null;
const buildFixture = () => (fixtureBuild ??= buildAdjudicatorPacketsPdf(fixtureContest(), templates()));

describe('Adjudicator Packets — structure & determinism', () => {
  // Warm the shared build up front so no individual assertion pays its full cost.
  beforeAll(async () => {
    await buildFixture();
  }, 30000);

  it('matches the approved golden hash', async () => {
    expectHashMatchesGolden((await buildFixture()).bytes, GOLDEN);
  });

  it('is deterministic — same contest yields byte-identical output', async () => {
    const a = await buildFixture();
    const b = await buildAdjudicatorPacketsPdf(fixtureContest(), templates());
    expect(sha256(a.bytes)).toBe(sha256(b.bytes));
  }, 30000);

  it('merges numJudges×(schools×evalPages + 1 ranking) + 1 awards ballot', async () => {
    const t = templates();
    const evalPages = (await PDFDocument.load(t.evaluation)).getPageCount();
    const rankPages = (await PDFDocument.load(t.ranking)).getPageCount();
    const awardsPages = (await PDFDocument.load(t.awards)).getPageCount();

    const c = fixtureContest();
    const expected = c.details.numJudges * (docSchools(c).length * evalPages + rankPages) + awardsPages;
    const { bytes, pageCount } = await buildFixture();
    expect(pageCount).toBe(expected);
    // Confirm the reported page count matches the saved document.
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(expected);
  });

  it('fills every mapped field cleanly (no field errors) for the fixture', async () => {
    expect((await buildFixture()).fieldErrors).toEqual([]);
  });

  it('is a real PDF (%PDF header)', async () => {
    const { bytes } = await buildFixture();
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
  });
});

describe('Adjudicator Packets — field values (read back before flatten)', () => {
  it('fills the Evaluation ballot header/admin fields for judge 1, first draw', async () => {
    const c = fixtureContest();
    const ctx = adjPacketContext(c);
    const school = docSchools(c)[0]; // Bravo HS, draw 1, "The Crucible"

    const doc = await PDFDocument.load(templates().evaluation);
    const form = doc.getForm();
    const errors = fillEvaluationForm(form, evaluationValues('Dr. Jane Judge', school, ctx));

    expect(errors).toEqual([]);
    expect(form.getTextField('Title').getText()).toBe(`Bravo HS ${EM_DASH} The Crucible`);
    expect(form.getTextField('Date').getText()).toBe('March 21, 2026');
    expect(form.getTextField('Performance Order').getText()).toBe('1');
    expect(form.getTextField('Conference').getText()).toBe('5A');
    expect(form.getTextField('Contest Site').getText()).toBe('Performing Arts Center');
    expect(form.getTextField('Judge').getText()).toBe('Dr. Jane Judge');
    expect(form.getCheckBox('Check Box7').isChecked()).toBe(true); // District
  });

  it('leaves every judge-scored field on the Evaluation ballot blank', async () => {
    const c = fixtureContest();
    const doc = await PDFDocument.load(templates().evaluation);
    const form = doc.getForm();
    fillEvaluationForm(form, evaluationValues('Dr. Jane Judge', docSchools(c)[0], adjPacketContext(c)));

    // Ratings are radio groups; none is selected. A representative comment field is empty.
    expect(form.getRadioGroup('Radio Group 1').getSelected()).toBeUndefined();
    expect(form.getTextField('COMMENT 1').getText()).toBeUndefined();
    expect(form.getTextField('AREAS FOR GROWTH Comments 1').getText()).toBeUndefined();
  });

  it('fills the Ranking ballot dropdowns and per-school Play/School for a judge', async () => {
    const c = fixtureContest();
    const ctx = adjPacketContext(c);
    const schools = docSchools(c);

    const doc = await PDFDocument.load(templates().ranking);
    const form = doc.getForm();
    const errors = fillRankingForm(form, rankingValues(1, schools, ctx)); // judge index 1 → B

    expect(errors).toEqual([]);
    expect(form.getDropdown('Panelist').getSelected()).toEqual(['B']);
    expect(form.getDropdown('Conference').getSelected()).toEqual(['5A']);
    expect(form.getDropdown('Level/Zone').getSelected()).toEqual(['District']);
    // First draw uses "School"; subsequent use "School_N".
    expect(form.getTextField('School').getText()).toBe('Bravo HS');
    expect(form.getTextField('Play 1').getText()).toBe('The Crucible');
    expect(form.getTextField('School_2').getText()).toBe('Delta HS');
    expect(form.getTextField('Play 2').getText()).toBe('Metamorphoses');
  });
});

describe('Adjudicator Packets — computed values (intent)', () => {
  it('titles the Evaluation with "School — Play" using an em-dash', () => {
    const c = fixtureContest();
    const vals = evaluationValues('J', docSchools(c)[2], adjPacketContext(c)); // draw 3 → Alpha
    expect(vals.text.Title).toBe(`Alpha HS ${EM_DASH} Romeo & Juliet`);
  });

  it('assigns Panelist letters A/B/C by judge index', () => {
    const c = fixtureContest();
    const schools = docSchools(c);
    const ctx = adjPacketContext(c);
    expect(rankingValues(0, schools, ctx).dropdowns.Panelist).toBe('A');
    expect(rankingValues(1, schools, ctx).dropdowns.Panelist).toBe('B');
    expect(rankingValues(2, schools, ctx).dropdowns.Panelist).toBe('C');
  });

  it('maps contest level to the Evaluation checkbox and Ranking dropdown', () => {
    const zone = withIdentity(fixtureContest(), { contestLevel: 'Zone', districtNumber: '' }, FIXTURE_NOW);
    const zctx = adjPacketContext(zone);
    expect(evaluationValues('J', docSchools(zone)[0], zctx).levelCheckbox).toBe('Check Box6');
    expect(rankingValues(0, docSchools(zone), zctx).dropdowns['Level/Zone']).toBe('Zone');

    const bidc = withIdentity(fixtureContest(), { contestLevel: 'BiDistrict' }, FIXTURE_NOW);
    const bctx = adjPacketContext(bidc);
    expect(evaluationValues('J', docSchools(bidc)[0], bctx).levelCheckbox).toBe('Check Box8');
    expect(rankingValues(0, docSchools(bidc), bctx).dropdowns['Level/Zone']).toBe('Bi District');
  });

  it('falls back to "Judge N" when an adjudicator has no name', async () => {
    const c = fixtureContest();
    c.adjudicators[0].name = '';
    const doc = await PDFDocument.load(templates().evaluation);
    const form = doc.getForm();
    const judgeName = c.adjudicators[0]?.name || 'Judge 1';
    fillEvaluationForm(form, evaluationValues(judgeName, docSchools(c)[0], adjPacketContext(c)));
    expect(form.getTextField('Judge').getText()).toBe('Judge 1');
  });
});

describe('Adjudicator Packets — field errors accumulate, never throw', () => {
  it('records a label for every field missing from the template', async () => {
    // The awards form lacks the Evaluation fields — every write should be recorded.
    const c = fixtureContest();
    const wrong = await PDFDocument.load(templates().awards);
    const form = wrong.getForm();
    const errors = fillEvaluationForm(form, evaluationValues('J', docSchools(c)[0], adjPacketContext(c)));
    expect(errors).toEqual([
      'Eval Title',
      'Eval Date',
      'Eval Performance Order',
      'Eval Conference',
      'Eval Contest Site',
      'Eval Judge',
      'Eval level checkbox (Check Box7)',
    ]);
  });
});

describe('warning channel (generate pipeline)', () => {
  it('normalizeResult accepts bare bytes and {bytes, warnings}', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(normalizeResult(bytes)).toEqual({ bytes, warnings: [] });
    expect(normalizeResult({ bytes })).toEqual({ bytes, warnings: [] });
    expect(normalizeResult({ bytes, warnings: ['Eval Title'] })).toEqual({
      bytes,
      warnings: ['Eval Title'],
    });
  });

  it('threads the adjudicator PDF through the ZIP with no warnings for a clean contest', async () => {
    let c = setAllDocuments(fixtureContest(), false);
    c = setDocumentSelected(c, 'adj_packets', true);

    const archive = await buildContestArchive(c);
    expect(archive.warnings).toEqual([]);
    expect(archive.documentCount).toBe(1);

    const zip = await JSZip.loadAsync(archive.bytes);
    const pdf = zip.file(`${archive.folderName}/Adjudicator Packets.pdf`);
    expect(pdf).not.toBeNull();
    const pdfBytes = new Uint8Array(await pdf!.async('uint8array'));
    expect(Buffer.from(pdfBytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect((await PDFDocument.load(pdfBytes)).getPageCount()).toBe(113);
  }, 30000);
});

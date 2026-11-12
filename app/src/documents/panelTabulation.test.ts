/**
 * Panel Tabulation.pdf (PRD #236). A .pdf is not a ZIP, so like the adjudicator
 * packets it is locked by a SHA-256 golden; the intent (page shape, the text
 * UIL prints) is asserted separately so a re-bless cannot silently drop a line.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  setAllDocuments,
  setDocumentSelected,
  setNumSchools,
  setTabulationRank,
  withSchool,
  type Contest,
} from '../model/contest';
import { fixtureContest, FIXTURE_NOW } from './__fixtures__/fixtureContest';
import { buildContestArchive } from './generate';
import { expectHashMatchesGolden } from './goldenFile';
import { buildPanelTabulationPdf } from './panelTabulation';
import { DOCUMENT_REGISTRY, isDocumentAvailable, isDocumentSelected } from './registry';

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'golden', 'Panel Tabulation.pdf.sha256');

/** Ranks per judge by school form index; rotations so every rule-free ballot is valid. */
function withRanks(c: Contest, ranks: number[][]): Contest {
  ranks.forEach((r, i) => r.forEach((n, j) => (c = setTabulationRank(c, i, j, String(n), FIXTURE_NOW))));
  return c;
}

/** The document fixture (3 judges) with every ballot entered. */
function tabulated(): Contest {
  const c = fixtureContest();
  const n = c.schools.length;
  return withRanks(
    c,
    c.schools.map((_, i) => [i + 1, ((i + 1) % n) + 1, ((i + n - 1) % n) + 1]),
  );
}

/** The page's decoded content stream; pdf-lib writes standard-font text as <hex> Tj. */
async function pageContent(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes);
  const contents = pdf.getPage(0).node.Contents();
  const streams =
    contents instanceof PDFArray ? contents.asArray().map((ref) => pdf.context.lookup(ref)) : [contents];
  return streams
    .map((s) => (s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString('latin1') : ''))
    .join(' ');
}

function hasText(content: string, text: string): boolean {
  return content.includes(`<${Buffer.from(text, 'latin1').toString('hex').toUpperCase()}>`);
}

const doc = () => DOCUMENT_REGISTRY.find((d) => d.id === 'panel_tabulation')!;

describe('Panel Tabulation.pdf', () => {
  it('matches the approved golden hash', async () => {
    expectHashMatchesGolden(await buildPanelTabulationPdf(tabulated()), GOLDEN);
  });

  it('is deterministic (no clock read)', async () => {
    const a = await buildPanelTabulationPdf(tabulated());
    const b = await buildPanelTabulationPdf(tabulated());
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('is one landscape Letter page', async () => {
    const pdf = await PDFDocument.load(await buildPanelTabulationPdf(tabulated()));
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect([width, height]).toEqual([792, 612]);
  });

  it("prints UIL's title, header, table heads, email line and footer", async () => {
    const content = await pageContent(await buildPanelTabulationPdf(tabulated()));
    for (const text of [
      'UIL One-Act Play Panel Tabulation',
      'Date: 2026-03-21',
      'Conference: 5A',
      'Contest Site: Performing Arts Center',
      'Contest Level: District',
      'Results',
      'Place',
      'Dr. Jane Judge',
      'Diagnostic',
      'Email Tabulation the State Theatre Director at ',
      'prodriguez@uiltexas.org',
      ' immediately.',
      'The system of tie-breaking is based on the Constitution and Contest Rules of the the University Interscholastic League and their property',
      '© 2021, Texas Theatre Adjudicators and Officials TTAO',
    ]) {
      expect(hasText(content, text), text).toBe(true);
    }
  });

  it('keeps 8 schools with long names on one page', async () => {
    let c = setNumSchools(fixtureContest(), 8, FIXTURE_NOW);
    for (let i = 0; i < 8; i++) {
      c = withSchool(
        c,
        i,
        {
          name: `Extraordinarily Long Consolidated Independent High School ${i + 1}`,
          playTitle: 'The Importance of Being Earnest, A Trivial Comedy for Serious People',
          performanceOrder: i + 1,
        },
        FIXTURE_NOW,
      );
    }
    c = withRanks(
      c,
      Array.from({ length: 8 }, (_, i) => [i + 1, ((i + 1) % 8) + 1, ((i + 7) % 8) + 1]),
    );
    const pdf = await PDFDocument.load(await buildPanelTabulationPdf(c));
    expect(pdf.getPageCount()).toBe(1);
  });
});

describe('Panel Tabulation in the documents ZIP', () => {
  it('is unavailable (and never selected) until every ballot is entered', () => {
    const blank = fixtureContest();
    expect(isDocumentAvailable(doc(), blank)).toBe(false);
    expect(isDocumentSelected(doc(), setAllDocuments(blank, true))).toBe(false);
  });

  it('is checked by default once the ballots are valid', () => {
    expect(isDocumentAvailable(doc(), tabulated())).toBe(true);
    expect(isDocumentSelected(doc(), tabulated())).toBe(true);
    expect(isDocumentSelected(doc(), setDocumentSelected(tabulated(), 'panel_tabulation', false))).toBe(false);
  });

  it('falls back to checked for a contest saved before the document existed', () => {
    const c = tabulated();
    const { panel_tabulation: _missing, ...older } = c.documents;
    expect(isDocumentSelected(doc(), { ...c, documents: older as Contest['documents'] })).toBe(true);
  });

  it('goes in the ZIP only when available', async () => {
    const files = async (c: Contest) => {
      const only = setDocumentSelected(setAllDocuments(c, false), 'panel_tabulation', true);
      const { bytes, folderName } = await buildContestArchive(only);
      return Object.keys((await JSZip.loadAsync(bytes)).files).filter((f) => f.startsWith(`${folderName}/`));
    };
    expect((await files(tabulated())).some((f) => f.endsWith('/Panel Tabulation.pdf'))).toBe(true);
    expect((await files(fixtureContest())).some((f) => f.endsWith('/Panel Tabulation.pdf'))).toBe(false);
  });
});

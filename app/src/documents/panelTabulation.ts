/**
 * Panel Tabulation.pdf (PRD #236): UIL's TTAO tabulation results page, drawn
 * with pdf-lib to match what the browser prints from UIL's site, minus the
 * browser's own header and footer lines.
 *
 * Layout, font sizes and colors are measured from a Chrome print of UIL's page
 * (landscape Letter): a 12pt base, title 14.4pt, header lines 10.8pt, "Results"
 * 14pt, table 12pt with UIL's Pure table colors, the email line 18pt with a blue
 * underlined address, and the footer at 9.6pt / 12pt.
 *
 * Pure aside from pdf-lib, and deterministic: no clock read (the date printed is
 * the contest date) and pinned metadata, so it golden-tests by hash.
 */

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import type { Contest } from '../model/contest';
import {
  STATE_THEATRE_DIRECTOR_EMAIL,
  tabulationHeaderLines,
  tabulationReport,
  type TabulationReport,
} from '../model/tabulationReport';
import { DOCUMENT_APP, DOCUMENT_AUTHOR_FULL } from './attribution';

const PAGE_W = 792;
const PAGE_H = 612;
const LEFT = 40;
const MAX_TABLE_W = PAGE_W - 2 * LEFT;
const BASE = 12;
const MIN_TABLE_SIZE = 8;

const BLACK = rgb(0, 0, 0);
const LINK_BLUE = rgb(0, 0, 238 / 255);
const BORDER = rgb(0xcb / 255, 0xcb / 255, 0xcb / 255);
const HEAD_FILL = rgb(0xe0 / 255, 0xe0 / 255, 0xe0 / 255);

const FOOTER_RULES =
  'The system of tie-breaking is based on the Constitution and Contest Rules of the the University Interscholastic League and their property';
const FOOTER_COPYRIGHT = '© 2021, Texas Theatre Adjudicators and Officials TTAO';

/** Helvetica's cap height as a fraction of the font size (to center text on a line). */
const CAP = 0.718;

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** Converts a top-down y (as measured on the page) to pdf-lib's bottom-up y. */
const fromTop = (y: number) => PAGE_H - y;

/**
 * The width text actually takes when drawn. pdf-lib's widthOfTextAtSize adds the
 * font's kerning pairs, but drawText does not kern, so its figure runs short
 * (about 5pt on the email line, which ate the space before the address).
 * Summing per-character widths matches what is drawn.
 */
function textWidth(font: PDFFont, text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += font.widthOfTextAtSize(ch, size);
  return w;
}

function drawCentered(page: PDFPage, text: string, font: PDFFont, size: number, baselineTop: number): void {
  const width = textWidth(font, text, size);
  page.drawText(text, { x: (PAGE_W - width) / 2, y: fromTop(baselineTop), size, font, color: BLACK });
}

/** Shortens text with an ellipsis until it fits `max` points. */
function fit(text: string, font: PDFFont, size: number, max: number): string {
  // The tolerance absorbs rounding: a column is sized to its widest text, which must still fit exactly.
  if (textWidth(font, text, size) <= max + 0.01) return text;
  let t = text;
  while (t.length > 1 && textWidth(font, `${t}…`, size) > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function drawTable(page: PDFPage, report: TabulationReport, fonts: Fonts, top: number): number {
  const head = ['', 'Place', ...report.judgeNames, 'Diagnostic'];
  const body = report.results.map((r) => [
    r.tie ? `${r.label} - TIE` : r.label,
    String(r.place),
    ...r.ranks.map(String),
    r.diagnostic,
  ]);

  // Columns size to their widest cell plus 1em padding each side (Pure table).
  // If the table would run off the page, shrink its type, then clip the name column.
  const widths = (size: number) =>
    head.map((h, c) =>
      Math.max(
        textWidth(fonts.bold, h, size),
        ...body.map((row) => textWidth(fonts.regular, row[c], size)),
      ) + 2 * size,
    );
  let size = BASE;
  let cols = widths(size);
  const total = () => cols.reduce((a, b) => a + b, 0);
  while (total() > MAX_TABLE_W && size > MIN_TABLE_SIZE) {
    size = Math.max(MIN_TABLE_SIZE, size - 0.5);
    cols = widths(size);
  }
  if (total() > MAX_TABLE_W) cols[0] = Math.max(4 * size, cols[0] - (total() - MAX_TABLE_W));

  const rowH = size * (25.6 / BASE);
  const tableW = total();
  const x0 = (PAGE_W - tableW) / 2;
  const rows = body.length + 1;
  const bottom = top + rows * rowH;

  page.drawRectangle({ x: x0, y: fromTop(top + rowH), width: tableW, height: rowH, color: HEAD_FILL });

  const baseline = (rowTop: number) => rowTop + rowH / 2 + (CAP * size) / 2;
  const drawRow = (cells: string[], rowTop: number, font: PDFFont) => {
    let x = x0;
    cells.forEach((text, c) => {
      const shown = fit(text, font, size, cols[c] - 2 * size);
      page.drawText(shown, { x: x + size, y: fromTop(baseline(rowTop)), size, font, color: BLACK });
      x += cols[c];
    });
  };
  drawRow(head, top, fonts.bold);
  body.forEach((cells, i) => drawRow(cells, top + (i + 1) * rowH, fonts.regular));

  // Outer border and the vertical rules between columns (Pure tables have no row rules).
  const t = 0.75;
  page.drawRectangle({
    x: x0,
    y: fromTop(bottom),
    width: tableW,
    height: bottom - top,
    borderColor: BORDER,
    borderWidth: t,
  });
  let x = x0;
  for (let c = 0; c < cols.length - 1; c++) {
    x += cols[c];
    page.drawLine({ start: { x, y: fromTop(top) }, end: { x, y: fromTop(bottom) }, thickness: t, color: BORDER });
  }
  return bottom;
}

function drawEmailLine(page: PDFPage, fonts: Fonts, baselineTop: number): void {
  const size = 18;
  const before = 'Email Tabulation the State Theatre Director at ';
  const after = ' immediately.';
  const font = fonts.bold;
  const wBefore = textWidth(font, before, size);
  const wLink = textWidth(font, STATE_THEATRE_DIRECTOR_EMAIL, size);
  const wAfter = textWidth(font, after, size);
  let x = (PAGE_W - (wBefore + wLink + wAfter)) / 2;
  const y = fromTop(baselineTop);
  page.drawText(before, { x, y, size, font, color: BLACK });
  x += wBefore;
  page.drawText(STATE_THEATRE_DIRECTOR_EMAIL, { x, y, size, font, color: LINK_BLUE });
  page.drawLine({
    start: { x, y: y - 2 },
    end: { x: x + wLink, y: y - 2 },
    thickness: 1.2,
    color: LINK_BLUE,
  });
  x += wLink;
  page.drawText(after, { x, y, size, font, color: BLACK });
}

/** Draws the report onto a fresh PDF. Exported for tests; the registry uses buildPanelTabulationPdf. */
export async function drawPanelTabulationPdf(report: TabulationReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('UIL One-Act Play Panel Tabulation');
  doc.setAuthor(DOCUMENT_AUTHOR_FULL);
  doc.setProducer(DOCUMENT_APP);
  doc.setCreator(DOCUMENT_APP);
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));

  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const page = doc.addPage([PAGE_W, PAGE_H]);

  const title = 14.4;
  page.drawText('UIL One-Act Play Panel Tabulation', {
    x: LEFT,
    y: fromTop(62.8),
    size: title,
    font: fonts.bold,
    color: BLACK,
  });

  const h2 = 10.8;
  let y = 85.8;
  for (const line of tabulationHeaderLines(report.header)) {
    page.drawText(`${line.label}: ${line.value}`, { x: LEFT, y: fromTop(y), size: h2, font: fonts.bold, color: BLACK });
    y += 20.8;
  }

  // "Results" sits 29pt under the last header line; the table 18pt under that.
  const resultsBaseline = y - 20.8 + 29.3;
  drawCentered(page, 'Results', fonts.bold, 14, resultsBaseline);
  const tableBottom = drawTable(page, report, fonts, resultsBaseline + 18);

  const emailBaseline = tableBottom + 44.2;
  drawEmailLine(page, fonts, emailBaseline);

  // Footer: 96pt below the email line as printed, pulled up if needed to stay on the page.
  const rulesBaseline = Math.min(emailBaseline + 96.2, PAGE_H - 30 - 25.2);
  drawCentered(page, FOOTER_RULES, fonts.regular, 9.6, rulesBaseline);
  drawCentered(page, FOOTER_COPYRIGHT, fonts.regular, BASE, rulesBaseline + 25.2);

  return doc.save();
}

/**
 * Registry builder. The document is offered only when the tabulation has
 * results (see the registry's availability check), so a contest without them
 * never reaches here through the UI; if it does, it fails loudly.
 */
export async function buildPanelTabulationPdf(contest: Contest): Promise<Uint8Array> {
  const report = tabulationReport(contest);
  if (!report) throw new Error('Panel Tabulation needs every judge’s ranks entered first.');
  return drawPanelTabulationPdf(report);
}

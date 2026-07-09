/**
 * Shared spreadsheet (.xlsx) utilities — the SheetJS analog of ooxml.ts.
 *
 * Ported VERBATIM from the v12 single-file app (_Templates/OAP Contest Setup.html):
 * the 8-color school palette (SCHOOL_COLORS_XLSX, ~line 1699), the styled-cell
 * helper sc() and minToFrac() (~lines 1943–1960), and the write wrapper xlsxBuf()
 * (~line 1943). The five spreadsheet generators (Contest Day Schedule, Rehearsal
 * Schedule, Contact List, Adjudicator Info, Year-Round Checklist) share these —
 * do NOT fork or "improve" the palette, fonts, sizes, number formats, or column
 * types; the golden files lock this exact output in.
 *
 * LIBRARY NOTE: v12 loaded SheetJS Community Edition 0.18.5, which SILENTLY
 * DROPS cell styling on write — so v12's shipped sheets never actually carried
 * the palette despite sc()'s style objects. We use `xlsx-js-style` (a drop-in CE
 * fork that honors the `.s` cell styles) so the colors, admin-row grey, and
 * black/white header the spec calls for are truly emitted and survive a Google
 * Sheets import (issue #20 AC3/AC4). Both builds are deterministic — no creation
 * timestamp leaks into docProps (verified), so no golden normalization is needed.
 *
 * THEME.xlsx (font/sizes/black/grey) lives in ooxml.ts and is reused here, so
 * the doc and spreadsheet layers share one theme definition. Pure: no DOM.
 */

import * as XLSX from 'xlsx-js-style';
import { THEME } from './ooxml';
import { DOCUMENT_APP, DOCUMENT_AUTHOR, DOCUMENT_AUTHOR_FULL } from './attribution';

/**
 * The 8-color school palette, in draw order (v12 SCHOOL_COLORS_XLSX). Bare hex,
 * no '#': SheetJS fills expect `fgColor.rgb` as bare RRGGBB. Schools past the 8th
 * wrap via modulo, exactly as v12 did.
 */
export const SCHOOL_COLORS_XLSX = [
  'FEF2CB',
  'B4C6E7',
  'F4B083',
  'C5E0B3',
  'FFFF00',
  'FFC000',
  'E06666',
  'CCA3FF',
] as const;

/** Minutes-since-midnight → an Excel time serial (fraction of a day). v12 minToFrac(). */
export function minToFrac(mins: number): number {
  return mins / 1440;
}

/** One styled cell as sc() emits it — a SheetJS CellObject with a `.s` style bag. */
export interface StyledCell {
  v: string | number;
  t: 's' | 'n';
  /** Number format code (v12 set both `z` and `s.numFmt` for time cells). */
  z?: string;
  s: {
    fill: { fgColor: { rgb: string }; patternType: 'solid' } | { patternType: 'none' };
    font: { name: string; sz: number; bold: boolean; color: { rgb: string } };
    alignment: { horizontal: 'left'; vertical: 'center' };
    numFmt?: string;
  };
}

/**
 * Styled cell helper — ported VERBATIM from v12 sc(). A fill `rgb` of null leaves
 * the cell unfilled; the black header fill flips the font to white. Time cells
 * (isTime) carry the "h:mm AM/PM" number format on both `z` and `s.numFmt`,
 * exactly as v12 emitted.
 */
export function sc(
  v: string | number,
  rgb: string | null,
  bold: boolean,
  isTime: boolean,
): StyledCell {
  const cell: StyledCell = {
    v,
    t: typeof v === 'number' ? 'n' : 's',
    s: {
      fill: rgb ? { fgColor: { rgb }, patternType: 'solid' } : { patternType: 'none' },
      font: {
        name: THEME.xlsx.font,
        sz: THEME.xlsx.headerSz,
        bold: !!bold,
        color: { rgb: rgb === THEME.xlsx.black ? 'FFFFFF' : THEME.xlsx.black },
      },
      alignment: { horizontal: 'left', vertical: 'center' },
    },
  };
  if (isTime && typeof v === 'number') {
    cell.z = 'h:mm AM/PM';
    cell.s.numFmt = 'h:mm AM/PM';
  }
  return cell;
}

/**
 * Writes a workbook to .xlsx bytes with cell styles preserved. v12 xlsxBuf().
 * SheetJS `type:'array'` yields an ArrayBuffer in some runtimes and a Uint8Array
 * in others; normalize to a Uint8Array so callers (the ZIP pipeline, node
 * writeFileSync in the golden harness) get a consistent, byte-addressable view.
 */
export function xlsxBuf(wb: XLSX.WorkBook): Uint8Array {
  // Authorship metadata (hidden workbook properties) — provenance, not visible
  // content. Static strings only; we deliberately do NOT set CreatedDate, so no
  // timestamp leaks into docProps and the output stays deterministic. See
  // attribution.ts.
  wb.Props = {
    ...wb.Props,
    Author: DOCUMENT_AUTHOR_FULL,
    LastAuthor: DOCUMENT_APP,
    Company: DOCUMENT_AUTHOR,
  };
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
  return out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
}

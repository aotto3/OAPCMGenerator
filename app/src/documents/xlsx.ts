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

/** A cell in a SheetBuilder row: a styled cell, a bare value, or blank (null/undefined). */
export type SheetCell = StyledCell | string | number | null | undefined;

/**
 * Fluent builder for a single-sheet workbook — the row / `!ref` / merge / column
 * bookkeeping the .xlsx generators otherwise hand-manage (`let row; ws['A'+row] =
 * …; row++; ws['!ref'] = …`). Rows are appended in order and placed across columns
 * A, B, C…; a bare value becomes a typed cell exactly as `aoa_to_sheet` would, a
 * StyledCell (from `sc()`) carries its style, and null/undefined leaves the cell
 * blank. `worksheet()` exposes the assembled sheet for tests; `buffer(name)`
 * packages it into a workbook and returns .xlsx bytes.
 *
 * Assembly delegates to `XLSX.utils.aoa_to_sheet`, so a plain value grid produces
 * byte-identical output to building the AOA directly — the migration path for the
 * existing generators is provably neutral.
 */
export interface SheetBuilder {
  /** Append one row across columns A.. ; advances the row cursor. */
  row(cells: SheetCell[]): SheetBuilder;
  /** Append an empty row (advances the cursor with no cells). */
  blank(): SheetBuilder;
  /** Set column widths in character units (v12's `wch`), left to right. */
  cols(widths: number[]): SheetBuilder;
  /** Add a merged-cell range. */
  merge(range: XLSX.Range): SheetBuilder;
  /** The assembled worksheet (cells + `!ref` / `!cols` / `!merges`). For tests. */
  worksheet(): XLSX.WorkSheet;
  /** Finalize: package the worksheet under `name`, return .xlsx bytes. */
  buffer(name: string): Uint8Array;
}

export function makeSheet(): SheetBuilder {
  const rows: SheetCell[][] = [];
  let colWidths: number[] | undefined;
  const merges: XLSX.Range[] = [];

  const worksheet = (): XLSX.WorkSheet => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (colWidths) ws['!cols'] = colWidths.map((wch) => ({ wch }));
    if (merges.length) ws['!merges'] = merges;
    return ws;
  };

  const builder: SheetBuilder = {
    row(cells) {
      rows.push(cells);
      return builder;
    },
    blank() {
      rows.push([]);
      return builder;
    },
    cols(widths) {
      colWidths = widths;
      return builder;
    },
    merge(range) {
      merges.push(range);
      return builder;
    },
    worksheet,
    buffer(name) {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, worksheet(), name);
      return xlsxBuf(wb);
    },
  };
  return builder;
}

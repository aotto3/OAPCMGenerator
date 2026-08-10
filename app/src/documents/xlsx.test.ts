import { describe, expect, it } from 'vitest';
import { makeSheet, sc } from './xlsx';
import { THEME } from './ooxml';

/**
 * Unit tests for the spreadsheet SheetBuilder — the row / !ref / merge / column
 * bookkeeping the .xlsx generators previously hand-managed. Verifying it at this
 * boundary means a layout change fails one focused test instead of only surfacing
 * as a document golden diff.
 */
describe('makeSheet — cell placement and !ref', () => {
  it('places bare values as typed cells across columns A.. and computes !ref', () => {
    const ws = makeSheet().row(['Name', 42]).row(['Bob', 7]).worksheet();
    expect(ws['A1']).toMatchObject({ v: 'Name', t: 's' });
    expect(ws['B1']).toMatchObject({ v: 42, t: 'n' });
    expect(ws['A2']).toMatchObject({ v: 'Bob', t: 's' });
    expect(ws['B2']).toMatchObject({ v: 7, t: 'n' });
    expect(ws['!ref']).toBe('A1:B2');
  });

  it('blank() advances the row cursor with no cells in that row', () => {
    const ws = makeSheet().row(['x']).blank().row(['y']).worksheet();
    expect(ws['A1'].v).toBe('x');
    expect(ws['A2']).toBeUndefined();
    expect(ws['A3'].v).toBe('y');
  });

  it('!ref spans the widest row (ragged rows extend the range)', () => {
    const ws = makeSheet().row(['title']).row(['a', 'b', 'c']).worksheet();
    expect(ws['!ref']).toBe('A1:C2');
  });

  it('rows() appends several rows in order (bulk form of row())', () => {
    const ws = makeSheet()
      .rows([
        ['a', 'b'],
        ['c', 'd'],
      ])
      .worksheet();
    expect(ws['A1'].v).toBe('a');
    expect(ws['B1'].v).toBe('b');
    expect(ws['A2'].v).toBe('c');
    expect(ws['B2'].v).toBe('d');
    expect(ws['!ref']).toBe('A1:B2');
  });
});

describe('makeSheet — columns and merges', () => {
  it('cols() sets wch widths left to right', () => {
    const ws = makeSheet().row(['a', 'b']).cols([8, 20]).worksheet();
    expect(ws['!cols']).toEqual([{ wch: 8 }, { wch: 20 }]);
  });

  it('merge() accumulates ranges in order', () => {
    const ws = makeSheet()
      .row(['a', 'b'])
      .merge({ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } })
      .merge({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } })
      .worksheet();
    expect(ws['!merges']).toEqual([
      { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
    ]);
  });
});

describe('makeSheet — styled cells (for the schedule sheets)', () => {
  it('carries a StyledCell through with its style and number format intact', () => {
    const header = sc('START', THEME.xlsx.black, true, false);
    const time = sc(0.5, null, false, true); // time cell: carries z / numFmt
    const ws = makeSheet().row([header, time]).worksheet();
    expect(ws['A1'].v).toBe('START');
    expect(ws['A1'].s).toEqual(header.s);
    expect(ws['B1'].v).toBe(0.5);
    expect(ws['B1'].z).toBe('h:mm AM/PM');
    expect(ws['B1'].s.numFmt).toBe('h:mm AM/PM');
  });
});

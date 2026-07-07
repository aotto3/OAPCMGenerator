/**
 * Golden-file + content tests for the five Slice 7 spreadsheet documents.
 *
 * Each document is built from the SHARED fixture contest and compared to an
 * approved golden archive (content-normalized — a .xlsx is a ZIP, so the same
 * unzip-and-compare harness the .docx ports use works unchanged). Every golden
 * test is paired with content-level assertions that read the sheet cells back
 * with SheetJS and assert the right times / names / orderings / palette colors,
 * so intent survives a golden regeneration.
 */

import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx-js-style';
import { withDetails, withIdentity, type Contest } from '../model/contest';
import { fixtureContest, FIXTURE_NOW } from './__fixtures__/fixtureContest';
import { expectArchiveMatchesGolden, normalizeArchive } from './goldenFile';
import { buildContestSchedule } from './contestSchedule';
import { buildRehearsalSchedule } from './rehearsalSchedule';
import { buildContactList } from './contactList';
import { buildAdjudicatorInfo } from './adjudicatorInfo';
import { buildChecklist } from './checklist';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'golden');
const goldenPath = (filename: string) => join(GOLDEN_DIR, filename);

/** Reads the first worksheet back with cell styles preserved. */
function firstSheet(bytes: Uint8Array): { name: string; ws: XLSX.WorkSheet } {
  const wb = XLSX.read(bytes, { type: 'array', cellStyles: true });
  const name = wb.SheetNames[0];
  return { name, ws: wb.Sheets[name] };
}

/** Every cell's displayed text (formatted `w` when present, else raw `v`), row-major. */
function cellTexts(ws: XLSX.WorkSheet): string[] {
  const out: string[] = [];
  const range = XLSX.utils.decode_range(ws['!ref'] as string);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v != null) out.push(String(cell.w != null ? cell.w : cell.v));
    }
  }
  return out;
}

/** The 1-based row index whose column-C (WHAT) text equals `label`, or -1. */
function rowWhere(ws: XLSX.WorkSheet, label: string): number {
  const range = XLSX.utils.decode_range(ws['!ref'] as string);
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cell = ws['C' + (r + 1)];
    if (cell && String(cell.v) === label) return r + 1;
  }
  return -1;
}

/**
 * Bare-hex fill color of a cell. On read-back the fork flattens the fill onto
 * `s` itself (`{ patternType, fgColor:{ rgb } }`), not under `s.fill`; an FF
 * alpha prefix may or may not be present, so strip it.
 */
function fillOf(ws: XLSX.WorkSheet, addr: string): string {
  const cell = ws[addr] as { s?: { fgColor?: { rgb?: string } } } | undefined;
  const rgb = cell?.s?.fgColor?.rgb ?? '';
  return rgb.length === 8 && rgb.startsWith('FF') ? rgb.slice(2) : rgb;
}

const DOCUMENTS: Array<{ filename: string; build: (c: Contest) => Uint8Array }> = [
  { filename: 'Contest Day Schedule.xlsx', build: buildContestSchedule },
  { filename: 'Schedule - Reh. and Contest.xlsx', build: buildRehearsalSchedule },
  { filename: 'School-Director Contact List.xlsx', build: buildContactList },
  { filename: 'Adjudicator Info Sheet.xlsx', build: buildAdjudicatorInfo },
  { filename: 'Year-Round Checklist.xlsx', build: buildChecklist },
];

describe.each(DOCUMENTS)('$filename', ({ filename, build }) => {
  it('matches the approved golden file (content-normalized)', async () => {
    await expectArchiveMatchesGolden(build(fixtureContest()), goldenPath(filename));
  });

  it('is deterministic — same contest yields identical archive content', async () => {
    const [na, nb] = [await normalizeArchive(build(fixtureContest())), await normalizeArchive(build(fixtureContest()))];
    expect([...na.entries()]).toEqual([...nb.entries()]);
  });

  it('is a structurally valid .xlsx with one worksheet', () => {
    const wb = XLSX.read(build(fixtureContest()), { type: 'array' });
    expect(wb.SheetNames).toHaveLength(1);
    expect(wb.Sheets[wb.SheetNames[0]]['!ref']).toBeTruthy();
  });
});

describe('Contest Day Schedule — content', () => {
  it('titles by contest + date, names the sheet by date, and orders shows by draw', () => {
    const { name, ws } = firstSheet(buildContestSchedule(fixtureContest()));
    const texts = cellTexts(ws);
    expect(name).toBe('March 21, 2026');
    expect(texts[0]).toBe('2026 UIL 5A District 20 One-Act Play Contest — March 21, 2026');
    expect(texts).toContain('START');
    expect(texts).toContain('SCHOOL');
    // Directors' meeting + CM arrival rows the sheet builds itself.
    expect(texts).toContain('CM Arrival');
    expect(texts).toContain("Director's Meeting");
    // Bravo (draw 1) performs before Alpha (draw 3).
    const joined = texts.join('\n');
    expect(joined.indexOf('Bravo HS — Setup and Performance')).toBeGreaterThan(0);
    expect(joined.indexOf('Bravo HS — Setup and Performance')).toBeLessThan(joined.indexOf('Alpha HS — Performance'));
  });

  it('paints shows in the palette, the header black, and admin rows grey', () => {
    const { ws } = firstSheet(buildContestSchedule(fixtureContest()));
    const header = rowWhere(ws, 'WHAT');
    expect(fillOf(ws, 'C' + header)).toBe('000000');
    const firstShow = rowWhere(ws, 'Bravo HS — Setup and Performance');
    expect(fillOf(ws, 'A' + firstShow)).toBe('FEF2CB'); // SCHOOL_COLORS[0]
    const tab = rowWhere(ws, "Judge's Tabulation");
    expect(fillOf(ws, 'A' + tab)).toBe('DADADA'); // THEME.xlsx.grey
  });

  it('formats the first-show start as a 12-hour clock time', () => {
    const { ws } = firstSheet(buildContestSchedule(fixtureContest()));
    const firstShow = rowWhere(ws, 'Bravo HS — Setup and Performance');
    expect(ws['A' + firstShow].w).toBe('10:00 AM');
  });

  it('produces only the meeting rows (no timeline) when the first-show time is unset', () => {
    const noShow = withDetails(fixtureContest(), { firstShowTime: '' }, FIXTURE_NOW);
    const { ws } = firstSheet(buildContestSchedule(noShow));
    const texts = cellTexts(ws);
    expect(texts).toContain("Director's Meeting");
    expect(texts.join('\n')).not.toContain('Setup and Performance');
  });
});

describe('Rehearsal + Contest Schedule — content', () => {
  it('renders two dated rehearsal sections split 3/3 and the contest section', () => {
    const { name, ws } = firstSheet(buildRehearsalSchedule(fixtureContest()));
    const texts = cellTexts(ws);
    expect(name).toBe('Schedule');
    expect(texts).toContain('Thursday, March 19, 2026'); // rehearsal day 1
    expect(texts).toContain('Friday, March 20, 2026'); // rehearsal day 2
    expect(texts).toContain('Saturday, March 21, 2026'); // contest day
    expect(texts).toContain('School 1 Rehearsal');
    expect(texts).toContain('School 4 Rehearsal'); // day-2 ordinal continues
    expect(texts).toContain('Bravo HS — The Crucible'); // draw 1, day 1
    expect(texts).toContain('CM Arrival');
  });

  it('collapses to one continuous section when rehearsal day 1 is the contest day', () => {
    const same = withDetails(fixtureContest(), { rehearsalDate1: '2026-03-21', rehearsalDate2: '' }, FIXTURE_NOW);
    const texts = cellTexts(firstSheet(buildRehearsalSchedule(same)).ws);
    // No dated section headers in the same-day layout.
    expect(texts).not.toContain('Saturday, March 21, 2026');
    expect(texts).toContain('School 1 Rehearsal');
    expect(texts).toContain('School 6 Rehearsal'); // all six on the one day
  });

  it('colors the first rehearsal slot with the first palette color', () => {
    const { ws } = firstSheet(buildRehearsalSchedule(fixtureContest()));
    const r = rowWhere(ws, 'School 1 Rehearsal');
    expect(fillOf(ws, 'A' + r)).toBe('FEF2CB');
  });
});

describe('School–Director Contact List — content', () => {
  it('lists schools in draw order with directors, CM row, and all-email list', () => {
    const texts = cellTexts(firstSheet(buildContactList(fixtureContest())).ws);
    const joined = texts.join('\n');
    expect(texts).toContain('School & Director Contact List');
    expect(texts).toContain('Additional Directors');
    expect(texts).toContain('Bravo HS Director');
    expect(texts).toContain('dir2@example.com'); // Bravo's director email (names index 1)
    // Draw order: Bravo (1) before Alpha (3).
    expect(joined.indexOf('Bravo HS')).toBeLessThan(joined.indexOf('Alpha HS'));
    expect(texts).toContain('Contest Manager:');
    // All-director email list is performance-ordered, comma-joined.
    expect(joined).toContain('dir2@example.com, dir4@example.com, dir1@example.com');
  });
});

describe('Adjudicator Info Sheet — content', () => {
  it('renders contest details, the judge panel, and CM block', () => {
    const texts = cellTexts(firstSheet(buildAdjudicatorInfo(fixtureContest())).ws);
    expect(texts).toContain('Adjudicator Information Sheet');
    expect(texts).toContain('Saturday, March 21, 2026'); // fmtDate(contestDate)
    expect(texts).toContain('Performing Arts Center — Sharpstown High School');
    expect(texts).toContain('After all performances');
    expect(texts).toContain('Dr. Jane Judge');
    expect(texts).toContain('100 Main St, Austin, TX 78701');
    expect(texts).toContain('Ms. Mary Adjudicator'); // 3rd judge present
  });

  it('shows TBA placeholders for an unnamed judge and reflects the critique format', () => {
    const noName = fixtureContest();
    noName.adjudicators[0].name = '';
    noName.adjudicators[0].mailingAddress = '';
    const each = withDetails(noName, { critiqueFormat: 'after_each' }, FIXTURE_NOW);
    const texts = cellTexts(firstSheet(buildAdjudicatorInfo(each)).ws);
    expect(texts).toContain('TBA');
    expect(texts).toContain('Address TBA');
    expect(texts).toContain('After each performance');
  });
});

describe('Year-Round Checklist — content', () => {
  it('renders the header, the Done/Task/Notes columns, and phase rows with prefixes', () => {
    const { name, ws } = firstSheet(buildChecklist(fixtureContest()));
    const texts = cellTexts(ws);
    expect(name).toBe('Year-Round Checklist');
    expect(texts).toContain('2026 UIL 5A District 20 One-Act Play Contest');
    expect(texts).toContain('UIL OAP Contest Manager — Year-Round Checklist');
    expect(texts).toContain('Done?');
    expect(texts).toContain('PHASE 0 — Upon Appointment');
    // note rows carry ●, sub-items carry "    → ".
    expect(texts).toContain('● Enrollment list is tentative until after October 1 — confirm final participating schools after that date.');
    expect(texts).toContain('    → Arrange hotel, travel, and meals per contract');
    expect(texts).toContain('PHASE 8 — Post-Contest');
  });
});

/** Guards the two documents that key layout on identity — not just the fixture. */
describe('identity-driven variations', () => {
  it("titles the contest schedule with a Zone contest's derived name", () => {
    const zone = withIdentity(fixtureContest(), { contestLevel: 'Zone', districtNumber: '' }, FIXTURE_NOW);
    const texts = cellTexts(firstSheet(buildContestSchedule(zone)).ws);
    expect(texts[0]).toContain('2026 UIL 5A Zone One-Act Play Contest');
  });
});

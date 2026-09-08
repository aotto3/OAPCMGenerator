/**
 * Contest Day Schedule (.xlsx) — the color-coded contest-day timeline.
 *
 * Ported from v12 genContestSchedule / renderScheduleXLSX (_Templates/OAP
 * Contest Setup.html, ~lines 1961–2006). START / END / WHAT / SCHOOL columns;
 * each show and its transition wear the school's palette color, admin rows
 * (tabulation / critiques / awards) go grey, the header row is black-on-white.
 *
 * TIMING COMES FROM THE ENGINE (issue #20 AC2 — no duplicated timing math).
 * computeSchedule() is the ported schedule engine; it also prepends a directors'-
 * meeting row (type 'dm'), but this sheet builds its OWN Director's Meeting + CM
 * Arrival rows exactly as v12's renderScheduleXLSX did (a fixed 30-minute meeting
 * block colored with the first school's palette color, and CM arrival two hours
 * before), so the engine's 'dm' row is filtered out and only its show/trans/
 * admin/crit/awards events are consumed.
 *
 * ASSEMBLY via the shared SheetBuilder (xlsx.ts) — declarative rows, no A1
 * address arithmetic. The dimension is pinned with `.ref()` to reproduce v12's
 * inclusive `!ref` (one row past the last cell), so the golden stays byte-identical.
 *
 * Pure: no DOM. Synchronous.
 */

import * as XLSX from 'xlsx-js-style';
import { contestTitleLong, type Contest } from '../model/contest';
import { computeSchedule, parseTime } from '../model/schedule';
import { fmtDateShort } from './format';
import { THEME } from './ooxml';
import { SCHOOL_COLORS_XLSX, makeSheet, minToFrac, sc } from './xlsx';

export function buildContestSchedule(contest: Contest): Uint8Array {
  const SCHOOL_COLORS = SCHOOL_COLORS_XLSX;
  const dateShort = fmtDateShort(contest.details.contestDate);
  // Engine timeline minus its 'dm' prepend — this sheet renders the meeting itself.
  const events = computeSchedule(contest).filter((ev) => ev.type !== 'dm');

  // One-off cells sc() does not model: the title (title-size, no fill) and the two
  // footnotes (footnote-size italic / bold). Ported verbatim from v12.
  const title: XLSX.CellObject = {
    v: contestTitleLong(contest.identity) + ' — ' + (dateShort || 'Date TBD'),
    t: 's',
    s: { font: { bold: true, sz: THEME.xlsx.titleSz, name: THEME.xlsx.font }, fill: { patternType: 'none' } },
  };
  const footnote1: XLSX.CellObject = {
    v: '** Written evaluation sheets will be given to schools at the end of the contest.',
    t: 's',
    s: { font: { name: THEME.xlsx.font, sz: THEME.xlsx.footnoteSz, italic: true } },
  };
  const footnote2: XLSX.CellObject = {
    v: '**ALL PERFORMANCES WILL BE BACK TO BACK - TIMES ARE APPROXIMATE',
    t: 's',
    s: { font: { bold: true, name: THEME.xlsx.font, sz: THEME.xlsx.footnoteSz } },
  };

  const sheet = makeSheet()
    .row([title]) // v12 left row 2 blank (a double row++), so a gap follows the title.
    .blank()
    .row([
      sc('START', THEME.xlsx.black, true, false),
      sc('END', THEME.xlsx.black, true, false),
      sc('WHAT', THEME.xlsx.black, true, false),
      sc('SCHOOL', THEME.xlsx.black, true, false),
    ]);

  // v12 read directors_meeting_time as `<field> || 'TBD'`; parseTime('TBD') is null.
  const dmMins = parseTime(contest.details.directorsMeetingTime || 'TBD');
  if (dmMins != null) {
    sheet.row([sc(minToFrac(dmMins - 120), null, false, true), undefined, sc('CM Arrival', null, false, false)]);
    sheet.row([
      sc(minToFrac(dmMins), THEME.xlsx.grey, false, true),
      sc(minToFrac(dmMins + 30), THEME.xlsx.grey, false, true),
      sc("Director's Meeting", THEME.xlsx.grey, false, false),
    ]);
  }

  events.forEach((ev) => {
    const rgb =
      ev.type === 'show' || ev.type === 'trans'
        ? SCHOOL_COLORS[ev.colorIdx % SCHOOL_COLORS.length]
        : THEME.xlsx.grey;
    sheet.row([
      sc(minToFrac(ev.start), rgb, false, true),
      sc(minToFrac(ev.end), rgb, false, true),
      sc(ev.label, rgb, false, false),
      sc(ev.type === 'show' && ev.play ? ev.play : ev.school || '', rgb, false, false),
    ]);
  });

  sheet
    .blank() // v12 row++ gap before the footnotes
    .row([undefined, undefined, footnote1])
    .row([undefined, undefined, footnote2]);

  return sheet
    .merge({ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } })
    .cols([12, 12, 52, 34])
    .ref('A1:D' + (sheet.rowCount() + 1)) // v12's inclusive dimension: one row past the last cell.
    .buffer(dateShort || 'Contest Day');
}

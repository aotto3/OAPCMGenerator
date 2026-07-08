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
 * Pure: no DOM. Synchronous — XLSX.write packs the workbook directly.
 */

import * as XLSX from 'xlsx-js-style';
import { contestTitleLong, type Contest } from '../model/contest';
import { computeSchedule, parseTime } from '../model/schedule';
import { fmtDateShort } from './format';
import { THEME } from './ooxml';
import { SCHOOL_COLORS_XLSX, minToFrac, sc, xlsxBuf } from './xlsx';

export function buildContestSchedule(contest: Contest): Uint8Array {
  const SCHOOL_COLORS = SCHOOL_COLORS_XLSX;
  const dateShort = fmtDateShort(contest.details.contestDate);
  // Engine timeline minus its 'dm' prepend — this sheet renders the meeting itself.
  const events = computeSchedule(contest).filter((ev) => ev.type !== 'dm');

  const wb = XLSX.utils.book_new();
  const ws: XLSX.WorkSheet = {};
  let row = 1;

  ws['A' + row] = {
    v: contestTitleLong(contest.identity) + ' — ' + (dateShort || 'Date TBD'),
    t: 's',
    s: { font: { bold: true, sz: THEME.xlsx.titleSz, name: THEME.xlsx.font }, fill: { patternType: 'none' } },
  };
  const merges: XLSX.Range[] = [{ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 3 } }];
  row++;
  row++;

  ['A', 'B', 'C', 'D'].forEach((col, ci) => {
    ws[col + row] = sc(['START', 'END', 'WHAT', 'SCHOOL'][ci], THEME.xlsx.black, true, false);
  });
  row++;

  // v12 read directors_meeting_time as `<field> || 'TBD'`; parseTime('TBD') is null.
  const dmMins = parseTime(contest.details.directorsMeetingTime || 'TBD');
  if (dmMins != null) {
    ws['A' + row] = sc(minToFrac(dmMins - 120), null, false, true);
    ws['C' + row] = sc('CM Arrival', null, false, false);
    row++;
    ws['A' + row] = sc(minToFrac(dmMins), THEME.xlsx.grey, false, true);
    ws['B' + row] = sc(minToFrac(dmMins + 30), THEME.xlsx.grey, false, true);
    ws['C' + row] = sc("Director's Meeting", THEME.xlsx.grey, false, false);
    row++;
  }

  events.forEach((ev) => {
    const rgb =
      ev.type === 'show' || ev.type === 'trans'
        ? SCHOOL_COLORS[ev.colorIdx % SCHOOL_COLORS.length]
        : THEME.xlsx.grey;
    ws['A' + row] = sc(minToFrac(ev.start), rgb, false, true);
    ws['B' + row] = sc(minToFrac(ev.end), rgb, false, true);
    ws['C' + row] = sc(ev.label, rgb, false, false);
    ws['D' + row] = sc(ev.type === 'show' && ev.play ? ev.play : ev.school || '', rgb, false, false);
    row++;
  });

  row++;
  ws['C' + row] = {
    v: '** Written evaluation sheets will be given to schools at the end of the contest.',
    t: 's',
    s: { font: { name: THEME.xlsx.font, sz: THEME.xlsx.footnoteSz, italic: true } },
  };
  row++;
  ws['C' + row] = {
    v: '**ALL PERFORMANCES WILL BE BACK TO BACK - TIMES ARE APPROXIMATE',
    t: 's',
    s: { font: { bold: true, name: THEME.xlsx.font, sz: THEME.xlsx.footnoteSz } },
  };

  ws['!ref'] = 'A1:D' + (row + 1);
  ws['!merges'] = merges;
  ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 52 }, { wch: 34 }];
  XLSX.utils.book_append_sheet(wb, ws, dateShort || 'Contest Day');
  return xlsxBuf(wb);
}

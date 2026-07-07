/**
 * Rehearsal + Contest Schedule (.xlsx) — rehearsal day(s) followed by the
 * contest-day timeline, in one color-coded sheet.
 *
 * Ported from v12 genRehearsalSchedule (_Templates/OAP Contest Setup.html,
 * ~lines 2011–2116). Three layouts, exactly as v12:
 *   • SAME-DAY  (rehearsal day 1 === contest date): one continuous schedule, no
 *     dated section headers, CM arrival one hour before rehearsals start.
 *   • ONE REHEARSAL DAY: a "Rehearsal Day 1" section (all schools) then a dated
 *     contest section.
 *   • TWO REHEARSAL DAYS: schools split across two dated sections (day-1 count
 *     from the model), then the contest section.
 * Each rehearsal/show row wears the school's palette color; a fixed 10-minute
 * transition pads every rehearsal slot (slotLen = length + 10).
 *
 * TIMING COMES FROM THE ENGINE (issue #20 AC2). The contest-day rows reuse
 * computeSchedule() — the ported schedule engine — filtering out its 'dm'
 * prepend and rebuilding v12's own CM Arrival + 30-minute Director's Meeting
 * rows, identical to the Contest Day Schedule sheet.
 *
 * Pure: no DOM. Synchronous — XLSX.write packs the workbook directly.
 */

import * as XLSX from 'xlsx-js-style';
import { contestTitleLong, rehearsalDay1Count, type Contest } from '../model/contest';
import { computeSchedule, parseTime } from '../model/schedule';
import { docSchools } from './docVars';
import { fmtDate } from './format';
import { THEME } from './ooxml';
import { SCHOOL_COLORS_XLSX, minToFrac, sc, xlsxBuf } from './xlsx';

const HEADERS = ['START', 'END', 'WHAT', 'SCHOOL'] as const;
const COLS = ['A', 'B', 'C', 'D'] as const;

export function buildRehearsalSchedule(contest: Contest): Uint8Array {
  const SCHOOL_COLORS = SCHOOL_COLORS_XLSX;
  const d = contest.details;
  const slotLen = d.rehearsalLengthMinutes + 10; // rehearsal time + 10-min transition
  const wb = XLSX.utils.book_new();
  const ws: XLSX.WorkSheet = {};
  let row = 1;
  const merges: XLSX.Range[] = [];

  // v12 read these times with a '2:00 PM' fallback and the meeting time with 'TBD'.
  const rehearsalStart = parseTime(d.rehearsalStartTime1 || '2:00 PM');
  const rehearsalStart2 = parseTime(d.rehearsalStartTime2 || d.rehearsalStartTime1 || '2:00 PM');
  const dmTime = d.directorsMeetingTime || 'TBD';

  // Layout flags — schools already in performance order with v12's name/play fallbacks.
  const schools = docSchools(contest);
  const sameDay = !!(d.rehearsalDate1 && d.contestDate && d.rehearsalDate1 === d.contestDate);
  const hasDay2 = !!d.rehearsalDate2;
  const day1Count = hasDay2 ? rehearsalDay1Count(contest) : schools.length;
  const day1Schools = schools.slice(0, day1Count);
  const day2Schools = hasDay2 ? schools.slice(day1Count) : [];

  // ── Helpers ─────────────────────────────────────────────────────
  function addSectionHeader(label: string): void {
    ws['A' + row] = { v: label, t: 's', s: { font: { bold: true, sz: THEME.xlsx.headerSz, name: THEME.xlsx.font } } };
    merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 3 } });
    row++;
    HEADERS.forEach((h, ci) => {
      ws[COLS[ci] + row] = sc(h, THEME.xlsx.black, true, false);
    });
    row++;
  }

  function addRehearsalRows(rows: typeof schools, startMins: number | null, startOrdinal: number): void {
    let t = startMins != null ? startMins : 14 * 60;
    rows.forEach((s, i) => {
      const rgb = SCHOOL_COLORS[(startOrdinal + i) % SCHOOL_COLORS.length];
      ws['A' + row] = sc(minToFrac(t), rgb, false, true);
      ws['B' + row] = sc(minToFrac(t + slotLen), rgb, false, true);
      ws['C' + row] = sc('School ' + (startOrdinal + i + 1) + ' Rehearsal', rgb, false, false);
      ws['D' + row] = sc(s.name + (s.play ? ' — ' + s.play : ''), rgb, false, false);
      row++;
      t += slotLen;
    });
  }

  function addContestRows(cmArrivalMins: number): void {
    ws['A' + row] = sc(minToFrac(cmArrivalMins), null, false, true);
    ws['C' + row] = sc('CM Arrival', null, false, false);
    row++;
    const dmMins = parseTime(dmTime);
    if (dmMins != null) {
      ws['A' + row] = sc(minToFrac(dmMins), SCHOOL_COLORS[0], false, true);
      ws['B' + row] = sc(minToFrac(dmMins + 30), SCHOOL_COLORS[0], false, true);
      ws['C' + row] = sc("Director's Meeting", SCHOOL_COLORS[0], false, false);
      row++;
    }
    const events = computeSchedule(contest).filter((ev) => ev.type !== 'dm');
    events.forEach((ev) => {
      const rgb =
        ev.type === 'show' || ev.type === 'trans'
          ? SCHOOL_COLORS[ev.colorIdx % SCHOOL_COLORS.length]
          : THEME.xlsx.grey;
      ws['A' + row] = sc(minToFrac(ev.start), rgb, false, true);
      ws['B' + row] = sc(minToFrac(ev.end), rgb, false, true);
      ws['C' + row] = sc(ev.label, rgb, false, false);
      const dVal =
        ev.type === 'show' ? (ev.school || '') + (ev.play ? ' — ' + ev.play : '') : ev.school || '';
      ws['D' + row] = sc(dVal, rgb, false, false);
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
    row++;
  }

  // ── Title ────────────────────────────────────────────────────────
  ws['A' + row] = {
    v: contestTitleLong(contest.identity),
    t: 's',
    s: { font: { bold: true, sz: THEME.xlsx.titleSz, name: THEME.xlsx.font } },
  };
  merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 3 } });
  row++;

  if (sameDay) {
    // ── ONE-DAY: continuous schedule, no date section headers ──────
    HEADERS.forEach((h, ci) => {
      ws[COLS[ci] + row] = sc(h, THEME.xlsx.black, true, false);
    });
    row++;
    addRehearsalRows(schools, rehearsalStart, 0);
    row++; // blank gap before contest rows
    const cmArr = (rehearsalStart ?? 14 * 60) - 60;
    addContestRows(cmArr);
  } else {
    // ── MULTI-DAY: dated sections — rehearsal day(s) then contest ──
    addSectionHeader(fmtDate(d.rehearsalDate1) || 'Rehearsal Day 1');
    addRehearsalRows(day1Schools, rehearsalStart, 0);
    if (hasDay2) {
      row++;
      addSectionHeader(fmtDate(d.rehearsalDate2) || 'Rehearsal Day 2');
      addRehearsalRows(day2Schools, rehearsalStart2, day1Count);
    }
    row++;
    addSectionHeader(fmtDate(d.contestDate) || 'Contest Day');
    const dmMins = parseTime(dmTime);
    const cmArr = dmMins != null ? dmMins - 120 : (rehearsalStart ?? 14 * 60);
    addContestRows(cmArr);
  }

  ws['!ref'] = 'A1:D' + (row + 1);
  ws['!merges'] = merges;
  ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 44 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
  return xlsxBuf(wb);
}

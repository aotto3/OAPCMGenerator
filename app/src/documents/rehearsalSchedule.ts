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
 * ASSEMBLY via the shared SheetBuilder (xlsx.ts) — declarative rows, no A1
 * address arithmetic. The dimension is pinned with `.ref()` to reproduce v12's
 * inclusive `!ref` (two rows past the last cell — a blank gap plus the inclusive
 * end), so the golden stays byte-identical.
 *
 * Pure: no DOM. Synchronous.
 */

import * as XLSX from 'xlsx-js-style';
import { contestTitleLong, rehearsalDay1Count, type Contest } from '../model/contest';
import { computeContestDay, computeSchedule, isSameDayRehearsal, parseTime } from '../model/schedule';
import { docSchools } from './docVars';
import { fmtDate } from './format';
import { THEME } from './ooxml';
import { SCHOOL_COLORS_XLSX, makeSheet, minToFrac, sc } from './xlsx';

export function buildRehearsalSchedule(contest: Contest): Uint8Array {
  const SCHOOL_COLORS = SCHOOL_COLORS_XLSX;
  const d = contest.details;
  const slotLen = d.rehearsalLengthMinutes + 10; // rehearsal time + 10-min transition
  const sheet = makeSheet();

  // v12 read these times with a '2:00 PM' fallback and the meeting time with 'TBD'.
  const rehearsalStart = parseTime(d.rehearsalStartTime1 || '2:00 PM');
  const rehearsalStart2 = parseTime(d.rehearsalStartTime2 || d.rehearsalStartTime1 || '2:00 PM');
  const dmTime = d.directorsMeetingTime || 'TBD';

  // Layout flags — schools already in performance order with v12's name/play fallbacks.
  const schools = docSchools(contest);
  const sameDay = isSameDayRehearsal(contest);
  const hasDay2 = !!d.rehearsalDate2;
  const day1Count = hasDay2 ? rehearsalDay1Count(contest) : schools.length;
  const day1Schools = schools.slice(0, day1Count);
  const day2Schools = hasDay2 ? schools.slice(day1Count) : [];

  const headerRow = () => [
    sc('START', THEME.xlsx.black, true, false),
    sc('END', THEME.xlsx.black, true, false),
    sc('WHAT', THEME.xlsx.black, true, false),
    sc('SCHOOL', THEME.xlsx.black, true, false),
  ];
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

  // ── Helpers ─────────────────────────────────────────────────────
  function addSectionHeader(label: string): void {
    const at = sheet.rowCount(); // 0-based row of the (merged) label about to be pushed
    sheet.row([{ v: label, t: 's', s: { font: { bold: true, sz: THEME.xlsx.headerSz, name: THEME.xlsx.font } } }]);
    sheet.merge({ s: { r: at, c: 0 }, e: { r: at, c: 3 } });
    sheet.row(headerRow());
  }

  function addRehearsalRows(rows: typeof schools, startMins: number | null, startOrdinal: number): void {
    let t = startMins != null ? startMins : 14 * 60;
    rows.forEach((s, i) => {
      const rgb = SCHOOL_COLORS[(startOrdinal + i) % SCHOOL_COLORS.length];
      sheet.row([
        sc(minToFrac(t), rgb, false, true),
        sc(minToFrac(t + slotLen), rgb, false, true),
        sc('School ' + (startOrdinal + i + 1) + ' Rehearsal', rgb, false, false),
        sc(s.name + (s.play ? ' — ' + s.play : ''), rgb, false, false),
      ]);
      t += slotLen;
    });
  }

  function addContestRows(cmArrivalMins: number, skipArrival = false): void {
    if (!skipArrival) {
      sheet.row([sc(minToFrac(cmArrivalMins), null, false, true), undefined, sc('CM Arrival', null, false, false)]);
    }
    const dmMins = parseTime(dmTime);
    if (dmMins != null) {
      sheet.row([
        sc(minToFrac(dmMins), SCHOOL_COLORS[0], false, true),
        sc(minToFrac(dmMins + 30), SCHOOL_COLORS[0], false, true),
        sc("Director's Meeting", SCHOOL_COLORS[0], false, false),
      ]);
    }
    const events = computeSchedule(contest).filter((ev) => ev.type !== 'dm');
    events.forEach((ev) => {
      const rgb =
        ev.type === 'show' || ev.type === 'trans'
          ? SCHOOL_COLORS[ev.colorIdx % SCHOOL_COLORS.length]
          : THEME.xlsx.grey;
      const dVal =
        ev.type === 'show' ? (ev.school || '') + (ev.play ? ' — ' + ev.play : '') : ev.school || '';
      sheet.row([
        sc(minToFrac(ev.start), rgb, false, true),
        sc(minToFrac(ev.end), rgb, false, true),
        sc(ev.label, rgb, false, false),
        sc(dVal, rgb, false, false),
      ]);
    });
    sheet
      .blank() // v12 row++ gap before the footnotes
      .row([undefined, undefined, footnote1])
      .row([undefined, undefined, footnote2])
      .blank(); // v12 trailing row++ after the footnotes (extends the dimension)
  }

  // ── Title ────────────────────────────────────────────────────────
  sheet.row([
    { v: contestTitleLong(contest.identity), t: 's', s: { font: { bold: true, sz: THEME.xlsx.titleSz, name: THEME.xlsx.font } } },
  ]);
  sheet.merge({ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } });

  if (sameDay) {
    // ── ONE-DAY: continuous schedule, no date section headers ──────
    // Rehearsal + arrival timing comes from the engine (computeContestDay), so
    // CM Arrival leads the day (fixing v12's out-of-order arrival row) and the
    // sheet reads identically to the live preview. The contest portion (its own
    // Director's Meeting block + the timeline + footnotes) is rendered by
    // addContestRows with the arrival suppressed — the engine already emitted it.
    sheet.row(headerRow());
    for (const ev of computeContestDay(contest)) {
      if (ev.type === 'arrival') {
        sheet.row([sc(minToFrac(ev.start), null, false, true), undefined, sc('CM Arrival', null, false, false)]);
      } else if (ev.type === 'rehearsal') {
        const rgb = SCHOOL_COLORS[ev.colorIdx % SCHOOL_COLORS.length];
        sheet.row([
          sc(minToFrac(ev.start), rgb, false, true),
          sc(minToFrac(ev.end), rgb, false, true),
          sc(ev.label, rgb, false, false),
          sc(ev.school + (ev.play ? ' — ' + ev.play : ''), rgb, false, false),
        ]);
      }
      // 'dm' and the contest events are rendered by addContestRows below, so the
      // sheet keeps its 30-minute Director's Meeting block and footnotes.
    }
    sheet.blank(); // blank gap before contest rows
    addContestRows(0, true);
  } else {
    // ── MULTI-DAY: dated sections — rehearsal day(s) then contest ──
    addSectionHeader(fmtDate(d.rehearsalDate1) || 'Rehearsal Day 1');
    addRehearsalRows(day1Schools, rehearsalStart, 0);
    if (hasDay2) {
      sheet.blank();
      addSectionHeader(fmtDate(d.rehearsalDate2) || 'Rehearsal Day 2');
      addRehearsalRows(day2Schools, rehearsalStart2, day1Count);
    }
    sheet.blank();
    addSectionHeader(fmtDate(d.contestDate) || 'Contest Day');
    const dmMins = parseTime(dmTime);
    const cmArr = dmMins != null ? dmMins - 120 : (rehearsalStart ?? 14 * 60);
    addContestRows(cmArr);
  }

  return sheet
    .cols([12, 12, 44, 36])
    .ref('A1:D' + (sheet.rowCount() + 1)) // v12's inclusive dimension.
    .buffer('Schedule');
}

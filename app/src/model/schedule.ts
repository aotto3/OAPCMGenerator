/**
 * Schedule engine — the pure contest-day timeline calculator.
 *
 * PURE MODULE. No React, no DOM, no IndexedDB, no fetch. A contest record (plus
 * an optional, currently-empty overrides object) goes in; a flat list of
 * ScheduleEvents comes out. It runs identically in the live preview, the
 * Contest Day Schedule .xlsx generator (a later slice), and tests.
 *
 * Behavior spec: the v12 single-file app (_Templates/OAP Contest Setup.html),
 * calculateSchedule()/parseTime()/fmtTime() and renderScheduleHTML()'s
 * directors-meeting prepend. The math is ported EXACTLY — do not "improve" it:
 * the .xlsx schedule document depends on identical output, and the golden-file
 * tests lock it in.
 *
 * PRESENTATION stays out of here. Each event carries a `colorIdx` (the school
 * index for shows, 0 for the directors' meeting, -1 for admin/critique/awards),
 * exactly as v12 does — but the actual color palette and any HTML/cell styling
 * belong to the view and document layers, never to this engine.
 */

import {
  addBreak,
  removeBreak,
  updateBreak,
  schoolsInPerformanceOrder,
  type Contest,
  type ScheduleOverrides,
  type School,
} from './contest';

/* ── v12 schedule constants (calculateSchedule + CRIT_MINS_PER_SHOW). ── */
/** First school: setup(7) + performance(40) + buffer(3). */
const FIRST_SLOT = 50;
/** Every subsequent school: performance only. */
const PERF_ONLY = 40;
/** after_each transition: strike + critique + next setup. */
const EACH_TRANS = 25;
/** after_all transition: strike + next setup only (also the final strike). */
const ALL_TRANS = 15;
const TABULATION = 30;
const AWARDS = 30;
/** Minutes allocated per critique slot per judge (v12 CRIT_MINS_PER_SHOW). */
const CRIT_MINS_PER_SHOW = 15;

/** What a timeline row is. Drives both the preview and the .xlsx generator.
 *  'arrival'/'rehearsal' appear only on a same-day rehearsal timeline (PRD #179;
 *  see computeContestDay); 'break' is an inserted manual gap (applyOverrides);
 *  computeSchedule()'s own cascade emits only dm/show/trans/admin/crit/awards. */
export type ScheduleEventType =
  | 'arrival'
  | 'dm'
  | 'rehearsal'
  | 'show'
  | 'trans'
  | 'break'
  | 'admin'
  | 'crit'
  | 'awards';

export interface ScheduleEvent {
  /** Minutes since midnight. */
  start: number;
  end: number;
  /** Duration in minutes (end - start). */
  dur: number;
  /** Row label, e.g. "Lincoln HS — Performance". */
  label: string;
  /** Play title — '' unless this row is a show. */
  play: string;
  /** School name — '' unless this row is a show. */
  school: string;
  type: ScheduleEventType;
  /** School index for shows, 0 for the directors' meeting, -1 for everything
   *  else. The view maps this onto the color palette; the engine never does. */
  colorIdx: number;
  /** Set only on a 'break' row — the InsertedGap id that produced it, so the UI
   *  can target it for removal (PRD #179). */
  overrideId?: string;
}

/**
 * Parses a 12-hour (or 24-hour) time string into minutes-since-midnight, or
 * null for empty / unparseable input.
 *
 * Forgiving on purpose (PRD #179): the meridiem is detected wherever it trails
 * the digits, so "1:00 PM", "1:00PM", "1pm", "1 PM", "1p", and "2:30 p.m." all
 * read the same — no space required. 24-hour input ("13:00") works too. Crucially
 * there is NO inference: a bare time with no meridiem ("1:00", "8") is taken
 * literally (→ AM), never guessed, so the UI's normalize-on-blur can surface it.
 *
 * This replaces v12's parseTime, whose `\b(AM|PM)\b` needed a word boundary
 * (i.e. a space) before the meridiem and silently dropped "1:00PM" to AM. The
 * accepted spaced forms parse identically, so the schedule goldens are unmoved.
 */
export function parseTime(str: string): number | null {
  if (!str) return null;
  str = str.trim();
  // Detach a trailing meridiem (a/p, optional '.', optional 'm', optional '.'),
  // with or without a separating space, so it never has to touch the digits.
  let ap = '';
  const mer = str.match(/([ap])\.?\s*m?\.?\s*$/i);
  if (mer && mer.index != null) {
    ap = mer[1].toUpperCase(); // 'A' or 'P'
    str = str.slice(0, mer.index).trim();
  }
  // What remains must be H, H:MM, or HH:MM (24-hour when no meridiem was given).
  const m = str.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mn = m[2] != null ? parseInt(m[2], 10) : 0;
  if (h > 23 || mn > 59) return null;
  if (ap === 'P' && h !== 12) h += 12;
  if (ap === 'A' && h === 12) h = 0;
  return h * 60 + mn;
}

/**
 * Formats minutes-since-midnight as a 12-hour clock string ("8:30 AM").
 * Returns '' for null / NaN inputs. Ported verbatim from v12 fmtTime().
 */
export function fmtTime(mins: number | null): string {
  if (mins == null || isNaN(mins)) return '';
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return h12 + ':' + String(m).padStart(2, '0') + ' ' + ap;
}

/**
 * A stable key for the computed row a manual gap anchors to (PRD #179 / #192).
 * Shows/transitions/rehearsals key by their position, the singleton admin rows by
 * name. The CM-arrival row (its own override, setArrival) and inserted break rows
 * return null and can't be anchored to. The UI reuses this to record the anchor
 * when adding a break, so the two can never compute the key differently.
 */
export function scheduleEventKey(ev: ScheduleEvent): string | null {
  switch (ev.type) {
    case 'show':
      return `show:${ev.colorIdx}`;
    case 'trans':
      return `trans:${ev.colorIdx}`;
    case 'rehearsal':
      return `reh:${ev.colorIdx}`;
    case 'dm':
      return 'dm';
    case 'admin':
      return 'admin';
    case 'crit':
      return 'crit';
    case 'awards':
      return 'awards';
    default:
      return null; // arrival / break — not anchorable
  }
}

/**
 * Applies manual overrides (PRD #179 / #192). Each gap slides every later row
 * forward by its length (ripple, durations preserved). A LABELED gap also draws
 * a visible 'break' row right after its anchor (a deliberate break — "Lunch");
 * an UNLABELED gap (label '') is a plain time nudge — it just moves the rows,
 * leaving blank space, with no phantom row. Gaps apply in list order; an
 * orphaned anchor is skipped rather than dropped. Pure: returns a new array.
 */
function applyOverrides(events: ScheduleEvent[], overrides: ScheduleOverrides): ScheduleEvent[] {
  let result = events;
  for (const gap of overrides.gaps) {
    const idx = result.findIndex((ev) => scheduleEventKey(ev) === gap.anchor);
    if (idx === -1) continue; // orphaned anchor — leave the timeline untouched
    const after = result
      .slice(idx + 1)
      .map((ev) => ({ ...ev, start: ev.start + gap.minutes, end: ev.end + gap.minutes }));
    if (gap.label === '') {
      result = [...result.slice(0, idx + 1), ...after]; // nudge — shift only, no row
      continue;
    }
    const at = result[idx].end;
    const breakRow: ScheduleEvent = {
      start: at,
      end: at + gap.minutes,
      dur: gap.minutes,
      label: gap.label,
      play: '',
      school: '',
      type: 'break',
      colorIdx: -1,
      overrideId: gap.id,
    };
    result = [...result.slice(0, idx + 1), breakRow, ...after];
  }
  return result;
}

/** A school's display name, with v12's "School {formIndex}" blank fallback. */
function schoolLabel(contest: Contest, school: School): string {
  return school.name.trim() || `School ${contest.schools.indexOf(school) + 1}`;
}

/**
 * Computes the contest-day timeline from a contest record. Ports v12
 * calculateSchedule() exactly for both critique formats, then prepends the
 * directors'-meeting row (v12 renderScheduleHTML) — that row is schedule data
 * the .xlsx also consumes, so it belongs in the engine, not just the preview.
 *
 * A missing or unparseable first-show time yields an empty timeline ([]) — no
 * NaN rows, ever.
 *
 * @param overrides Manual overrides applied after the cascade (PRD #179 —
 *   inserted breaks). Defaults to the contest's own `scheduleOverrides`, so every
 *   caller (preview + both .xlsx generators) picks up stored breaks with no
 *   change; tests can inject an explicit set. See applyOverrides.
 */
export function computeSchedule(
  contest: Contest,
  overrides: ScheduleOverrides = contest.scheduleOverrides,
): ScheduleEvent[] {
  const startMin = parseTime(contest.details.firstShowTime);
  if (startMin == null || isNaN(startMin)) return [];

  const schools = schoolsInPerformanceOrder(contest);
  const n = schools.length;
  const nj = contest.details.numJudges;
  const events: ScheduleEvent[] = [];
  let t = startMin;

  const pushShow = (i: number): void => {
    const s = schools[i];
    const dur = i === 0 ? FIRST_SLOT : PERF_ONLY;
    const name = schoolLabel(contest, s);
    const label = name + (i === 0 ? ' — Setup and Performance' : ' — Performance');
    events.push({ start: t, end: t + dur, dur, label, play: s.playTitle || '', school: name, type: 'show', colorIdx: i });
    t += dur;
  };
  const pushAdmin = (dur: number, label: string, type: ScheduleEventType): void => {
    events.push({ start: t, end: t + dur, dur, label, play: '', school: '', type, colorIdx: -1 });
    t += dur;
  };

  if (contest.details.critiqueFormat === 'after_each') {
    // after_each: critique immediately follows each show's strike.
    for (let i = 0; i < n; i++) {
      pushShow(i);
      const label =
        i < n - 1
          ? `School ${i + 1} Strike & Critique — School ${i + 2} Setup`
          : `School ${i + 1} Strike & Critique`;
      events.push({ start: t, end: t + EACH_TRANS, dur: EACH_TRANS, label, play: '', school: '', type: 'trans', colorIdx: i });
      t += EACH_TRANS;
    }
    pushAdmin(TABULATION, "Judge's Tabulation", 'admin');
    pushAdmin(AWARDS, 'Awards Ceremony', 'awards');
  } else {
    // after_all: shows → last-show strike → tabulation → critiques → awards.
    for (let i = 0; i < n; i++) {
      pushShow(i);
      if (i < n - 1) {
        const label = `School ${i + 1} Strike — School ${i + 2} Setup`;
        events.push({ start: t, end: t + ALL_TRANS, dur: ALL_TRANS, label, play: '', school: '', type: 'trans', colorIdx: i });
        t += ALL_TRANS;
      }
    }
    // Final strike — clear the stage, no next setup.
    events.push({ start: t, end: t + ALL_TRANS, dur: ALL_TRANS, label: `School ${n} Strike`, play: '', school: '', type: 'trans', colorIdx: n - 1 });
    t += ALL_TRANS;
    pushAdmin(TABULATION, "Judge's Tabulation", 'admin');
    const critBlock = Math.ceil(n / nj) * CRIT_MINS_PER_SHOW;
    const critLabel = nj > 1 ? `Critiques — ${nj} Judges Concurrent` : `Critiques — ${n} Shows Sequential`;
    pushAdmin(critBlock, critLabel, 'crit');
    pushAdmin(AWARDS, 'Awards Ceremony', 'awards');
  }

  // Directors' meeting spans [meetingTime, firstShowTime) when it parses and
  // falls before the first show (v12 renderScheduleHTML prepend).
  const dmMins = parseTime(contest.details.directorsMeetingTime);
  if (dmMins != null && !isNaN(dmMins) && dmMins < startMin) {
    events.unshift({
      start: dmMins,
      end: startMin,
      dur: startMin - dmMins,
      label: 'Directors’ Meeting',
      play: '',
      school: '',
      type: 'dm',
      colorIdx: 0,
    });
  }

  return applyOverrides(events, overrides);
}

/**
 * Whether rehearsals fall ON the contest date with no second rehearsal day — the
 * one shape where the engine folds the rehearsal block into the contest-day
 * timeline (PRD #179). Multi-day and different-date rehearsals stay laid out by
 * the Rehearsal + Contest document itself (dated sections), not here.
 */
export function isSameDayRehearsal(contest: Contest): boolean {
  const d = contest.details;
  return !!d.rehearsalDate1 && !!d.contestDate && d.rehearsalDate1 === d.contestDate && !d.rehearsalDate2;
}

/**
 * The same-day rehearsal block that leads the contest day: a single CM-arrival
 * row (an hour before rehearsals begin, per v12 — or the CM's explicit override,
 * PRD #192) followed by one rehearsal slot per school in performance order, each
 * length + a fixed 10-minute transition. Overrides are applied here too, so a
 * gap/nudge anchored to a rehearsal row lands in the block (PRD #192); gaps
 * anchored to contest rows have no match here and are skipped.
 */
function sameDayRehearsalBlock(contest: Contest, overrides: ScheduleOverrides): ScheduleEvent[] {
  const d = contest.details;
  const slotLen = d.rehearsalLengthMinutes + 10;
  const start = parseTime(d.rehearsalStartTime1 || '2:00 PM') ?? 14 * 60;
  const events: ScheduleEvent[] = [];
  const arrival = overrides.arrival ?? start - 60;
  events.push({ start: arrival, end: arrival, dur: 0, label: 'CM Arrival', play: '', school: '', type: 'arrival', colorIdx: -1 });
  let t = start;
  schoolsInPerformanceOrder(contest).forEach((s, i) => {
    const name = schoolLabel(contest, s);
    events.push({ start: t, end: t + slotLen, dur: slotLen, label: `School ${i + 1} Rehearsal`, play: s.playTitle || '', school: name, type: 'rehearsal', colorIdx: i });
    t += slotLen;
  });
  return applyOverrides(events, overrides);
}

/**
 * The whole contest DAY as one ordered timeline. Identical to computeSchedule()
 * for a normal contest; when rehearsals are on the contest date
 * (isSameDayRehearsal) it prepends the CM-arrival + rehearsal block so the preview
 * and the Rehearsal + Contest .xlsx read as one continuous, chronological day
 * (PRD #179). Returns [] with no valid first-show time, exactly like
 * computeSchedule() — a same-day contest still needs a first-show time to schedule.
 */
export function computeContestDay(
  contest: Contest,
  overrides: ScheduleOverrides = contest.scheduleOverrides,
): ScheduleEvent[] {
  const contestEvents = computeSchedule(contest, overrides);
  if (contestEvents.length === 0 || !isSameDayRehearsal(contest)) return contestEvents;
  return [...sameDayRehearsalBlock(contest, overrides), ...contestEvents];
}

/**
 * Moves a computed row to start at `newStart` by adjusting the gap directly
 * before it (PRD #179 / #192) — the pin-free "just change the time of a row." A
 * time edit stores an UNLABELED nudge, so the row simply moves (blank space), no
 * phantom break row:
 *   • if the row directly above is a LABELED break, resize it (its length is what
 *     positions this row) — removing it when the new length reaches zero;
 *   • otherwise create/resize the unlabeled nudge anchored to the predecessor.
 * It never moves a row EARLIER than back-to-back with what precedes it (a
 * negative delta with no gap to shrink is a no-op), so a time edit can't create a
 * backward overlap. `events` is the timeline the row came from (computeContestDay).
 * Out-of-range / first-row / non-anchorable-predecessor ⇒ the contest is returned
 * unchanged.
 */
export function setRowStart(
  contest: Contest,
  events: ScheduleEvent[],
  index: number,
  newStart: number,
  now?: string,
): Contest {
  const target = events[index];
  const prev = events[index - 1];
  if (!target || !prev) return contest;
  const delta = newStart - target.start;
  if (delta === 0) return contest;
  // Directly below a labeled break: that break's length positions this row.
  if (prev.type === 'break' && prev.overrideId) {
    const minutes = prev.dur + delta;
    return minutes <= 0
      ? removeBreak(contest, prev.overrideId, now)
      : updateBreak(contest, prev.overrideId, { minutes }, now);
  }
  const anchor = scheduleEventKey(prev);
  if (anchor == null) return contest;
  // Adjust the one unlabeled nudge for this anchor (there is at most one).
  const nudge = contest.scheduleOverrides.gaps.find((g) => g.anchor === anchor && g.label === '');
  if (nudge) {
    const minutes = nudge.minutes + delta;
    return minutes <= 0 ? removeBreak(contest, nudge.id, now) : updateBreak(contest, nudge.id, { minutes }, now);
  }
  if (delta <= 0) return contest; // no nudge to shrink — can't go earlier than natural
  return addBreak(contest, anchor, delta, '', now); // '' ⇒ unlabeled nudge (blank space)
}

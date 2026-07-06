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

import { schoolsInPerformanceOrder, type Contest, type School } from './contest';

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

/** What a timeline row is. Drives both the preview and the .xlsx generator. */
export type ScheduleEventType = 'dm' | 'show' | 'trans' | 'admin' | 'crit' | 'awards';

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
}

/**
 * Manual timing overrides — the future manual-edit hook (PRD user story 28).
 * Empty in v1; it is part of the computeSchedule contract now so that later
 * slices add manual edits additively, without changing the signature or
 * touching any caller. See applyOverrides().
 */
export interface ScheduleOverrides {
  /** Reserved. No override fields exist yet. */
  readonly reserved?: never;
}

/**
 * Parses a 12-hour time string such as "8:30 AM" or "2 PM" into
 * minutes-since-midnight. Returns null for empty / unparseable input.
 * Ported verbatim from v12 parseTime(); reused by schedule documents later.
 */
export function parseTime(str: string): number | null {
  if (!str) return null;
  str = str.trim();
  const ampm = (str.match(/\b(AM|PM)\b/i) || [])[1];
  const m = str.match(/(\d{1,2}):(\d{2})/);
  let h: number;
  let mn: number;
  if (m) {
    h = parseInt(m[1], 10);
    mn = parseInt(m[2], 10);
  } else {
    const b = str.match(/^(\d{1,2})\s*(AM|PM)?$/i);
    if (!b) return null;
    h = parseInt(b[1], 10);
    mn = 0;
  }
  const ap = ampm ? ampm.toUpperCase() : '';
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
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
 * Applies manual timing overrides to a computed timeline. The overrides hook is
 * empty in v1, so this is the identity function today — but it is a real seam:
 * future manual-edit slices land here, leaving the core loop and every caller
 * untouched. It also makes `overrides` part of the compiled contract now.
 */
function applyOverrides(events: ScheduleEvent[], _overrides: ScheduleOverrides): ScheduleEvent[] {
  return events;
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
 * @param overrides Reserved future manual-edit hook (PRD user story 28); empty
 *   and inert in v1. See ScheduleOverrides / applyOverrides.
 */
export function computeSchedule(contest: Contest, overrides: ScheduleOverrides = {}): ScheduleEvent[] {
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

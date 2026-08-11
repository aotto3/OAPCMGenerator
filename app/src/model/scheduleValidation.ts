/**
 * Schedule validation — soft, advisory flags over a computed timeline (PRD #179).
 *
 * PURE MODULE. No React, no DOM. It takes the ScheduleEvents that computeSchedule
 * / computeContestDay produce and returns a flat list of flags; it has no UI
 * knowledge and returns data, never markup. The flags are AUTHORING-TIME ONLY —
 * the live preview surfaces them, but they NEVER block document generation and
 * are NEVER printed into a generated document.
 *
 * Three checks, all from the CM's stated rules:
 *   • early-morning — anything landing in the midnight–6:00 AM window (the classic
 *     symptom of an AM/PM mistake, or a day that ran past midnight).
 *   • overlap       — an event that starts before an earlier one has ended.
 *   • short-show    — a performance below the 40-minute UIL floor.
 */

import { fmtTime, type ScheduleEvent } from './schedule';

/** The end of the "this is probably wrong" window: 6:00 AM. */
const EARLY_MORNING_END = 6 * 60;
/** UIL performance floor — a show must run at least 40 minutes. */
export const MIN_SHOW_MINUTES = 40;

export type ScheduleFlagKind = 'early-morning' | 'overlap' | 'short-show';

export interface ScheduleFlag {
  kind: ScheduleFlagKind;
  /** Index of the flagged event in the input array — lets the view highlight it. */
  index: number;
  /** Plain-language, CM-facing explanation. */
  message: string;
}

/** Minute-of-day (0–1439), unwrapping a time that spilled past midnight. */
function clockMinute(mins: number): number {
  return ((mins % 1440) + 1440) % 1440;
}

/** Whether a minute lands in the midnight–6:00 AM window. */
function isEarlyMorning(mins: number): boolean {
  return clockMinute(mins) < EARLY_MORNING_END;
}

/**
 * Validates a computed timeline, returning zero or more soft flags. An event can
 * earn more than one (e.g. both early-morning and overlapping). Order follows the
 * events; multiple flags on one event keep their check order.
 */
export function validateSchedule(events: ScheduleEvent[]): ScheduleFlag[] {
  const flags: ScheduleFlag[] = [];
  // The latest end seen so far — an event starting before it overlaps something,
  // even a non-adjacent earlier row (e.g. rehearsals overrunning the meeting).
  let maxEnd = -Infinity;

  events.forEach((ev, i) => {
    if (isEarlyMorning(ev.start) || (ev.dur > 0 && isEarlyMorning(ev.end - 1))) {
      flags.push({
        kind: 'early-morning',
        index: i,
        message: `${ev.label} is scheduled at ${fmtTime(ev.start)}, between midnight and 6:00 AM — double-check the time.`,
      });
    }
    if (ev.start < maxEnd) {
      flags.push({
        kind: 'overlap',
        index: i,
        message: `${ev.label} starts at ${fmtTime(ev.start)}, before the previous item ends (${fmtTime(maxEnd)}).`,
      });
    }
    maxEnd = Math.max(maxEnd, ev.end);
    if (ev.type === 'show' && ev.dur < MIN_SHOW_MINUTES) {
      flags.push({
        kind: 'short-show',
        index: i,
        message: `${ev.label} runs only ${ev.dur} minutes — a performance needs at least ${MIN_SHOW_MINUTES}.`,
      });
    }
  });

  return flags;
}

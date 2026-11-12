/**
 * Schedule editing as one module (RFC #264). PURE: no React, no DOM.
 *
 * Callers describe an edit by ROW (its index in the contest-day timeline,
 * computeContestDay); this module decides what it means:
 *   • anchor rows write their own field (first show → firstShowTime, first
 *     rehearsal → rehearsalStartTime1, directors' meeting →
 *     directorsMeetingTime), the CM-arrival row writes the arrival override,
 *     and every other row stores a nudge before it (nudgeRowStart below);
 *   • labeled breaks are added after an anchorable row, renamed, resized,
 *     moved one anchor up or down in day order, and removed.
 *
 * Every change to the overrides goes through contest.ts's single writer, so an
 * edit never drops a field it is not changing (the CM-arrival override survives
 * every break edit and nudge, #263). Which details changes clear the overrides
 * is answered by contest.ts scheduleChangeClearsOverrides, the same rule
 * withDetails and setNumSchools apply, so scheduleImpactOf cannot drift.
 *
 * The engine (computeSchedule / computeContestDay), validateSchedule and time
 * parsing stay public in their own modules; document generators use them.
 */

import {
  scheduleChangeClearsOverrides,
  withDetails,
  withScheduleOverrides,
  type Contest,
  type InsertedGap,
  type ScheduleRestructure,
} from './contest';
import { computeContestDay, fmtTime, scheduleEventKey, type ScheduleEvent } from './schedule';
import { validateSchedule } from './scheduleValidation';

export interface ScheduleRow {
  event: ScheduleEvent;
  /** Validation reasons for this row (validateSchedule), in check order; [] when clean. */
  flags: string[];
  /** Whether the row's start time can be typed (every row except a break). */
  canEditStart: boolean;
  /** Whether a break can be inserted after this row (it is an anchorable row). */
  canAddBreakAfter: boolean;
  /** Whether this row is a labeled break (rename / resize / move / remove apply). */
  isBreak: boolean;
  /** Labeled breaks only: there is an earlier anchor to move to. */
  canMoveUp: boolean;
  /** Labeled breaks only: there is a later anchor to move to. */
  canMoveDown: boolean;
}

export type ScheduleEdit =
  | { kind: 'setStart'; row: number; minutes: number }
  | { kind: 'addBreak'; afterRow: number; minutes: number; label: string }
  | { kind: 'renameBreak'; row: number; label: string }
  | { kind: 'resizeBreak'; row: number; minutes: number }
  | { kind: 'moveBreak'; row: number; direction: -1 | 1 }
  | { kind: 'removeBreak'; row: number }
  | { kind: 'resetArrival' };

/* ── gap primitives (internal). `anchor` is a stable row key (scheduleEventKey);
 * the engine ignores an orphaned anchor, so these never validate against a
 * computed timeline. Each writes through withScheduleOverrides, which keeps the
 * fields it is not changing (the CM-arrival override survives, #263). ── */

/** Inserts a gap after the row keyed `anchor`. `label` '' ⇒ an unlabeled nudge. */
function addGap(contest: Contest, anchor: string, minutes: number, label: string, now?: string): Contest {
  const gap: InsertedGap = { id: crypto.randomUUID(), anchor, minutes, label };
  return withScheduleOverrides(contest, { gaps: [...contest.scheduleOverrides.gaps, gap] }, now);
}

/** Removes the gap with the given id. Unknown id ⇒ the contest as-is. */
function removeGap(contest: Contest, id: string, now?: string): Contest {
  const gaps = contest.scheduleOverrides.gaps.filter((g) => g.id !== id);
  if (gaps.length === contest.scheduleOverrides.gaps.length) return contest;
  return withScheduleOverrides(contest, { gaps }, now);
}

/** Patches one gap's label, length or anchor by id. Unknown id ⇒ the contest as-is. */
function updateGap(
  contest: Contest,
  id: string,
  patch: Partial<Pick<InsertedGap, 'anchor' | 'minutes' | 'label'>>,
  now?: string,
): Contest {
  let changed = false;
  const gaps = contest.scheduleOverrides.gaps.map((g) => {
    if (g.id !== id) return g;
    changed = true;
    return { ...g, ...patch };
  });
  if (!changed) return contest;
  return withScheduleOverrides(contest, { gaps }, now);
}

/**
 * Moves a downstream row to start at `newStart` by adjusting the gap directly
 * before it (PRD #179 / #192), so the row simply moves with no phantom break row:
 *   • directly below a LABELED break, resize that break (removing it when its
 *     length reaches zero);
 *   • otherwise create, resize or remove the one unlabeled nudge anchored to the
 *     predecessor.
 * It never moves a row earlier than back-to-back with what precedes it (a
 * negative delta with no gap to shrink is a no-op).
 */
function nudgeRowStart(
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
  if (prev.type === 'break' && prev.overrideId) {
    const minutes = prev.dur + delta;
    return minutes <= 0 ? removeGap(contest, prev.overrideId, now) : updateGap(contest, prev.overrideId, { minutes }, now);
  }
  const anchor = scheduleEventKey(prev);
  if (anchor == null) return contest;
  const nudge = contest.scheduleOverrides.gaps.find((g) => g.anchor === anchor && g.label === '');
  if (nudge) {
    const minutes = nudge.minutes + delta;
    return minutes <= 0 ? removeGap(contest, nudge.id, now) : updateGap(contest, nudge.id, { minutes }, now);
  }
  if (delta <= 0) return contest;
  return addGap(contest, anchor, delta, '', now);
}

/** The stored gap behind a labeled break row, or undefined for any other row. */
function breakGap(contest: Contest, ev: ScheduleEvent | undefined): InsertedGap | undefined {
  if (!ev || ev.type !== 'break' || !ev.overrideId) return undefined;
  return contest.scheduleOverrides.gaps.find((g) => g.id === ev.overrideId);
}

/**
 * The anchor a break moves to: the previous (-1) or next (+1) anchorable row in
 * day order. Breaks and the arrival row are not anchors. null at either end.
 */
function moveTarget(events: ScheduleEvent[], current: string, direction: -1 | 1): string | null {
  const anchorKeys = events.map(scheduleEventKey).filter((k): k is string => k != null);
  const j = anchorKeys.indexOf(current) + direction;
  return j >= 0 && j < anchorKeys.length ? anchorKeys[j] : null;
}

/** The whole day as the preview needs it: computeContestDay + validation + capabilities. */
export function scheduleRows(contest: Contest): ScheduleRow[] {
  const events = computeContestDay(contest);
  const flags = validateSchedule(events);
  return events.map((event, i) => {
    const gap = breakGap(contest, event);
    return {
      event,
      flags: flags.filter((f) => f.index === i).map((f) => f.message),
      canEditStart: event.type !== 'break',
      canAddBreakAfter: scheduleEventKey(event) != null,
      isBreak: !!gap,
      canMoveUp: !!gap && moveTarget(events, gap.anchor, -1) != null,
      canMoveDown: !!gap && moveTarget(events, gap.anchor, 1) != null,
    };
  });
}

/** Routes a typed start time to the edit it means for that row type. */
function setStart(contest: Contest, events: ScheduleEvent[], row: number, minutes: number, now?: string): Contest {
  const ev = events[row];
  if (!ev || minutes === ev.start) return contest;
  switch (ev.type) {
    case 'show':
      return ev.colorIdx === 0
        ? withDetails(contest, { firstShowTime: fmtTime(minutes) }, now)
        : nudgeRowStart(contest, events, row, minutes, now);
    case 'rehearsal':
      // The first rehearsal is the anchor (its start-time field); the rest nudge.
      return ev.colorIdx === 0
        ? withDetails(contest, { rehearsalStartTime1: fmtTime(minutes) }, now)
        : nudgeRowStart(contest, events, row, minutes, now);
    case 'dm':
      return withDetails(contest, { directorsMeetingTime: fmtTime(minutes) }, now);
    case 'arrival':
      return withScheduleOverrides(contest, { arrival: minutes }, now);
    case 'trans':
    case 'admin':
    case 'crit':
    case 'awards':
      return nudgeRowStart(contest, events, row, minutes, now);
    default:
      return contest; // break rows are edited through their own controls
  }
}

/** Applies one schedule edit. Unknown or not-applicable edits return the contest unchanged. */
export function applyScheduleEdit(contest: Contest, edit: ScheduleEdit, now?: string): Contest {
  if (edit.kind === 'resetArrival') {
    if (contest.scheduleOverrides.arrival === undefined) return contest;
    return withScheduleOverrides(contest, { arrival: undefined }, now);
  }
  const events = computeContestDay(contest);
  switch (edit.kind) {
    case 'setStart':
      return setStart(contest, events, edit.row, edit.minutes, now);
    case 'addBreak': {
      const ev = events[edit.afterRow];
      const anchor = ev ? scheduleEventKey(ev) : null;
      if (anchor == null || !(edit.minutes >= 1)) return contest;
      return addGap(contest, anchor, edit.minutes, edit.label, now);
    }
    case 'renameBreak': {
      const gap = breakGap(contest, events[edit.row]);
      return gap ? updateGap(contest, gap.id, { label: edit.label }, now) : contest;
    }
    case 'resizeBreak': {
      const gap = breakGap(contest, events[edit.row]);
      if (!gap || !(edit.minutes >= 1)) return contest;
      return updateGap(contest, gap.id, { minutes: edit.minutes }, now);
    }
    case 'moveBreak': {
      const gap = breakGap(contest, events[edit.row]);
      const anchor = gap ? moveTarget(events, gap.anchor, edit.direction) : null;
      return gap && anchor ? updateGap(contest, gap.id, { anchor }, now) : contest;
    }
    case 'removeBreak': {
      const gap = breakGap(contest, events[edit.row]);
      return gap ? removeGap(contest, gap.id, now) : contest;
    }
    default:
      return contest;
  }
}

/**
 * What a details change (or a new school count) would do to manual schedule
 * edits, for the confirm prompt. `clearsOverrides` is true exactly when applying
 * the change would empty overrides that are not already empty; `breakCount` is
 * the number of stored breaks and nudges it would drop (the count the prompt
 * shows today).
 */
export function scheduleImpactOf(
  contest: Contest,
  change: ScheduleRestructure,
): { clearsOverrides: boolean; breakCount: number } {
  const { gaps, arrival } = contest.scheduleOverrides;
  const hasOverrides = gaps.length > 0 || arrival !== undefined;
  return {
    clearsOverrides: hasOverrides && scheduleChangeClearsOverrides(contest, change),
    breakCount: gaps.length,
  };
}

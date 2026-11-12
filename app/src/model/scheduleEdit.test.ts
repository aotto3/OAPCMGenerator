import { describe, expect, it } from 'vitest';
import {
  createContest,
  setNumSchools,
  withDetails,
  withSchool,
  type Contest,
  type CritiqueFormat,
  type ScheduleRestructure,
} from './contest';
import { computeContestDay, scheduleEventKey, type ScheduleEvent, type ScheduleEventType } from './schedule';
import { validateSchedule } from './scheduleValidation';
import { applyScheduleEdit, scheduleImpactOf, scheduleRows, type ScheduleEdit } from './scheduleEdit';

/*
 * Boundary tests for the schedule-edit module (RFC #264). Each case is "given
 * this contest and this edit, the resulting day is": they assert on the computed
 * day (computeContestDay) and the stored override fields, never on ids.
 */

const NOW = '2026-07-05T12:00:00.000Z';
const LATER = '2026-07-06T09:00:00.000Z';
const ARRIVAL = 6 * 60 + 30; // 6:30 AM

function makeContest(format: CritiqueFormat = 'after_all', n = 3): Contest {
  let c = createContest({ id: 'test-id', now: NOW });
  c = setNumSchools(c, n, NOW);
  c = withDetails(c, { critiqueFormat: format, numJudges: 3, firstShowTime: '1:00 PM', directorsMeetingTime: '12:30 PM' }, NOW);
  for (let i = 0; i < n; i++) {
    c = withSchool(c, i, { name: `School ${String.fromCharCode(65 + i)}`, performanceOrder: i + 1 }, NOW);
  }
  return c;
}

/** Same-day rehearsals, so the day has every row type: arrival, rehearsals, dm, shows, trans, admin, crit, awards. */
function sameDay(format: CritiqueFormat = 'after_all'): Contest {
  return withDetails(
    makeContest(format),
    {
      contestDate: '2026-03-21',
      rehearsalDate1: '2026-03-21',
      rehearsalDate2: '',
      rehearsalStartTime1: '8:00 AM',
      rehearsalLengthMinutes: 45,
    },
    NOW,
  );
}

const day = (c: Contest) => computeContestDay(c);
const rowOf = (c: Contest, type: ScheduleEventType, colorIdx?: number): number =>
  day(c).findIndex((e) => e.type === type && (colorIdx === undefined || e.colorIdx === colorIdx));
const startOf = (c: Contest, type: ScheduleEventType, colorIdx?: number): number => day(c)[rowOf(c, type, colorIdx)].start;
const breaks = (c: Contest): ScheduleEvent[] => day(c).filter((e) => e.type === 'break');
const edit = (c: Contest, e: ScheduleEdit, now = LATER) => applyScheduleEdit(c, e, now);

/** A contest with one labeled break after the given row type. */
function withBreak(c: Contest, type: ScheduleEventType, colorIdx: number | undefined, minutes = 15, label = 'Lunch'): Contest {
  return edit(c, { kind: 'addBreak', afterRow: rowOf(c, type, colorIdx), minutes, label });
}
const breakRow = (c: Contest, label = 'Lunch') => day(c).findIndex((e) => e.type === 'break' && e.label === label);

describe('setStart routes by row type', () => {
  it('first show writes firstShowTime and moves the whole contest timeline', () => {
    const c = sameDay();
    const out = edit(c, { kind: 'setStart', row: rowOf(c, 'show', 0), minutes: 14 * 60 });
    expect(out.details.firstShowTime).toBe('2:00 PM');
    expect(out.scheduleOverrides.gaps).toHaveLength(0);
    expect(startOf(out, 'awards')).toBe(startOf(c, 'awards') + 60);
    expect(out.updatedAt).toBe(LATER);
  });

  it('a later show stores an unlabeled nudge before it, with no break row', () => {
    const c = sameDay();
    const out = edit(c, { kind: 'setStart', row: rowOf(c, 'show', 1), minutes: startOf(c, 'show', 1) + 20 });
    expect(out.scheduleOverrides.gaps).toEqual([expect.objectContaining({ anchor: 'trans:0', minutes: 20, label: '' })]);
    expect(startOf(out, 'show', 1)).toBe(startOf(c, 'show', 1) + 20);
    expect(startOf(out, 'show', 0)).toBe(startOf(c, 'show', 0));
    expect(breaks(out)).toHaveLength(0);
  });

  it('first rehearsal writes rehearsalStartTime1 and moves the rehearsal block', () => {
    const c = sameDay();
    const out = edit(c, { kind: 'setStart', row: rowOf(c, 'rehearsal', 0), minutes: 9 * 60 });
    expect(out.details.rehearsalStartTime1).toBe('9:00 AM');
    expect(startOf(out, 'rehearsal', 2)).toBe(startOf(c, 'rehearsal', 2) + 60);
    expect(startOf(out, 'show', 0)).toBe(startOf(c, 'show', 0));
  });

  it('a later rehearsal nudges later rehearsals only, not the contest', () => {
    const c = sameDay();
    const out = edit(c, { kind: 'setStart', row: rowOf(c, 'rehearsal', 1), minutes: startOf(c, 'rehearsal', 1) + 20 });
    expect(out.scheduleOverrides.gaps).toEqual([expect.objectContaining({ anchor: 'reh:0', minutes: 20, label: '' })]);
    expect(startOf(out, 'rehearsal', 2)).toBe(startOf(c, 'rehearsal', 2) + 20);
    expect(startOf(out, 'show', 0)).toBe(startOf(c, 'show', 0));
  });

  it("directors' meeting writes directorsMeetingTime", () => {
    const c = sameDay();
    const out = edit(c, { kind: 'setStart', row: rowOf(c, 'dm'), minutes: 12 * 60 });
    expect(out.details.directorsMeetingTime).toBe('12:00 PM');
    expect(startOf(out, 'dm')).toBe(12 * 60);
    expect(out.scheduleOverrides.gaps).toHaveLength(0);
  });

  it('arrival writes the arrival override and nothing else', () => {
    const c = sameDay();
    const out = edit(c, { kind: 'setStart', row: rowOf(c, 'arrival'), minutes: ARRIVAL });
    expect(out.scheduleOverrides).toEqual({ gaps: [], arrival: ARRIVAL });
    expect(startOf(out, 'arrival')).toBe(ARRIVAL);
    expect(startOf(out, 'rehearsal', 0)).toBe(startOf(c, 'rehearsal', 0));
  });

  it.each([
    ['trans', 0, 'show:0'],
    ['admin', undefined, 'trans:2'],
    ['crit', undefined, 'admin'],
    ['awards', undefined, 'crit'],
  ] as const)('%s stores a nudge anchored to the row above', (type, colorIdx, anchor) => {
    const c = sameDay();
    const out = edit(c, { kind: 'setStart', row: rowOf(c, type, colorIdx), minutes: startOf(c, type, colorIdx) + 10 });
    expect(out.scheduleOverrides.gaps).toEqual([expect.objectContaining({ anchor, minutes: 10, label: '' })]);
    expect(startOf(out, type, colorIdx)).toBe(startOf(c, type, colorIdx) + 10);
  });

  it('is a no-op on a break row, an unchanged time, or an out-of-range row', () => {
    const c = withBreak(sameDay(), 'show', 0);
    expect(edit(c, { kind: 'setStart', row: breakRow(c), minutes: 1 })).toBe(c);
    expect(edit(c, { kind: 'setStart', row: rowOf(c, 'show', 0), minutes: startOf(c, 'show', 0) })).toBe(c);
    expect(edit(c, { kind: 'setStart', row: 999, minutes: 100 })).toBe(c);
  });
});

describe('setStart below a labeled break, and nudges elsewhere', () => {
  it('directly below a labeled break resizes that break instead of adding a nudge', () => {
    const c = withBreak(sameDay(), 'show', 0, 15);
    const below = breakRow(c) + 1;
    const out = edit(c, { kind: 'setStart', row: below, minutes: day(c)[below].start + 10 });
    expect(out.scheduleOverrides.gaps).toEqual([expect.objectContaining({ label: 'Lunch', minutes: 25 })]);
  });

  it('moving the row below a break back to the break start removes the break', () => {
    const c = withBreak(sameDay(), 'show', 0, 15);
    const below = breakRow(c) + 1;
    const out = edit(c, { kind: 'setStart', row: below, minutes: day(c)[below].start - 15 });
    expect(out.scheduleOverrides.gaps).toHaveLength(0);
    expect(breaks(out)).toHaveLength(0);
  });

  it('a second edit resizes the one nudge; returning to natural removes it', () => {
    const c = sameDay();
    const natural = startOf(c, 'show', 1);
    let out = edit(c, { kind: 'setStart', row: rowOf(c, 'show', 1), minutes: natural + 20 });
    out = edit(out, { kind: 'setStart', row: rowOf(out, 'show', 1), minutes: natural + 30 });
    expect(out.scheduleOverrides.gaps).toEqual([expect.objectContaining({ minutes: 30, label: '' })]);
    out = edit(out, { kind: 'setStart', row: rowOf(out, 'show', 1), minutes: natural - 5 });
    expect(out.scheduleOverrides.gaps).toHaveLength(0);
    expect(startOf(out, 'show', 1)).toBe(natural);
  });

  it('never moves a row earlier than back-to-back', () => {
    const c = sameDay();
    expect(edit(c, { kind: 'setStart', row: rowOf(c, 'show', 1), minutes: startOf(c, 'show', 1) - 15 })).toBe(c);
  });
});

describe('break edits', () => {
  it('addBreak inserts a labeled break row after the chosen row and ripples later rows', () => {
    const c = sameDay();
    const out = withBreak(c, 'show', 0, 20, 'Lunch');
    const d = day(out);
    const bi = breakRow(out);
    expect(scheduleEventKey(d[bi - 1])).toBe('show:0');
    expect(d[bi]).toMatchObject({ label: 'Lunch', dur: 20, start: startOf(c, 'trans', 0) });
    expect(startOf(out, 'awards')).toBe(startOf(c, 'awards') + 20);
    expect(out.updatedAt).toBe(LATER);
  });

  it('addBreak is a no-op after a non-anchorable row (arrival, a break) or with no length', () => {
    const c = withBreak(sameDay(), 'show', 0);
    expect(edit(c, { kind: 'addBreak', afterRow: rowOf(c, 'arrival'), minutes: 15, label: 'X' })).toBe(c);
    expect(edit(c, { kind: 'addBreak', afterRow: breakRow(c), minutes: 15, label: 'X' })).toBe(c);
    expect(edit(c, { kind: 'addBreak', afterRow: rowOf(c, 'awards'), minutes: 0, label: 'X' })).toBe(c);
  });

  it('renameBreak relabels the break row', () => {
    const c = withBreak(sameDay(), 'show', 0);
    const out = edit(c, { kind: 'renameBreak', row: breakRow(c), label: 'Dinner' });
    expect(breaks(out).map((b) => b.label)).toEqual(['Dinner']);
  });

  it('resizeBreak changes its length and ripples; below 1 minute is a no-op', () => {
    const c = withBreak(sameDay(), 'show', 0, 15);
    const out = edit(c, { kind: 'resizeBreak', row: breakRow(c), minutes: 45 });
    expect(breaks(out)[0].dur).toBe(45);
    expect(startOf(out, 'awards')).toBe(startOf(c, 'awards') + 30);
    expect(edit(c, { kind: 'resizeBreak', row: breakRow(c), minutes: 0 })).toBe(c);
  });

  it('moveBreak steps to the next / previous anchorable row in day order', () => {
    const c = withBreak(sameDay(), 'show', 0);
    const down = edit(c, { kind: 'moveBreak', row: breakRow(c), direction: 1 });
    expect(scheduleEventKey(day(down)[breakRow(down) - 1])).toBe('trans:0');
    const up = edit(c, { kind: 'moveBreak', row: breakRow(c), direction: -1 });
    expect(scheduleEventKey(day(up)[breakRow(up) - 1])).toBe('dm');
  });

  it('moveBreak skips the rehearsal-to-contest boundary in day order', () => {
    const c = withBreak(sameDay(), 'dm', undefined);
    const up = edit(c, { kind: 'moveBreak', row: breakRow(c), direction: -1 });
    expect(scheduleEventKey(day(up)[breakRow(up) - 1])).toBe('reh:2');
  });

  it('moveBreak is a no-op at either end of the day', () => {
    const first = withBreak(sameDay(), 'rehearsal', 0);
    expect(edit(first, { kind: 'moveBreak', row: breakRow(first), direction: -1 })).toBe(first);
    const last = withBreak(sameDay(), 'awards', undefined);
    expect(edit(last, { kind: 'moveBreak', row: breakRow(last), direction: 1 })).toBe(last);
  });

  it('removeBreak drops the break and restores the timeline', () => {
    const c = sameDay();
    const withB = withBreak(c, 'show', 0);
    const out = edit(withB, { kind: 'removeBreak', row: breakRow(withB) });
    expect(out.scheduleOverrides.gaps).toHaveLength(0);
    expect(day(out)).toEqual(day(c));
  });

  it('break edits on a non-break row are no-ops', () => {
    const c = withBreak(sameDay(), 'show', 0);
    const row = rowOf(c, 'show', 1);
    for (const e of [
      { kind: 'renameBreak', row, label: 'X' },
      { kind: 'resizeBreak', row, minutes: 5 },
      { kind: 'moveBreak', row, direction: 1 },
      { kind: 'removeBreak', row },
    ] as ScheduleEdit[]) {
      expect(edit(c, e)).toBe(c);
    }
  });
});

describe('every edit keeps the CM-arrival override (#262 decision)', () => {
  const base = (): Contest => {
    const c = sameDay();
    return withBreak(edit(c, { kind: 'setStart', row: rowOf(c, 'arrival'), minutes: ARRIVAL }), 'show', 0);
  };

  it.each<[string, (c: Contest) => ScheduleEdit]>([
    ['setStart (nudge)', (c) => ({ kind: 'setStart', row: rowOf(c, 'show', 2), minutes: startOf(c, 'show', 2) + 10 })],
    ['setStart (below a break)', (c) => ({ kind: 'setStart', row: breakRow(c) + 1, minutes: day(c)[breakRow(c) + 1].start + 5 })],
    ['setStart (first show)', (c) => ({ kind: 'setStart', row: rowOf(c, 'show', 0), minutes: 14 * 60 })],
    ['setStart (first rehearsal)', (c) => ({ kind: 'setStart', row: rowOf(c, 'rehearsal', 0), minutes: 9 * 60 })],
    ['setStart (dm)', (c) => ({ kind: 'setStart', row: rowOf(c, 'dm'), minutes: 12 * 60 })],
    ['addBreak', (c) => ({ kind: 'addBreak', afterRow: rowOf(c, 'awards'), minutes: 15, label: 'Late' })],
    ['renameBreak', (c) => ({ kind: 'renameBreak', row: breakRow(c), label: 'Dinner' })],
    ['resizeBreak', (c) => ({ kind: 'resizeBreak', row: breakRow(c), minutes: 40 })],
    ['moveBreak', (c) => ({ kind: 'moveBreak', row: breakRow(c), direction: 1 })],
    ['removeBreak', (c) => ({ kind: 'removeBreak', row: breakRow(c) })],
  ])('%s', (_name, makeEdit) => {
    const c = base();
    const out = edit(c, makeEdit(c));
    expect(out).not.toBe(c);
    expect(out.scheduleOverrides.arrival).toBe(ARRIVAL);
  });

  it('a nudge that is created, resized and removed keeps the arrival throughout', () => {
    let c = base();
    const natural = startOf(c, 'show', 2);
    c = edit(c, { kind: 'setStart', row: rowOf(c, 'show', 2), minutes: natural + 20 });
    c = edit(c, { kind: 'setStart', row: rowOf(c, 'show', 2), minutes: natural + 30 });
    c = edit(c, { kind: 'setStart', row: rowOf(c, 'show', 2), minutes: natural });
    expect(c.scheduleOverrides.gaps.filter((g) => g.label === '')).toHaveLength(0);
    expect(c.scheduleOverrides.arrival).toBe(ARRIVAL);
  });

  it('resetArrival clears only the arrival and reverts to the derived time', () => {
    const c = base();
    const out = edit(c, { kind: 'resetArrival' });
    expect(out.scheduleOverrides.arrival).toBeUndefined();
    expect('arrival' in out.scheduleOverrides).toBe(false);
    expect(out.scheduleOverrides.gaps).toEqual(c.scheduleOverrides.gaps);
    expect(startOf(out, 'arrival')).toBe(7 * 60); // 8:00 AM rehearsals − 60
    expect(edit(out, { kind: 'resetArrival' })).toBe(out); // nothing to reset
  });
});

describe('scheduleImpactOf agrees with what actually happens', () => {
  /** Applies a change the way the app does: school count via setNumSchools, the rest via withDetails. */
  function applyChange(c: Contest, change: ScheduleRestructure): Contest {
    const { numSchools, ...patch } = change;
    let out = numSchools === undefined ? c : setNumSchools(c, numSchools, LATER);
    if (Object.keys(patch).length) out = withDetails(out, patch, LATER);
    return out;
  }
  const isEmpty = (c: Contest) => c.scheduleOverrides.gaps.length === 0 && c.scheduleOverrides.arrival === undefined;

  const withOneBreak = () => withBreak(sameDay(), 'show', 0);
  const withArrivalOnly = () => {
    const c = sameDay();
    return edit(c, { kind: 'setStart', row: rowOf(c, 'arrival'), minutes: ARRIVAL });
  };
  const withNudgeAndBreak = () => {
    const c = withOneBreak();
    return edit(c, { kind: 'setStart', row: rowOf(c, 'show', 2), minutes: startOf(c, 'show', 2) + 10 });
  };

  const contests: [string, () => Contest][] = [
    ['no overrides', sameDay],
    ['one break', withOneBreak],
    ['arrival only', withArrivalOnly],
    ['a nudge and a break', withNudgeAndBreak],
  ];
  const changes: [string, ScheduleRestructure][] = [
    ['flip critique format', { critiqueFormat: 'after_each' }],
    ['same critique format', { critiqueFormat: 'after_all' }],
    ['more schools', { numSchools: 5 }],
    ['same school count', { numSchools: 3 }],
    ['below the minimum (clamps to the same count)', { numSchools: 1 }],
    ['judge count', { numJudges: 1 }],
    ['first show time', { firstShowTime: '9:00 AM' }],
    ['rehearsal start', { rehearsalStartTime1: '9:00 AM' }],
    ['contest date', { contestDate: '2026-04-04' }],
  ];

  for (const [cName, make] of contests) {
    for (const [chName, change] of changes) {
      it(`${cName} × ${chName}`, () => {
        const c = make();
        const after = applyChange(c, change);
        const impact = scheduleImpactOf(c, change);
        expect(impact.clearsOverrides).toBe(!isEmpty(c) && isEmpty(after));
        expect(impact.breakCount).toBe(c.scheduleOverrides.gaps.length);
      });
    }
  }
});

describe('scheduleRows', () => {
  it('lists the whole day in order with each row event', () => {
    const c = withBreak(sameDay(), 'show', 0);
    expect(scheduleRows(c).map((r) => r.event)).toEqual(day(c));
  });

  it('canEditStart on every row except breaks; canAddBreakAfter on anchorable rows only', () => {
    const rows = scheduleRows(withBreak(sameDay(), 'show', 0));
    for (const r of rows) {
      expect(r.canEditStart).toBe(r.event.type !== 'break');
      expect(r.canAddBreakAfter).toBe(!['arrival', 'break'].includes(r.event.type));
    }
  });

  it('only labeled break rows are breaks and can move; ends cannot move past the day', () => {
    let c = withBreak(sameDay(), 'rehearsal', 0, 10, 'First');
    c = withBreak(c, 'show', 1, 10, 'Middle');
    c = withBreak(c, 'awards', undefined, 10, 'Last');
    const rows = scheduleRows(c);
    const byLabel = (label: string) => rows.find((r) => r.event.type === 'break' && r.event.label === label)!;
    expect(byLabel('First')).toMatchObject({ isBreak: true, canMoveUp: false, canMoveDown: true });
    expect(byLabel('Middle')).toMatchObject({ isBreak: true, canMoveUp: true, canMoveDown: true });
    expect(byLabel('Last')).toMatchObject({ isBreak: true, canMoveUp: true, canMoveDown: false });
    for (const r of rows.filter((x) => x.event.type !== 'break')) {
      expect(r).toMatchObject({ isBreak: false, canMoveUp: false, canMoveDown: false });
    }
  });

  it('carries each row validation reasons, matching validateSchedule', () => {
    // A 4:00 AM first show trips the early-morning check on the early rows.
    const c = withDetails(makeContest(), { firstShowTime: '4:00 AM', directorsMeetingTime: '' }, NOW);
    const rows = scheduleRows(c);
    expect(rows.flatMap((r) => r.flags)).toEqual(validateSchedule(day(c)).map((f) => f.message));
    expect(rows[0].flags.length).toBeGreaterThan(0);
    expect(rows[rows.length - 1].flags).toEqual([]);
  });

  it('is empty without a first-show time', () => {
    expect(scheduleRows(createContest({ id: 'x', now: NOW }))).toEqual([]);
  });
});

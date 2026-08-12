import { describe, expect, it } from 'vitest';
import {
  addBreak,
  updateBreak,
  createContest,
  setNumSchools,
  withDetails,
  withSchool,
  type Contest,
  type CritiqueFormat,
} from './contest';
import {
  computeContestDay,
  computeSchedule,
  fmtTime,
  isSameDayRehearsal,
  parseTime,
  scheduleEventKey,
  type ScheduleEvent,
} from './schedule';

const NOW = '2026-07-05T12:00:00.000Z';

/** Deterministic contest: named schools 1..n in performance order, timings set. */
function makeContest(
  format: CritiqueFormat,
  n: number,
  opts: { firstShow?: string; dm?: string; numJudges?: number } = {},
): Contest {
  const { firstShow = '11:00 AM', dm = '', numJudges = 3 } = opts;
  let c = createContest({ id: 'test-id', now: NOW });
  c = setNumSchools(c, n);
  c = withDetails(c, { critiqueFormat: format, numJudges, firstShowTime: firstShow, directorsMeetingTime: dm });
  for (let i = 0; i < n; i++) {
    c = withSchool(c, i, { name: `School ${String.fromCharCode(65 + i)}`, performanceOrder: i + 1 });
  }
  return c;
}

/* ── Spec-encoded expected timeline, written from the v12 rules independently
 *    of the implementation. Durations are the v12 constants spelled out here so
 *    a reader can check them against the legacy app. ── */
const D = { FIRST: 50, PERF: 40, EACH: 25, ALL: 15, TAB: 30, AWARDS: 30, CRIT: 15 };

interface Row {
  start: number;
  end: number;
  label: string;
  type: ScheduleEvent['type'];
}

function expectedTimeline(
  format: CritiqueFormat,
  names: string[],
  opts: { startMin?: number; numJudges?: number; dmMins?: number | null } = {},
): Row[] {
  const { startMin = 660, numJudges = 3, dmMins = null } = opts;
  const n = names.length;
  const rows: Row[] = [];
  let t = startMin;

  const show = (i: number): void => {
    const dur = i === 0 ? D.FIRST : D.PERF;
    const label = names[i] + (i === 0 ? ' — Setup and Performance' : ' — Performance');
    rows.push({ start: t, end: t + dur, label, type: 'show' });
    t += dur;
  };
  const admin = (dur: number, label: string, type: Row['type']): void => {
    rows.push({ start: t, end: t + dur, label, type });
    t += dur;
  };

  if (format === 'after_each') {
    for (let i = 0; i < n; i++) {
      show(i);
      const label =
        i < n - 1
          ? `School ${i + 1} Strike & Critique — School ${i + 2} Setup`
          : `School ${i + 1} Strike & Critique`;
      admin(D.EACH, label, 'trans');
    }
    admin(D.TAB, "Judge's Tabulation", 'admin');
    admin(D.AWARDS, 'Awards Ceremony', 'awards');
  } else {
    for (let i = 0; i < n; i++) {
      show(i);
      if (i < n - 1) admin(D.ALL, `School ${i + 1} Strike — School ${i + 2} Setup`, 'trans');
    }
    admin(D.ALL, `School ${n} Strike`, 'trans');
    admin(D.TAB, "Judge's Tabulation", 'admin');
    const crit = Math.ceil(n / numJudges) * D.CRIT;
    const label = numJudges > 1 ? `Critiques — ${numJudges} Judges Concurrent` : `Critiques — ${n} Shows Sequential`;
    admin(crit, label, 'crit');
    admin(D.AWARDS, 'Awards Ceremony', 'awards');
  }

  if (dmMins != null && dmMins < startMin) {
    rows.unshift({ start: dmMins, end: startMin, label: 'Directors’ Meeting', type: 'dm' });
  }
  return rows;
}

/** Assert-on-behavior projection: start/end/label/type per row (not internals). */
function project(events: ScheduleEvent[]): Row[] {
  return events.map((e) => ({ start: e.start, end: e.end, label: e.label, type: e.type }));
}

const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `School ${String.fromCharCode(65 + i)}`);

describe('parseTime', () => {
  it.each([
    // v12 spaced forms — must never regress (the goldens depend on these).
    ['8:30 AM', 510],
    ['12:00 AM', 0],
    ['12:00 PM', 720],
    ['11:00 AM', 660],
    ['2 PM', 840],
    ['2:15 PM', 855],
    ['12 PM', 720],
    ['12 AM', 0],
    // PRD #179 — meridiem with no separating space (the reported AM/PM bug).
    ['1:00PM', 780],
    ['8:00AM', 480],
    ['12PM', 720],
    ['12AM', 0],
    // Single-letter, lowercase, and periods.
    ['1pm', 780],
    ['1p', 780],
    ['1a', 60],
    ['9:00 am', 540],
    ['2:30p.m.', 870],
    ['7:30 P', 1170],
    // 24-hour input.
    ['13:00', 780],
    ['0:30', 30],
    // Bare time, NO meridiem → taken literally (AM), never inferred.
    ['8', 480],
    ['1:00', 60],
  ])('parses %s → %i minutes', (input, mins) => {
    expect(parseTime(input)).toBe(mins);
  });

  it.each(['', '   ', 'noon', 'lunchtime', 'TBD', '25:00', '1:99', 'map'])(
    'returns null for unparseable %j',
    (input) => {
      expect(parseTime(input)).toBeNull();
    },
  );
});

describe('isSameDayRehearsal', () => {
  it('is true only when rehearsal day 1 equals the contest date with no second day', () => {
    const base = makeContest('after_all', 3, { firstShow: '1:00 PM' });
    const same = withDetails(base, { contestDate: '2026-03-21', rehearsalDate1: '2026-03-21', rehearsalDate2: '' });
    expect(isSameDayRehearsal(same)).toBe(true);
    expect(isSameDayRehearsal(withDetails(same, { rehearsalDate1: '2026-03-20' }))).toBe(false); // different date
    expect(isSameDayRehearsal(withDetails(same, { rehearsalDate2: '2026-03-22' }))).toBe(false); // has a day 2
    expect(isSameDayRehearsal(base)).toBe(false); // no dates set
  });
});

describe('computeContestDay', () => {
  const sameDay = (): Contest =>
    withDetails(makeContest('after_all', 3, { firstShow: '1:00 PM', dm: '12:30 PM' }), {
      contestDate: '2026-03-21',
      rehearsalDate1: '2026-03-21',
      rehearsalDate2: '',
      rehearsalStartTime1: '8:00 AM',
      rehearsalLengthMinutes: 90,
    });

  it('equals computeSchedule for a normal (non-same-day) contest', () => {
    const c = makeContest('after_all', 4, { firstShow: '11:00 AM', dm: '10:00 AM' });
    expect(computeContestDay(c)).toEqual(computeSchedule(c));
  });

  it('leads with CM arrival then one rehearsal per school, ahead of the contest timeline', () => {
    const c = sameDay();
    const day = computeContestDay(c);
    // Arrival is first, an hour before rehearsals begin (8:00 AM → 7:00 AM).
    expect(day[0]).toMatchObject({ type: 'arrival', label: 'CM Arrival', start: 7 * 60 });
    // One rehearsal per school in performance order, each 90 + 10-min transition.
    const reh = day.filter((e) => e.type === 'rehearsal');
    expect(reh.map((e) => e.label)).toEqual(['School 1 Rehearsal', 'School 2 Rehearsal', 'School 3 Rehearsal']);
    expect(reh[0]).toMatchObject({ start: 8 * 60, end: 8 * 60 + 100, school: 'School A' });
    expect(reh[1].start).toBe(8 * 60 + 100);
    // The rest of the day is exactly the contest timeline computeSchedule returns.
    expect(day.slice(1 + reh.length)).toEqual(computeSchedule(c));
    // Chronological: arrival < first rehearsal < first show.
    const firstShow = day.find((e) => e.type === 'show');
    expect(day[0].start).toBeLessThan(reh[0].start);
    expect(reh[0].start).toBeLessThan(firstShow!.start);
  });

  it('returns [] with no first-show time, even when rehearsals are same-day', () => {
    const c = withDetails(sameDay(), { firstShowTime: '' });
    expect(computeContestDay(c)).toEqual([]);
  });
});

describe('fmtTime', () => {
  it.each([
    [510, '8:30 AM'],
    [0, '12:00 AM'],
    [720, '12:00 PM'],
    [660, '11:00 AM'],
    [840, '2:00 PM'],
  ])('formats %i minutes → %s', (mins, str) => {
    expect(fmtTime(mins)).toBe(str);
  });

  it('returns empty string for null / NaN', () => {
    expect(fmtTime(null)).toBe('');
    expect(fmtTime(NaN)).toBe('');
  });

  it('round-trips with parseTime', () => {
    for (const s of ['8:30 AM', '11:00 AM', '2:15 PM', '12:00 PM', '12:00 AM']) {
      expect(fmtTime(parseTime(s))).toBe(s);
    }
  });
});

describe('computeSchedule — table-driven, both formats × 3–8 schools', () => {
  const formats: CritiqueFormat[] = ['after_each', 'after_all'];
  for (const format of formats) {
    for (let n = 3; n <= 8; n++) {
      it(`${format}, ${n} schools matches the v12 timeline`, () => {
        const c = makeContest(format, n, { firstShow: '11:00 AM', numJudges: 3 });
        expect(project(computeSchedule(c))).toEqual(expectedTimeline(format, names(n)));
      });
    }
  }
});

describe('computeSchedule — directors-meeting prepend', () => {
  it('prepends the meeting row when it parses and precedes the first show', () => {
    const c = makeContest('after_all', 3, { firstShow: '11:00 AM', dm: '10:00 AM' });
    const events = computeSchedule(c);
    expect(project(events)).toEqual(expectedTimeline('after_all', names(3), { dmMins: 600 }));
    expect(events[0]).toMatchObject({ start: 600, end: 660, dur: 60, type: 'dm', colorIdx: 0 });
  });

  it('omits the meeting row when the meeting is at or after the first show', () => {
    const c = makeContest('after_all', 3, { firstShow: '11:00 AM', dm: '11:00 AM' });
    expect(computeSchedule(c).some((e) => e.type === 'dm')).toBe(false);
  });

  it('omits the meeting row when the meeting time is unparseable', () => {
    const c = makeContest('after_all', 3, { firstShow: '11:00 AM', dm: 'TBD' });
    expect(computeSchedule(c).some((e) => e.type === 'dm')).toBe(false);
  });
});

describe('computeSchedule — concrete v12 clock anchors', () => {
  it('after_all, 3 schools, 3 judges — exact start/end clock strings', () => {
    const c = makeContest('after_all', 3, { firstShow: '11:00 AM', dm: '10:00 AM', numJudges: 3 });
    const clock = computeSchedule(c).map((e) => [fmtTime(e.start), fmtTime(e.end), e.label]);
    expect(clock).toEqual([
      ['10:00 AM', '11:00 AM', 'Directors’ Meeting'],
      ['11:00 AM', '11:50 AM', 'School A — Setup and Performance'],
      ['11:50 AM', '12:05 PM', 'School 1 Strike — School 2 Setup'],
      ['12:05 PM', '12:45 PM', 'School B — Performance'],
      ['12:45 PM', '1:00 PM', 'School 2 Strike — School 3 Setup'],
      ['1:00 PM', '1:40 PM', 'School C — Performance'],
      ['1:40 PM', '1:55 PM', 'School 3 Strike'],
      ['1:55 PM', '2:25 PM', "Judge's Tabulation"],
      ['2:25 PM', '2:40 PM', 'Critiques — 3 Judges Concurrent'],
      ['2:40 PM', '3:10 PM', 'Awards Ceremony'],
    ]);
  });

  it('after_each, 3 schools — exact start/end clock strings', () => {
    const c = makeContest('after_each', 3, { firstShow: '11:00 AM' });
    const clock = computeSchedule(c).map((e) => [fmtTime(e.start), fmtTime(e.end), e.label]);
    expect(clock).toEqual([
      ['11:00 AM', '11:50 AM', 'School A — Setup and Performance'],
      ['11:50 AM', '12:15 PM', 'School 1 Strike & Critique — School 2 Setup'],
      ['12:15 PM', '12:55 PM', 'School B — Performance'],
      ['12:55 PM', '1:20 PM', 'School 2 Strike & Critique — School 3 Setup'],
      ['1:20 PM', '2:00 PM', 'School C — Performance'],
      ['2:00 PM', '2:25 PM', 'School 3 Strike & Critique'],
      ['2:25 PM', '2:55 PM', "Judge's Tabulation"],
      ['2:55 PM', '3:25 PM', 'Awards Ceremony'],
    ]);
  });
});

describe('computeSchedule — critique block scales with judge count (after_all)', () => {
  it.each([
    [1, 6, 'Critiques — 6 Shows Sequential'],
    [2, 3, 'Critiques — 2 Judges Concurrent'],
    [3, 2, 'Critiques — 3 Judges Concurrent'],
  ])('%i judge(s), 6 schools → %i × 15-min block', (numJudges, showsPerJudge, label) => {
    const c = makeContest('after_all', 6, { numJudges });
    const crit = computeSchedule(c).find((e) => e.type === 'crit');
    expect(crit?.dur).toBe(showsPerJudge * 15);
    expect(crit?.label).toBe(label);
  });
});

describe('computeSchedule — empty timeline, never NaN rows', () => {
  it('returns [] when the first-show time is blank', () => {
    expect(computeSchedule(makeContest('after_all', 4, { firstShow: '' }))).toEqual([]);
  });

  it('returns [] when the first-show time is unparseable (and ignores a valid meeting time)', () => {
    expect(computeSchedule(makeContest('after_all', 4, { firstShow: 'lunchtime', dm: '9:00 AM' }))).toEqual([]);
  });

  it('never emits a NaN start/end/dur for any field or format', () => {
    for (const format of ['after_each', 'after_all'] as CritiqueFormat[]) {
      const events = computeSchedule(makeContest(format, 5, { firstShow: '9:00 AM', dm: '8:00 AM' }));
      for (const e of events) {
        expect(Number.isNaN(e.start)).toBe(false);
        expect(Number.isNaN(e.end)).toBe(false);
        expect(Number.isNaN(e.dur)).toBe(false);
      }
    }
  });
});

describe('computeSchedule — schools consumed in performance order', () => {
  it('orders show rows by performanceOrder, not form order', () => {
    let c = createContest({ id: 'test-id', now: NOW });
    c = setNumSchools(c, 3);
    c = withDetails(c, { critiqueFormat: 'after_all', firstShowTime: '11:00 AM' });
    // Form order A,B,C but draw order reversed: C performs first, A last.
    c = withSchool(c, 0, { name: 'Alpha', performanceOrder: 3 });
    c = withSchool(c, 1, { name: 'Bravo', performanceOrder: 2 });
    c = withSchool(c, 2, { name: 'Charlie', performanceOrder: 1 });
    const shows = computeSchedule(c).filter((e) => e.type === 'show').map((e) => e.school);
    expect(shows).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });

  it("falls back to 'School {formIndex}' for a blank school name (v12 parity)", () => {
    let c = makeContest('after_all', 3);
    c = withSchool(c, 1, { name: '   ' }); // form slot 2 blanked
    const secondShow = computeSchedule(c).filter((e) => e.type === 'show')[1];
    expect(secondShow.school).toBe('School 2');
    expect(secondShow.label).toBe('School 2 — Performance');
  });
});

describe('scheduleEventKey', () => {
  it('keys cascade rows and returns null for non-anchorable rows', () => {
    const base = computeSchedule(makeContest('after_all', 3, { firstShow: '11:00 AM', dm: '10:00 AM' }));
    expect(scheduleEventKey(base.find((e) => e.type === 'dm')!)).toBe('dm');
    expect(scheduleEventKey(base.find((e) => e.type === 'show')!)).toBe('show:0');
    expect(scheduleEventKey(base.find((e) => e.type === 'awards')!)).toBe('awards');
    // arrival / rehearsal / break come from outside the cascade — not anchorable.
    expect(scheduleEventKey({ ...base[0], type: 'arrival' })).toBeNull();
    expect(scheduleEventKey({ ...base[0], type: 'break' })).toBeNull();
  });
});

describe('computeSchedule — inserted-break overrides (PRD #179)', () => {
  const c = makeContest('after_all', 3, { firstShow: '11:00 AM' });
  const base = computeSchedule(c);

  it('inserts a break after its anchor and ripples every later row forward', () => {
    const out = computeSchedule(addBreak(c, 'show:0', 20, 'Lunch')); // reads contest.scheduleOverrides
    // The break sits immediately after the first show, at that show's end.
    expect(out).toHaveLength(base.length + 1);
    expect(out[0]).toEqual(base[0]); // anchor + everything before it is untouched
    expect(out[1]).toMatchObject({ type: 'break', label: 'Lunch', start: base[0].end, end: base[0].end + 20, dur: 20 });
    expect(out[1].overrideId).toBeTruthy();
    // Every row after the anchor shifted by exactly the gap length; durations kept.
    for (let i = 1; i < base.length; i++) {
      expect(out[i + 1]).toMatchObject({ ...base[i], start: base[i].start + 20, end: base[i].end + 20 });
    }
  });

  it('uses the label "Break" when the gap has no name', () => {
    const out = computeSchedule(addBreak(c, 'show:0', 10, ''));
    expect(out.find((e) => e.type === 'break')!.label).toBe('Break');
  });

  it('ignores an orphaned anchor rather than throwing', () => {
    expect(computeSchedule(addBreak(c, 'show:99', 20, 'X'))).toEqual(base);
  });

  it('applies multiple gaps cumulatively', () => {
    let g = addBreak(c, 'show:0', 10, 'A');
    g = addBreak(g, 'awards', 5, 'B');
    const out = computeSchedule(g);
    expect(out.filter((e) => e.type === 'break')).toHaveLength(2);
    expect(out).toHaveLength(base.length + 2);
  });

  it('honors an explicitly injected overrides argument over the contest field', () => {
    expect(computeSchedule(c, { gaps: [] })).toEqual(base);
  });

  it('re-anchoring a break (updateBreak) moves it to follow the new row', () => {
    let g = addBreak(c, 'show:0', 20, 'Lunch');
    g = updateBreak(g, g.scheduleOverrides.gaps[0].id, { anchor: 'show:1' });
    const out = computeSchedule(g);
    const bi = out.findIndex((e) => e.type === 'break');
    expect(scheduleEventKey(out[bi - 1])).toBe('show:1'); // now sits right after the 2nd show
  });
});

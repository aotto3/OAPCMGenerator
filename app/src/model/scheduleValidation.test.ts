import { describe, expect, it } from 'vitest';
import { createContest, setNumSchools, withDetails, withSchool, type Contest } from './contest';
import { computeContestDay, computeSchedule, type ScheduleEvent, type ScheduleEventType } from './schedule';
import { validateSchedule, type ScheduleFlagKind } from './scheduleValidation';

/** Build a ScheduleEvent from just the fields the validator reads. */
function ev(start: number, end: number, type: ScheduleEventType, label = 'Row'): ScheduleEvent {
  return { start, end, dur: end - start, label, play: '', school: '', type, colorIdx: -1 };
}

const kinds = (events: ScheduleEvent[]): ScheduleFlagKind[] => validateSchedule(events).map((f) => f.kind);

describe('validateSchedule — early morning (midnight–6 AM)', () => {
  it('flags an event that starts before 6:00 AM', () => {
    // 2:00 AM show — the classic AM/PM slip.
    expect(kinds([ev(120, 160, 'show')])).toEqual(['early-morning']);
  });

  it('flags an event whose time wrapped past midnight', () => {
    // 11:30 PM → 12:30 AM: the last minute is in the early-morning window.
    expect(kinds([ev(1410, 1470, 'show')])).toContain('early-morning');
  });

  it('does not flag 6:00 AM or later', () => {
    expect(validateSchedule([ev(360, 400, 'rehearsal')])).toEqual([]); // 6:00–6:40 AM
    expect(validateSchedule([ev(600, 650, 'show')])).toEqual([]); // 10:00 AM
  });

  it('flags 5:59 AM but not 6:00 AM (boundary)', () => {
    expect(kinds([ev(359, 359, 'arrival')])).toEqual(['early-morning']);
    expect(validateSchedule([ev(360, 360, 'arrival')])).toEqual([]);
  });
});

describe('validateSchedule — overlap', () => {
  it('flags an event that starts before the previous ends', () => {
    const flags = validateSchedule([ev(600, 700, 'show', 'A'), ev(650, 720, 'show', 'B')]);
    expect(flags.map((f) => f.kind)).toEqual(['overlap']);
    expect(flags[0].index).toBe(1); // the later, colliding row
  });

  it('does not flag back-to-back events (start == previous end)', () => {
    expect(validateSchedule([ev(600, 650, 'show'), ev(650, 690, 'show')])).toEqual([]);
  });

  it('does not flag a gap between events', () => {
    expect(validateSchedule([ev(600, 650, 'show'), ev(800, 840, 'show')])).toEqual([]);
  });

  it('catches an overlap against a non-adjacent earlier row', () => {
    // A long first row; a later row starts after row 2 but still inside row 1.
    const flags = validateSchedule([ev(480, 900, 'rehearsal', 'long'), ev(505, 515, 'arrival', 'blip'), ev(520, 560, 'show', 'C')]);
    // both blip and C start before the long rehearsal ends
    expect(flags.filter((f) => f.kind === 'overlap').map((f) => f.index)).toEqual([1, 2]);
  });
});

describe('validateSchedule — short show', () => {
  it('flags a performance under 40 minutes', () => {
    expect(kinds([ev(600, 630, 'show')])).toEqual(['short-show']);
  });

  it('does not flag a 40-minute show or a longer first-show slot', () => {
    expect(validateSchedule([ev(600, 640, 'show')])).toEqual([]); // exactly 40
    expect(validateSchedule([ev(600, 650, 'show')])).toEqual([]); // 50-min first slot
  });

  it('only applies to shows, not rehearsals or admin rows', () => {
    // Short, but neither is a performance — no short-show flag (and no overlap).
    expect(validateSchedule([ev(600, 610, 'trans'), ev(610, 630, 'rehearsal')])).toEqual([]);
  });
});

describe('validateSchedule — combinations & real timelines', () => {
  it('can put more than one flag on a single event', () => {
    // 2:00–2:20 AM show that also overlaps the prior row: early-morning + overlap + short-show.
    const flags = validateSchedule([ev(60, 200, 'trans', 'prev'), ev(120, 140, 'show', 'bad')]);
    expect(new Set(flags.filter((f) => f.index === 1).map((f) => f.kind))).toEqual(
      new Set(['early-morning', 'overlap', 'short-show']),
    );
  });

  it('is silent on a clean computed contest timeline', () => {
    let c: Contest = setNumSchools(createContest({ id: 't', now: '2026-07-05T12:00:00Z' }), 4);
    c = withDetails(c, { firstShowTime: '11:00 AM', directorsMeetingTime: '10:00 AM', critiqueFormat: 'after_all' });
    for (let i = 0; i < 4; i++) c = withSchool(c, i, { name: `School ${i + 1}`, performanceOrder: i + 1 });
    expect(validateSchedule(computeSchedule(c))).toEqual([]);
  });

  it('is silent on a realistic same-day rehearsal day', () => {
    let c: Contest = setNumSchools(createContest({ id: 't', now: '2026-07-05T12:00:00Z' }), 3);
    c = withDetails(c, {
      contestDate: '2026-03-21',
      rehearsalDate1: '2026-03-21',
      rehearsalDate2: '',
      rehearsalStartTime1: '8:00 AM',
      rehearsalLengthMinutes: 45,
      directorsMeetingTime: '1:00 PM',
      firstShowTime: '1:30 PM',
      critiqueFormat: 'after_all',
    });
    for (let i = 0; i < 3; i++) c = withSchool(c, i, { name: `School ${i + 1}`, performanceOrder: i + 1 });
    expect(validateSchedule(computeContestDay(c))).toEqual([]);
  });

  it('flags the overlaps in an impossible same-day (afternoon rehearsals, morning contest)', () => {
    let c: Contest = setNumSchools(createContest({ id: 't', now: '2026-07-05T12:00:00Z' }), 6);
    c = withDetails(c, {
      contestDate: '2026-03-21',
      rehearsalDate1: '2026-03-21',
      rehearsalDate2: '',
      rehearsalStartTime1: '2:00 PM', // rehearsals run into the night …
      rehearsalLengthMinutes: 90,
      directorsMeetingTime: '9:00 AM', // … but the contest is in the morning
      firstShowTime: '10:00 AM',
    });
    for (let i = 0; i < 6; i++) c = withSchool(c, i, { name: `School ${i + 1}`, performanceOrder: i + 1 });
    expect(kinds(computeContestDay(c))).toContain('overlap');
  });
});

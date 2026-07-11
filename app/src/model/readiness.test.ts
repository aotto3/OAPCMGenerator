import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_COMPLIANCE_ITEMS,
  addReadinessItem,
  addRosterMember,
  createContest,
  lockDraw,
  removeReadinessItem,
  runDraw,
  setAdjudicatorMilestone,
  setAdvancing,
  setComplianceStatus,
  setCritiqueAssignment,
  setReadinessStatus,
  withAdjudicator,
  withCmInfo,
  withDetails,
  withDirector,
  withIdentity,
  withSchool,
  type Contest,
  type ReadinessPhase,
} from './contest';
import { readinessReport, type ReadinessReportItem } from './readiness';

const NOW = '2026-07-05T12:00:00.000Z';

function contest(): Contest {
  return createContest({ id: 'test-id', now: NOW });
}

/** Find a phase's report by id. */
function phase(c: Contest, id: ReadinessPhase) {
  return readinessReport(c).phases.find((p) => p.phase === id)!;
}

/** Find a single item across every phase by id. */
function item(c: Contest, itemId: string): ReadinessReportItem | undefined {
  return readinessReport(c)
    .phases.flatMap((p) => p.items)
    .find((i) => i.id === itemId);
}

/**
 * A fully-ready contest: every derived item resolved. Built manually with the real
 * updaters so the report is exercised against genuine model state.
 */
function readyContest(): Contest {
  let c = contest();
  // Preliminary: identity + CM info complete, validation already passes by default.
  c = withIdentity(c, { hostSchoolName: 'Friendswood HS', hostVenueName: 'Auditorium', hostAddress: '1 Main St' });
  c = withCmInfo(c, { techContact: 'Brian Hamlin' });
  // Planning: all detail fields the section counts.
  c = withDetails(c, {
    contestDate: '2026-04-10',
    directorsMeetingTime: '10:00 AM',
    firstShowTime: '11:00 AM',
    rehearsalDate1: '2026-04-08',
    entrySystemDeadline: '2026-03-31',
    lightCueDeadlineDate: '2026-03-31',
  });
  // Contracting: 3 active judges, each fully entered + all milestones done.
  for (let j = 0; j < 3; j++) {
    c = withAdjudicator(c, j, { name: `Judge ${j + 1}`, mailingAddress: `${j + 1} Judge Rd` });
    c = setAdjudicatorMilestone(c, j, 'ttaoContractDate', true, NOW);
    c = setAdjudicatorMilestone(c, j, 'paymentPaperworkSentDate', true, NOW);
    c = setAdjudicatorMilestone(c, j, 'paymentPaperworkReturnedDate', true, NOW);
  }
  // Entry: every school named, directors filled, play titled, roster + compliance.
  for (let s = 0; s < c.schools.length; s++) {
    c = withSchool(c, s, { name: `School ${s + 1}`, playTitle: `Play ${s + 1}` });
    c = withDirector(c, s, 0, { name: `Dir ${s + 1}`, email: `dir${s + 1}@x.org` });
    c = addRosterMember(c, s, { name: `Actor ${s + 1}`, role: 'Lead', category: 'cast' });
    for (const ci of BUILT_IN_COMPLIANCE_ITEMS) c = setComplianceStatus(c, s, ci.id, 'received');
  }
  // Draw & Schedule: draw locked, critique set (schedule builds from firstShowTime).
  c = runDraw(c, [1, 2, 3, 4, 5, 6], NOW);
  c = lockDraw(c, NOW);
  c = setCritiqueAssignment(c, [1, 2, 3, 1, 2, 3], NOW);
  // Results & Advancement: at least one recorded outcome ⇒ results !== null.
  c = setAdvancing(c, [0, 1]);
  return c;
}

describe('readinessReport — structure', () => {
  it('returns the seven chronological phases in order with labels', () => {
    const report = readinessReport(contest());
    expect(report.phases.map((p) => p.phase)).toEqual([
      'preliminary',
      'planning',
      'contracting',
      'entry',
      'draw_schedule',
      'contest_day',
      'results_advancement',
    ]);
    expect(report.phases.map((p) => p.label)).toEqual([
      'Preliminary Info',
      'Planning Meeting',
      'Contracting',
      'Entry',
      'Draw & Schedule',
      'Contest Day',
      'Results & Advancement',
    ]);
  });

  it('every derived item carries a kind, status, and a jump-to section', () => {
    const derived = readinessReport(contest())
      .phases.flatMap((p) => p.items)
      .filter((i) => i.kind === 'derived');
    expect(derived.length).toBeGreaterThan(0);
    for (const i of derived) {
      expect(i.status === 'done' || i.status === 'pending').toBe(true); // never N-A
      expect(i.section).toMatch(/^sec-/);
    }
  });
});

describe('readinessReport — rollup and color', () => {
  it('a contest with zero progress is red (every applicable item pending)', () => {
    // Break the one item a fresh contest resolves (validation) so nothing is done.
    const c = withIdentity(contest(), { contestYear: '' });
    const report = readinessReport(c);
    expect(report.done).toBe(0);
    expect(report.color).toBe('red');
    expect(item(c, 'validation')!.status).toBe('pending');
  });

  it('a partially-filled contest is yellow', () => {
    // Fresh contest: validation passes, everything else pending ⇒ in progress.
    const report = readinessReport(contest());
    expect(report.done).toBeGreaterThan(0);
    expect(report.done).toBeLessThan(report.applicable);
    expect(report.color).toBe('yellow');
  });

  it('a fully-ready contest is green (every applicable item resolved)', () => {
    // Manual built-ins have no data source; mark them N-A so only derived items remain.
    let c = readyContest();
    for (const id of ['venue_reserved', 'hospitality_arranged', 'trophies_ordered', 'programs_printed', 'tech_set']) {
      c = setReadinessStatus(c, id, 'na');
    }
    const report = readinessReport(c);
    expect(report.done).toBe(report.applicable);
    expect(report.color).toBe('green');
    for (const p of report.phases) expect(p.color).toBe('green');
  });

  it('marking a manual item Done (not N-A) also counts toward green', () => {
    let c = readyContest();
    for (const id of ['venue_reserved', 'hospitality_arranged', 'trophies_ordered', 'programs_printed', 'tech_set']) {
      c = setReadinessStatus(c, id, 'done');
    }
    expect(readinessReport(c).color).toBe('green');
  });
});

describe('readinessReport — N-A denominator rules (Group A parity)', () => {
  it('an N-A item drops out of the phase and overall denominators', () => {
    const base = readinessReport(contest());
    // Contest Day = one derived item (documents, pending) + one manual (tech_set, pending).
    const beforeDay = phase(contest(), 'contest_day');
    expect(beforeDay.applicable).toBe(2);

    const c = setReadinessStatus(contest(), 'tech_set', 'na');
    const afterDay = phase(c, 'contest_day');
    expect(afterDay.applicable).toBe(1); // tech_set no longer counts
    // Overall applicable drops by exactly one.
    expect(readinessReport(c).applicable).toBe(base.applicable - 1);
  });

  it('a phase whose every item is N-A or done is green (nothing applicable pending)', () => {
    // Planning = details (derived) + venue + hospitality (manual). N-A the manuals and
    // complete the details derivation ⇒ nothing applicable is still pending.
    let c = withDetails(contest(), {
      contestDate: '2026-04-10',
      directorsMeetingTime: '10:00 AM',
      firstShowTime: '11:00 AM',
      rehearsalDate1: '2026-04-08',
      entrySystemDeadline: '2026-03-31',
      lightCueDeadlineDate: '2026-03-31',
    });
    c = setReadinessStatus(c, 'venue_reserved', 'na');
    c = setReadinessStatus(c, 'hospitality_arranged', 'na');
    const planning = phase(c, 'planning');
    expect(planning.items.find((i) => i.id === 'details')!.status).toBe('done');
    expect(planning.color).toBe('green');
  });
});

describe('readinessReport — phase assignment of derived sources', () => {
  const c = contest();
  const cases: { id: string; phase: ReadinessPhase; section: string }[] = [
    { id: 'cm', phase: 'preliminary', section: 'sec-cm' },
    { id: 'identity', phase: 'preliminary', section: 'sec-identity' },
    { id: 'validation', phase: 'preliminary', section: 'sec-identity' },
    { id: 'details', phase: 'planning', section: 'sec-details' },
    { id: 'judges', phase: 'contracting', section: 'sec-adjudicators' },
    { id: 'judge_milestones', phase: 'contracting', section: 'sec-adjudicators' },
    { id: 'schools', phase: 'entry', section: 'sec-schools' },
    { id: 'plays', phase: 'entry', section: 'sec-plays' },
    { id: 'compliance', phase: 'entry', section: 'sec-compliance' },
    { id: 'rosters', phase: 'entry', section: 'sec-companies' },
    { id: 'draw', phase: 'draw_schedule', section: 'sec-draw' },
    { id: 'schedule', phase: 'draw_schedule', section: 'sec-schedule' },
    { id: 'critique', phase: 'draw_schedule', section: 'sec-critique' },
    { id: 'documents', phase: 'contest_day', section: 'sec-generate' },
    { id: 'results', phase: 'results_advancement', section: 'sec-results' },
  ];
  it('places every derived source in its chronological phase with the right jump link', () => {
    for (const { id, phase: ph, section } of cases) {
      const found = phase(c, ph).items.find((i) => i.id === id);
      expect(found, `derived item ${id} in phase ${ph}`).toBeDefined();
      expect(found!.section).toBe(section);
    }
  });
});

describe('readinessReport — derived sources reflect their derivations', () => {
  it('section-completion items carry the section done/total count and flip when filled', () => {
    const empty = item(contest(), 'cm')!;
    expect(empty.count).toEqual({ done: 4, total: 5 }); // techContact blank by default
    expect(empty.status).toBe('pending');
    const filled = item(withCmInfo(contest(), { techContact: 'Brian' }), 'cm')!;
    expect(filled.count).toEqual({ done: 5, total: 5 });
    expect(filled.status).toBe('done');
  });

  it('compliance (A): counts schools whose tracker is green', () => {
    let c = contest();
    // Resolve every built-in for school 0 only ⇒ 1 of 6 schools green.
    for (const ci of BUILT_IN_COMPLIANCE_ITEMS) c = setComplianceStatus(c, 0, ci.id, 'received');
    const it = item(c, 'compliance')!;
    expect(it.count).toEqual({ done: 1, total: 6 });
    expect(it.status).toBe('pending');
  });

  it('judge milestones (D): counts done milestones across active judges', () => {
    // numJudges defaults to 3 ⇒ 9 milestone slots.
    let c = setAdjudicatorMilestone(contest(), 0, 'ttaoContractDate', true, NOW);
    c = setAdjudicatorMilestone(c, 1, 'ttaoContractDate', true, NOW);
    const it = item(c, 'judge_milestones')!;
    expect(it.count).toEqual({ done: 2, total: 9 });
    expect(it.status).toBe('pending');
  });

  it('draw-lock (B): done only when the draw is locked', () => {
    expect(item(contest(), 'draw')!.status).toBe('pending');
    const drawn = runDraw(contest(), [1, 2, 3, 4, 5, 6], NOW);
    expect(item(drawn, 'draw')!.status).toBe('pending'); // run but unlocked
    expect(item(lockDraw(drawn, NOW), 'draw')!.status).toBe('done');
  });

  it('schedule: done once a parseable first-show time yields a timeline', () => {
    expect(item(contest(), 'schedule')!.status).toBe('pending');
    const scheduled = withDetails(contest(), { firstShowTime: '9:00 AM' });
    expect(item(scheduled, 'schedule')!.status).toBe('done');
  });

  it('critique: done once an assignment is generated', () => {
    expect(item(contest(), 'critique')!.status).toBe('pending');
    const assigned = setCritiqueAssignment(contest(), [1, 2, 3, 1, 2, 3], NOW);
    expect(item(assigned, 'critique')!.status).toBe('done');
  });

  it('documents: done only when there are no generation warnings', () => {
    expect(item(contest(), 'documents')!.status).toBe('pending');
    const ready = readyContest();
    expect(item(ready, 'documents')!.status).toBe('done');
  });

  it('results (C): done once any outcome is recorded', () => {
    expect(item(contest(), 'results')!.status).toBe('pending');
    expect(item(setAdvancing(contest(), [0]), 'results')!.status).toBe('done');
  });

  it('rosters (E): counts schools with any roster member', () => {
    const c = addRosterMember(contest(), 2, { name: 'A', role: '', category: 'cast' });
    const it = item(c, 'rosters')!;
    expect(it.count).toEqual({ done: 1, total: 6 });
  });
});

describe('readinessReport — manual and custom flow-through', () => {
  it('surfaces the fixed built-in manual items in their declared phases', () => {
    const c = contest();
    expect(phase(c, 'planning').items.map((i) => i.id)).toContain('venue_reserved');
    expect(phase(c, 'planning').items.map((i) => i.id)).toContain('hospitality_arranged');
    expect(phase(c, 'entry').items.map((i) => i.id)).toContain('trophies_ordered');
    expect(phase(c, 'draw_schedule').items.map((i) => i.id)).toContain('programs_printed');
    expect(phase(c, 'contest_day').items.map((i) => i.id)).toContain('tech_set');
    // All manual by default, all pending.
    const venue = item(c, 'venue_reserved')!;
    expect(venue.kind).toBe('manual');
    expect(venue.status).toBe('pending');
  });

  it('reflects a stored manual status', () => {
    const c = setReadinessStatus(contest(), 'venue_reserved', 'done');
    expect(item(c, 'venue_reserved')!.status).toBe('done');
  });

  it('places a custom item in its declared phase and reflects its status', () => {
    let c = addReadinessItem(contest(), { id: 'parking', label: 'Parking arranged', phase: 'contest_day' });
    c = setReadinessStatus(c, 'parking', 'done');
    const found = item(c, 'parking')!;
    expect(found.kind).toBe('custom');
    expect(found.label).toBe('Parking arranged');
    expect(found.status).toBe('done');
    expect(phase(c, 'contest_day').items.map((i) => i.id)).toContain('parking');
  });

  it('removing a custom item drops the item and its status from the report', () => {
    let c = addReadinessItem(contest(), { id: 'parking', label: 'Parking', phase: 'contest_day' });
    c = setReadinessStatus(c, 'parking', 'done');
    c = removeReadinessItem(c, 'parking');
    expect(item(c, 'parking')).toBeUndefined();
  });

  it('orders items derived → built-in → custom within a phase', () => {
    const c = addReadinessItem(contest(), { id: 'z_custom', label: 'Z', phase: 'planning' });
    const ids = phase(c, 'planning').items.map((i) => i.id);
    // details (derived) before venue_reserved (built-in) before z_custom (custom).
    expect(ids.indexOf('details')).toBeLessThan(ids.indexOf('venue_reserved'));
    expect(ids.indexOf('venue_reserved')).toBeLessThan(ids.indexOf('z_custom'));
  });
});

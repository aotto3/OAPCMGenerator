import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_COMPLIANCE_ITEMS,
  CONTEST_SCHEMA_VERSION,
  MAX_BEST_PERFORMERS,
  MAX_ALL_STAR_CAST,
  MAX_HONORABLE_MENTION,
  advanceContest,
  canAdvanceContest,
  nextContestLevel,
  advancingPlaceCount,
  addAwardWinner,
  removeAwardWinner,
  setAdvancing,
  setAlternate,
  setBestCrew,
  setOutstandingTechnician,
  removeOutstandingTechnician,
  clearResults,
  withNextContest,
  defaultNextContest,
  DEFAULT_JUDGES,
  DEFAULT_SCHOOLS,
  DOCUMENT_TYPES,
  MAX_SCHOOLS,
  MIN_SCHOOLS,
  addComplianceItem,
  addDirector,
  complianceItems,
  complianceProgress,
  removeComplianceItem,
  setComplianceStatus,
  admissionFeeDisplay,
  allDirectorEmails,
  autoDeadlineFor,
  contestDisplayName,
  contestFileName,
  contestFullName,
  contestNamePreview,
  contestTitleLong,
  createContest,
  duplicateContest,
  generationWarnings,
  importContest,
  defaultAdjudicators,
  defaultDocumentSelection,
  entryFeeDisplay,
  lockCritique,
  lockDraw,
  moveCritiqueAssignment,
  numSchools,
  parseContest,
  runDraw,
  setCritiqueAssignment,
  unlockCritique,
  unlockDraw,
  rehearsalDay1Count,
  rehearsalDay2Count,
  removeDirector,
  schoolsInPerformanceOrder,
  sectionCompletion,
  serializeContest,
  setAllDocuments,
  setDocumentSelected,
  setNumSchools,
  validateContest,
  withAdjudicator,
  withCmInfo,
  withDetails,
  withDirector,
  withIdentity,
  withSchool,
  withSpeechwire,
  type Contest,
} from './contest';
import { drawOrder, type Rng } from './draw';

const NOW = '2026-07-05T12:00:00.000Z';
const LATER = '2026-07-06T00:00:00.000Z';

/** Deterministic seeded RNG (mulberry32) for the draw-generator integration test. */
function seededDraw(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function contest(identity: Partial<Contest['identity']> = {}): Contest {
  return createContest({ id: 'test-id', now: NOW, identity });
}

describe('createContest', () => {
  it('mirrors v12 defaults: current year, District, 5A, everything else blank', () => {
    const c = contest();
    expect(c.identity).toEqual({
      contestYear: '2026',
      contestLevel: 'District',
      classification: '5A',
      districtNumber: '',
      hostSchoolName: '',
      hostVenueName: '',
      hostAddress: '',
    });
    expect(c.createdAt).toBe(NOW);
    expect(c.updatedAt).toBe(NOW);
  });

  it('mirrors v12 detail defaults: after_all, 3 judges, 6 schools, 2:00 PM rehearsals, 5:00 PM light cue, 90-minute slots', () => {
    const { details } = contest();
    expect(details.critiqueFormat).toBe('after_all');
    expect(details.numJudges).toBe(DEFAULT_JUDGES);
    expect(details.rehearsalStartTime1).toBe('2:00 PM');
    expect(details.rehearsalStartTime2).toBe('2:00 PM');
    expect(details.rehearsalLengthMinutes).toBe(90);
    expect(details.lightCueDeadlineTime).toBe('5:00 PM');
    expect(details.rehearsalDay1Count).toBeNull();
  });

  it('pre-fills CM info like the v12 form and starts with blank tech contact', () => {
    const { cmInfo } = contest();
    expect(cmInfo.name).toBe('Allen Otto');
    expect(cmInfo.email).toBe('aotto3@gmail.com');
    expect(cmInfo.techContact).toBe('');
  });

  it('starts with 6 blank schools, one director row each, order = position', () => {
    const c = contest();
    expect(c.schools).toHaveLength(DEFAULT_SCHOOLS);
    c.schools.forEach((s, i) => {
      expect(s.directors).toEqual([{ name: '', email: '' }]);
      expect(s.performanceOrder).toBe(i + 1);
      expect(s.playTitle).toBe('');
    });
  });

  it('starts with 3 blank adjudicators (hotel nights default 1)', () => {
    const c = contest();
    expect(c.adjudicators).toHaveLength(3);
    expect(c.adjudicators[0]).toEqual({
      name: '',
      mailingAddress: '',
      needsPower: false,
      needsHotel: false,
      hotelNights: 1,
      dietary: '',
    });
  });

  it('selects the v12 default document set (all but adj packets and timer)', () => {
    const { documents } = contest();
    expect(documents.adj_packets).toBe(false);
    expect(documents.timer).toBe(false);
    for (const doc of DOCUMENT_TYPES) {
      expect(documents[doc.id]).toBe(doc.defaultSelected);
    }
  });

  it('starts with blank device-only Speechwire credentials', () => {
    expect(contest().speechwire).toEqual({ username: '', password: '' });
  });

  it('generates a unique id when none is given', () => {
    expect(createContest().id).not.toBe(createContest().id);
  });
});

describe('update helpers', () => {
  it('withIdentity patches immutably and bumps updatedAt', () => {
    const before = contest();
    const after = withIdentity(before, { districtNumber: '20' }, LATER);
    expect(after.identity.districtNumber).toBe('20');
    expect(after.updatedAt).toBe(LATER);
    expect(before.identity.districtNumber).toBe(''); // original untouched
  });

  it('withCmInfo patches CM fields', () => {
    const c = withCmInfo(contest(), { techContact: 'Brian Hamlin' }, LATER);
    expect(c.cmInfo.techContact).toBe('Brian Hamlin');
    expect(c.updatedAt).toBe(LATER);
  });

  it('withSpeechwire patches credentials', () => {
    const c = withSpeechwire(contest(), { username: 'district20-5a', password: 'hunter2' }, LATER);
    expect(c.speechwire).toEqual({ username: 'district20-5a', password: 'hunter2' });
  });

  it('withAdjudicator patches one judge and leaves the others alone', () => {
    const c = withAdjudicator(contest(), 1, { name: 'Jane Judge', needsHotel: true, hotelNights: 2 }, LATER);
    expect(c.adjudicators[1].name).toBe('Jane Judge');
    expect(c.adjudicators[1].hotelNights).toBe(2);
    expect(c.adjudicators[0].name).toBe('');
    expect(c.adjudicators[2].name).toBe('');
  });

  it('withSchool patches name/play/order for one school', () => {
    const c = withSchool(contest(), 2, { name: 'Westlake HS', playTitle: 'Our Town', performanceOrder: 1 }, LATER);
    expect(c.schools[2]).toMatchObject({ name: 'Westlake HS', playTitle: 'Our Town', performanceOrder: 1 });
    expect(c.schools[0].name).toBe('');
  });

  it('withDirector patches one director row', () => {
    const c = withDirector(contest(), 0, 0, { name: 'Pat Director', email: 'pat@district.org' }, LATER);
    expect(c.schools[0].directors[0]).toEqual({ name: 'Pat Director', email: 'pat@district.org' });
  });
});

describe('directors add/remove (v12 director rows)', () => {
  it('addDirector appends a blank row to the right school', () => {
    const c = addDirector(contest(), 1, LATER);
    expect(c.schools[1].directors).toHaveLength(2);
    expect(c.schools[0].directors).toHaveLength(1);
  });

  it('removeDirector removes a row but never the last one', () => {
    let c = addDirector(contest(), 0);
    c = withDirector(c, 0, 1, { email: 'second@x.org' });
    c = removeDirector(c, 0, 0);
    expect(c.schools[0].directors).toEqual([{ name: '', email: 'second@x.org' }]);
    // last row is protected — contest returned unchanged
    expect(removeDirector(c, 0, 0)).toBe(c);
  });

  it('multiple directors round-trip through serialize/parse', () => {
    let c = addDirector(contest(), 0);
    c = withDirector(c, 0, 0, { name: 'A', email: 'a@x.org' });
    c = withDirector(c, 0, 1, { name: 'B', email: 'b@x.org' });
    const back = parseContest(serializeContest(c));
    expect(back.schools[0].directors).toEqual([
      { name: 'A', email: 'a@x.org' },
      { name: 'B', email: 'b@x.org' },
    ]);
  });
});

describe('setNumSchools', () => {
  it('grows with blank schools ordered by position', () => {
    const c = setNumSchools(contest(), 8, LATER);
    expect(numSchools(c)).toBe(8);
    expect(c.schools[7].performanceOrder).toBe(8);
  });

  it('shrinks by dropping trailing schools', () => {
    let c = withSchool(contest(), 0, { name: 'Keep Me' });
    c = setNumSchools(c, 3);
    expect(numSchools(c)).toBe(3);
    expect(c.schools[0].name).toBe('Keep Me');
  });

  it('clamps to the 3–8 range', () => {
    expect(numSchools(setNumSchools(contest(), 1))).toBe(MIN_SCHOOLS);
    expect(numSchools(setNumSchools(contest(), 12))).toBe(MAX_SCHOOLS);
  });
});

describe('document selection', () => {
  it('toggles a single document', () => {
    const c = setDocumentSelected(contest(), 'adj_packets', true, LATER);
    expect(c.documents.adj_packets).toBe(true);
    expect(c.documents.timer).toBe(false);
  });

  it('check all / uncheck all', () => {
    const all = setAllDocuments(contest(), true);
    expect(Object.values(all.documents).every(Boolean)).toBe(true);
    const none = setAllDocuments(all, false);
    expect(Object.values(none.documents).some(Boolean)).toBe(false);
  });

  it('defaultDocumentSelection covers every registered document', () => {
    expect(Object.keys(defaultDocumentSelection()).sort()).toEqual(DOCUMENT_TYPES.map((d) => d.id).sort());
  });
});

describe('derived names (v12 formats)', () => {
  const id = contest({ contestYear: '2026', districtNumber: '20' }).identity;

  it('display / folder name: "2026 — 5A District 20 OAP"', () => {
    expect(contestDisplayName(id)).toBe('2026 — 5A District 20 OAP');
  });

  it('name preview: "2026 — 5A — District 20 — OAP"', () => {
    expect(contestNamePreview(id)).toBe('2026 — 5A — District 20 — OAP');
  });

  it('full name: "UIL 5A District 20 One-Act Play Contest"', () => {
    expect(contestFullName(id)).toBe('UIL 5A District 20 One-Act Play Contest');
  });

  it('long title: "2026 UIL 5A District 20 One-Act Play Contest"', () => {
    expect(contestTitleLong(id)).toBe('2026 UIL 5A District 20 One-Act Play Contest');
  });

  it('omits the number when districtNumber is blank (e.g. BiDistrict)', () => {
    const bidc = contest({ contestLevel: 'BiDistrict', districtNumber: '' }).identity;
    expect(contestDisplayName(bidc)).toBe('2026 — 5A BiDistrict OAP');
    expect(contestFullName(bidc)).toBe('UIL 5A BiDistrict One-Act Play Contest');
  });

  it('drops empty segments in the preview like v12 filter(Boolean)', () => {
    const noYear = contest({ contestYear: '', districtNumber: '20' }).identity;
    expect(contestNamePreview(noYear)).toBe('5A — District 20 — OAP');
  });

  it('trims whitespace in year and number like v12', () => {
    const padded = contest({ contestYear: ' 2026 ', districtNumber: ' 20 ' }).identity;
    expect(contestNamePreview(padded)).toBe('2026 — 5A — District 20 — OAP');
  });
});

describe('auto-calculated deadlines (v12 autoCalcDeadlines)', () => {
  it('deadline default is 10 days before the contest', () => {
    expect(autoDeadlineFor('2026-04-10')).toBe('2026-03-31');
  });

  it('crosses month boundaries correctly', () => {
    expect(autoDeadlineFor('2026-03-05')).toBe('2026-02-23');
  });

  it('returns blank for blank or invalid input', () => {
    expect(autoDeadlineFor('')).toBe('');
    expect(autoDeadlineFor('not-a-date')).toBe('');
  });

  it('withDetails fills blank deadlines when the contest date is set', () => {
    const c = withDetails(contest(), { contestDate: '2026-04-10' }, LATER);
    expect(c.details.entrySystemDeadline).toBe('2026-03-31');
    expect(c.details.lightCueDeadlineDate).toBe('2026-03-31');
  });

  it('withDetails never overwrites a deadline the user already entered', () => {
    let c = withDetails(contest(), { entrySystemDeadline: '2026-03-15' });
    c = withDetails(c, { contestDate: '2026-04-10' });
    expect(c.details.entrySystemDeadline).toBe('2026-03-15'); // kept
    expect(c.details.lightCueDeadlineDate).toBe('2026-03-31'); // filled
  });

  it('withDetails leaves deadlines alone when other fields change', () => {
    const c = withDetails(contest(), { firstShowTime: '11:00 AM' });
    expect(c.details.entrySystemDeadline).toBe('');
  });
});

describe('rehearsal day-2 logic (v12 updateRehearsalDay2Count)', () => {
  it('defaults day 1 to floor(numSchools / 2), day 2 gets the rest', () => {
    const c = contest(); // 6 schools
    expect(rehearsalDay1Count(c)).toBe(3);
    expect(rehearsalDay2Count(c)).toBe(3);
    const seven = setNumSchools(c, 7);
    expect(rehearsalDay1Count(seven)).toBe(3);
    expect(rehearsalDay2Count(seven)).toBe(4);
  });

  it('a stored day-1 choice wins', () => {
    const c = withDetails(contest(), { rehearsalDay1Count: 2 });
    expect(rehearsalDay1Count(c)).toBe(2);
    expect(rehearsalDay2Count(c)).toBe(4);
  });

  it('clamps the stored choice so both days keep at least one school', () => {
    const c = withDetails(setNumSchools(contest(), 4), { rehearsalDay1Count: 7 });
    expect(rehearsalDay1Count(c)).toBe(3);
    expect(rehearsalDay2Count(c)).toBe(1);
  });
});

describe('fee displays (v12 _buildVars)', () => {
  it('formats entered fees', () => {
    const d = withDetails(contest(), { entryFee: '50', admissionFee: '10' }).details;
    expect(entryFeeDisplay(d)).toBe('$50 per school');
    expect(admissionFeeDisplay(d)).toBe('$10');
  });

  it('blank means no fee', () => {
    const d = contest().details;
    expect(entryFeeDisplay(d)).toBe('No entry fee');
    expect(admissionFeeDisplay(d)).toBe('No admission charge');
  });
});

describe('all-director email list (v12 updateEmailList)', () => {
  it('collects non-blank emails across all schools and directors, in form order', () => {
    let c = withDirector(contest(), 0, 0, { email: ' a@x.org ' });
    c = addDirector(c, 0);
    c = withDirector(c, 0, 1, { email: 'b@x.org' });
    c = withDirector(c, 2, 0, { email: 'c@x.org' });
    expect(allDirectorEmails(c)).toEqual(['a@x.org', 'b@x.org', 'c@x.org']);
  });
});

describe('schoolsInPerformanceOrder', () => {
  it('sorts by order, keeping form order for ties', () => {
    let c = withSchool(contest(), 0, { name: 'First Form', performanceOrder: 3 });
    c = withSchool(c, 1, { name: 'Goes First', performanceOrder: 1 });
    c = withSchool(c, 2, { name: 'Tied', performanceOrder: 3 });
    const names = schoolsInPerformanceOrder(c).map((s) => s.name);
    expect(names.slice(0, 1)).toEqual(['Goes First']);
    expect(names.indexOf('First Form')).toBeLessThan(names.indexOf('Tied'));
    expect(c.schools[0].name).toBe('First Form'); // original untouched
  });
});

describe('sectionCompletion', () => {
  it('counts filled expected fields per section', () => {
    const c = contest();
    const progress = sectionCompletion(c);
    expect(progress.cm).toEqual({ done: 4, total: 5 }); // v12 prefills all but tech contact
    expect(progress.identity).toEqual({ done: 1, total: 4 }); // year prefilled
    expect(progress.details).toEqual({ done: 0, total: 6 });
    expect(progress.adjudicators).toEqual({ done: 0, total: 6 }); // 3 judges × name+address
    expect(progress.schools).toEqual({ done: 0, total: 18 }); // 6 × (name + 1 director × 2)
    expect(progress.plays).toEqual({ done: 0, total: 6 });
  });

  it('BiDistrict adds the BiDistrict contest date to the details section', () => {
    const c = contest({ contestLevel: 'BiDistrict' });
    expect(sectionCompletion(c).details.total).toBe(7);
  });

  it('only active judges count', () => {
    let c = withDetails(contest(), { numJudges: 1 });
    c = withAdjudicator(c, 0, { name: 'Solo Judge', mailingAddress: '1 Main St' });
    expect(sectionCompletion(c).adjudicators).toEqual({ done: 2, total: 2 });
  });

  it('extra director rows raise the schools total', () => {
    const c = addDirector(contest(), 0);
    expect(sectionCompletion(c).schools.total).toBe(20);
  });
});

describe('validateContest', () => {
  it('accepts the default contest', () => {
    expect(validateContest(contest())).toEqual([]);
  });

  it('flags a blank year', () => {
    const issues = validateContest(contest({ contestYear: '' }));
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe('contestYear');
  });

  it('flags a non-4-digit year', () => {
    expect(validateContest(contest({ contestYear: '26' }))[0].field).toBe('contestYear');
  });

  it('flags out-of-enum level and classification', () => {
    const c = contest();
    const bad = {
      ...c,
      identity: { ...c.identity, contestLevel: 'State' as never, classification: '7A' as never },
    };
    expect(validateContest(bad).map((i) => i.field)).toEqual(['contestLevel', 'classification']);
  });

  it('flags out-of-range judges', () => {
    const c = withDetails(contest(), { numJudges: 4 });
    expect(validateContest(c).map((i) => i.field)).toEqual(['numJudges']);
  });

  it('flags duplicate performance orders (v12 generateAll warning)', () => {
    const c = withSchool(contest(), 1, { performanceOrder: 1 });
    expect(validateContest(c).map((i) => i.field)).toEqual(['performanceOrder']);
  });
});

describe('critique assignment helpers', () => {
  it('setCritiqueAssignment stores an unlocked, copied result and bumps updatedAt', () => {
    const source = [1, 2, 3, 1, 2, 3];
    const c = setCritiqueAssignment(contest(), source, LATER);
    expect(c.critique).toEqual({ judgeByPosition: [1, 2, 3, 1, 2, 3], locked: false });
    expect(c.updatedAt).toBe(LATER);
    // stored array is a copy — mutating the caller's array must not leak in
    source[0] = 9;
    expect(c.critique?.judgeByPosition[0]).toBe(1);
  });

  it('lock / unlock flip the frozen flag; both are no-ops when there is no assignment', () => {
    const none = contest();
    expect(lockCritique(none)).toBe(none);
    expect(unlockCritique(none)).toBe(none);

    const c = setCritiqueAssignment(none, [1, 2, 3], NOW);
    expect(lockCritique(c, LATER).critique).toEqual({ judgeByPosition: [1, 2, 3], locked: true });
    const locked = lockCritique(c, LATER);
    expect(unlockCritique(locked, LATER).critique?.locked).toBe(false);
  });

  it('moveCritiqueAssignment swaps ADJACENT judge assignments only', () => {
    const c = setCritiqueAssignment(contest(), [1, 2, 3, 1, 2, 3], NOW);
    // swap positions 1 and 2 (down from index 1)
    expect(moveCritiqueAssignment(c, 1, 1, LATER).critique?.judgeByPosition).toEqual([1, 3, 2, 1, 2, 3]);
    // swap positions 3 and 2 (up from index 3)
    expect(moveCritiqueAssignment(c, 3, -1, LATER).critique?.judgeByPosition).toEqual([1, 2, 1, 3, 2, 3]);
  });

  it('moveCritiqueAssignment is a no-op past the ends, for non-adjacent directions, or when LOCKED', () => {
    const c = setCritiqueAssignment(contest(), [1, 2, 3, 1, 2, 3], NOW);
    expect(moveCritiqueAssignment(c, 0, -1)).toBe(c); // off the top
    expect(moveCritiqueAssignment(c, 5, 1)).toBe(c); // off the bottom
    expect(moveCritiqueAssignment(c, 0, 2)).toBe(c); // non-adjacent
    const locked = lockCritique(c);
    expect(moveCritiqueAssignment(locked, 0, 1)).toBe(locked); // reorder disabled when locked
  });
});

describe('performance-order draw lifecycle (PRD #65)', () => {
  /** A 4-school contest with a known starting order (1,2,3,4). */
  function drawContest(): Contest {
    let c = setNumSchools(contest(), 4, NOW);
    for (let i = 0; i < 4; i++) c = withSchool(c, i, { name: `School ${i + 1}` }, NOW);
    return c;
  }

  it('a new contest has no draw record; order is fully hand-editable', () => {
    expect(contest().draw).toBeNull();
  });

  it('runDraw writes the permutation into performanceOrder AND records order + timestamp, unlocked', () => {
    const c = runDraw(drawContest(), [3, 1, 4, 2], LATER);
    // School i gets slot order[i].
    expect(c.schools.map((s) => s.performanceOrder)).toEqual([3, 1, 4, 2]);
    expect(c.draw).toEqual({ order: [3, 1, 4, 2], drawnAt: LATER, locked: false });
    expect(c.updatedAt).toBe(LATER);
  });

  it('always covers exactly the schools in the contest (slots match the field)', () => {
    const c = runDraw(drawContest(), [4, 3, 2, 1], NOW);
    expect(c.schools).toHaveLength(4);
    expect(c.draw?.order).toHaveLength(4);
    expect([...c.schools.map((s) => s.performanceOrder)].sort()).toEqual([1, 2, 3, 4]);
  });

  it('stores a copy of the order — mutating the caller array does not leak in', () => {
    const source = [2, 1, 4, 3];
    const c = runDraw(drawContest(), source, NOW);
    source[0] = 9;
    expect(c.draw?.order[0]).toBe(2);
    expect(c.schools[0].performanceOrder).toBe(2);
  });

  it('re-run while unlocked replaces both the order and the timestamp', () => {
    const first = runDraw(drawContest(), [1, 2, 3, 4], NOW);
    const second = runDraw(first, [4, 3, 2, 1], LATER);
    expect(second.schools.map((s) => s.performanceOrder)).toEqual([4, 3, 2, 1]);
    expect(second.draw).toEqual({ order: [4, 3, 2, 1], drawnAt: LATER, locked: false });
  });

  it('lockDraw freezes the record; running against a locked draw is a no-op', () => {
    const run = runDraw(drawContest(), [2, 4, 1, 3], NOW);
    const locked = lockDraw(run, LATER);
    expect(locked.draw).toEqual({ order: [2, 4, 1, 3], drawnAt: NOW, locked: true });
    expect(locked.updatedAt).toBe(LATER);
    // A run while locked changes nothing (the CM must unlock first).
    expect(runDraw(locked, [1, 2, 3, 4], '2026-08-01T00:00:00.000Z')).toBe(locked);
  });

  it('unlockDraw VOIDS the record but leaves the drawn slots in the fields (now editable)', () => {
    const locked = lockDraw(runDraw(drawContest(), [3, 1, 4, 2], NOW), NOW);
    const unlocked = unlockDraw(locked, LATER);
    expect(unlocked.draw).toBeNull();
    // The order values remain — only the record is voided.
    expect(unlocked.schools.map((s) => s.performanceOrder)).toEqual([3, 1, 4, 2]);
    expect(unlocked.updatedAt).toBe(LATER);
  });

  it('lockDraw / unlockDraw are no-ops when there is no draw record', () => {
    const none = drawContest();
    expect(lockDraw(none)).toBe(none);
    expect(unlockDraw(none)).toBe(none);
  });

  it('integrates with the pure drawOrder generator (a run stores a valid permutation)', () => {
    const c = runDraw(drawContest(), drawOrder(4, seededDraw(7)), NOW);
    expect([...(c.draw?.order ?? [])].sort()).toEqual([1, 2, 3, 4]);
    expect(c.schools.map((s) => s.performanceOrder).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('serialize / parse', () => {
  it('round-trips a fully filled contest exactly (minus device-only fields)', () => {
    let c = contest({ districtNumber: '20', hostSchoolName: 'Friendswood High School' });
    c = withDetails(c, { contestDate: '2026-04-10', entryFee: '50' });
    c = withAdjudicator(c, 0, { name: 'Jane Judge', needsHotel: true, hotelNights: 2 });
    c = withSchool(c, 0, { name: 'Westlake HS', playTitle: 'Our Town' });
    c = addDirector(c, 0);
    c = setDocumentSelected(c, 'timer', true);
    expect(parseContest(serializeContest(c))).toEqual(c);
  });

  it('writes the current schema version into the envelope', () => {
    const envelope = JSON.parse(serializeContest(contest()));
    expect(envelope.schemaVersion).toBe(CONTEST_SCHEMA_VERSION);
  });

  it('preserves a LOCKED critique assignment through serialize → parse (export/import survives)', () => {
    const c = lockCritique(setCritiqueAssignment(contest(), [1, 2, 3, 1, 2, 3], NOW), NOW);
    const back = parseContest(serializeContest(c));
    expect(back.critique).toEqual({ judgeByPosition: [1, 2, 3, 1, 2, 3], locked: true });
    expect(back).toEqual(c);
  });

  it('preserves an unlocked assignment too, and null when none was generated', () => {
    const unlocked = setCritiqueAssignment(contest(), [2, 1, 3], NOW);
    expect(parseContest(serializeContest(unlocked)).critique).toEqual({ judgeByPosition: [2, 1, 3], locked: false });
    expect(parseContest(serializeContest(contest())).critique).toBeNull();
  });

  it('preserves a LOCKED draw record through serialize → parse, and null when none was run', () => {
    const c = lockDraw(runDraw(contest(), [3, 1, 2, 6, 4, 5], NOW), NOW);
    const back = parseContest(serializeContest(c));
    expect(back.draw).toEqual({ order: [3, 1, 2, 6, 4, 5], drawnAt: NOW, locked: true });
    expect(back).toEqual(c);
    expect(parseContest(serializeContest(contest())).draw).toBeNull();
  });

  it('DEVICE-ONLY: Speechwire credentials never enter the serialized payload', () => {
    const c = withSpeechwire(contest(), { username: 'district20-5a', password: 's3cr3t-pw' });
    const json = serializeContest(c);
    expect(json).not.toContain('s3cr3t-pw');
    expect(json).not.toContain('district20-5a');
    expect(json).not.toContain('speechwire');
    // parsing yields blank credentials, ready for device-local re-attachment
    expect(parseContest(json).speechwire).toEqual({ username: '', password: '' });
  });

  it('MIGRATION: a v1 (Slice 1) payload gains all new sections with defaults', () => {
    const v1 = JSON.stringify({
      schemaVersion: 1,
      contest: {
        id: 'old-id',
        createdAt: NOW,
        updatedAt: NOW,
        identity: contest({ districtNumber: '20', hostSchoolName: 'Friendswood HS' }).identity,
      },
    });
    const migrated = parseContest(v1);
    expect(migrated.id).toBe('old-id');
    expect(migrated.identity.districtNumber).toBe('20'); // existing data preserved
    expect(migrated.details).toEqual(contest().details);
    expect(migrated.schools).toHaveLength(DEFAULT_SCHOOLS);
    expect(migrated.adjudicators).toHaveLength(3);
    expect(migrated.documents).toEqual(defaultDocumentSelection());
    expect(migrated.speechwire).toEqual({ username: '', password: '' });
    // and the result re-serializes at the current version
    expect(JSON.parse(serializeContest(migrated)).schemaVersion).toBe(CONTEST_SCHEMA_VERSION);
  });

  it('MIGRATION: a v2 (Slices 2–9) payload gains critique = null without losing data', () => {
    // A full v2 contest minus the field #23 added: strip `critique` from the envelope.
    const full = withSchool(contest({ districtNumber: '20' }), 0, { name: 'Westlake HS' });
    const { critique: _dropped, speechwire: _dev, ...v2Contest } = full;
    const v2 = JSON.stringify({ schemaVersion: 2, contest: v2Contest });

    const migrated = parseContest(v2);
    expect(migrated.critique).toBeNull();
    expect(migrated.schools[0].name).toBe('Westlake HS'); // pre-existing data preserved
    expect(migrated.identity.districtNumber).toBe('20');
    expect(JSON.parse(serializeContest(migrated)).schemaVersion).toBe(CONTEST_SCHEMA_VERSION);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseContest('not json')).toThrow(/not valid JSON/);
  });

  it('rejects payloads without a schemaVersion', () => {
    expect(() => parseContest(JSON.stringify({ contest: contest() }))).toThrow(/schemaVersion/);
  });

  it('rejects payloads from a newer schema version', () => {
    const future = JSON.stringify({ schemaVersion: CONTEST_SCHEMA_VERSION + 1, contest: contest() });
    expect(() => parseContest(future)).toThrow(/newer/);
  });

  it('rejects a malformed contest record', () => {
    expect(() =>
      parseContest(JSON.stringify({ schemaVersion: CONTEST_SCHEMA_VERSION, contest: { nope: true } })),
    ).toThrow(/malformed/);
  });
});

describe('contestFileName', () => {
  it('is the display name plus the contest-file suffix', () => {
    expect(contestFileName(contest({ districtNumber: '20' }).identity)).toBe(
      '2026 — 5A District 20 OAP — Contest File.json',
    );
  });
});

describe('generationWarnings', () => {
  /** A contest with every field the pre-flight checks look at filled in. */
  function ready(): Contest {
    const c = contest({ hostSchoolName: 'Friendswood HS' });
    return withDetails(c, {
      contestDate: '2026-03-15',
      directorsMeetingTime: '10:00 AM',
      firstShowTime: '11:00 AM',
    });
  }

  it('returns nothing when the contest is ready to generate', () => {
    expect(generationWarnings(ready())).toEqual([]);
  });

  it('warns about each missing field, matching v12 wording', () => {
    // A default contest has blank date/host/meeting/first-show but unique orders.
    expect(generationWarnings(contest())).toEqual([
      'Contest Date is not set.',
      'Host School Name is blank.',
      'Directors Meeting Time is not set.',
      'First Show / Setup Time is not set — Contest Day Schedule will be empty.',
    ]);
  });

  it("treats a 'TBD' directors meeting time as not set (v12)", () => {
    const c = withDetails(ready(), { directorsMeetingTime: 'TBD' });
    expect(generationWarnings(c)).toContain('Directors Meeting Time is not set.');
  });

  it('warns about duplicate performance orders', () => {
    const c = withSchool(ready(), 1, { performanceOrder: 1 }); // school 0 is also order 1
    expect(generationWarnings(c)).toContain(
      'Two or more schools share the same performance order number — check Play Titles & Order.',
    );
  });
});

/** A fully-filled contest to exercise import round-trips and the duplicate policy. */
function filledContest(): Contest {
  let c = contest({ districtNumber: '20', hostSchoolName: 'Friendswood High School' });
  c = withCmInfo(c, { techContact: 'Brian Hamlin' });
  c = withDetails(c, {
    contestDate: '2026-04-10',
    directorsMeetingTime: '10:00 AM',
    firstShowTime: '11:00 AM',
    critiqueFormat: 'after_each',
    numJudges: 2,
    rehearsalDate1: '2026-04-08',
    rehearsalDate2: '2026-04-09',
    entryFee: '50',
    admissionFee: '10',
    bidcContestDate: '2026-04-20',
  });
  c = withAdjudicator(c, 0, { name: 'Jane Judge', mailingAddress: '1 Main St', needsHotel: true });
  c = withSchool(c, 0, { name: 'Westlake HS', playTitle: 'Our Town', performanceOrder: 3 });
  c = withSchool(c, 1, { name: 'Anderson HS', playTitle: 'Proof', performanceOrder: 1 });
  c = addDirector(c, 0);
  c = withDirector(c, 0, 0, { name: 'Pat Director', email: 'pat@x.org' });
  c = withSpeechwire(c, { username: 'district20-5a', password: 's3cr3t' });
  return c;
}

describe('importContest', () => {
  it('imports a contest file as a NEW record: fresh id/timestamps, data identical (minus device-only)', () => {
    const source = filledContest();
    const json = serializeContest(source);
    const imported = importContest(json, { id: 'imported-id', now: LATER });

    expect(imported.id).toBe('imported-id');
    expect(imported.createdAt).toBe(LATER);
    expect(imported.updatedAt).toBe(LATER);
    // Everything else matches the exported contest, credentials excluded.
    expect(imported).toEqual({
      ...source,
      id: 'imported-id',
      createdAt: LATER,
      updatedAt: LATER,
      speechwire: { username: '', password: '' },
    });
  });

  it('device-only Speechwire credentials never travel through a contest file', () => {
    const json = serializeContest(filledContest());
    expect(json).not.toContain('s3cr3t');
    expect(importContest(json).speechwire).toEqual({ username: '', password: '' });
  });

  it('assigns a unique id and current timestamp when no options are given', () => {
    const json = serializeContest(contest());
    const a = importContest(json);
    const b = importContest(json);
    expect(a.id).not.toBe(b.id);
    expect(a.createdAt).toBe(a.updatedAt); // brand-new record
  });

  it('MIGRATION ON IMPORT: an older-schema (v1) file migrates forward and gets a fresh identity', () => {
    // A Slice-1 contest file (schema v1 had only id/timestamps/identity).
    const v1File = JSON.stringify({
      schemaVersion: 1,
      contest: {
        id: 'old-id',
        createdAt: NOW,
        updatedAt: NOW,
        identity: contest({ districtNumber: '20', hostSchoolName: 'Friendswood HS' }).identity,
      },
    });
    const imported = importContest(v1File, { id: 'fresh-id', now: LATER });

    expect(imported.id).toBe('fresh-id'); // not the file's old id
    expect(imported.createdAt).toBe(LATER);
    expect(imported.identity.districtNumber).toBe('20'); // existing data preserved
    // Sections the old file lacked are filled from defaults by the migration.
    expect(imported.details).toEqual(contest().details);
    expect(imported.schools).toHaveLength(DEFAULT_SCHOOLS);
    expect(imported.documents).toEqual(defaultDocumentSelection());
    // and it re-serializes at the current schema version.
    expect(JSON.parse(serializeContest(imported)).schemaVersion).toBe(CONTEST_SCHEMA_VERSION);
  });

  it('rejects garbage with a friendly error rather than crashing', () => {
    expect(() => importContest('not json at all')).toThrow(/not valid JSON/);
    expect(() => importContest('{}')).toThrow(/schemaVersion/);
    expect(() =>
      importContest(JSON.stringify({ schemaVersion: CONTEST_SCHEMA_VERSION, contest: { nope: true } })),
    ).toThrow(/malformed/);
  });
});

describe('duplicateContest (roll-forward)', () => {
  it('assigns a new id and timestamps, leaving the source untouched', () => {
    const source = filledContest();
    const dup = duplicateContest(source, { id: 'dup-id', now: LATER });
    expect(dup.id).toBe('dup-id');
    expect(dup.createdAt).toBe(LATER);
    expect(dup.updatedAt).toBe(LATER);
    expect(source.id).toBe('test-id'); // original unchanged
    expect(source.details.contestDate).toBe('2026-04-10');
    expect(duplicateContest(source).id).not.toBe(duplicateContest(source).id);
  });

  it('KEEPS stable, year-over-year data', () => {
    const source = filledContest();
    const dup = duplicateContest(source);
    // Identity (level/classification/district/host) and CM info carry forward.
    expect(dup.identity).toEqual(source.identity);
    expect(dup.cmInfo).toEqual(source.cmInfo);
    // School names + directors carry forward.
    expect(dup.schools.map((s) => s.name)).toEqual(source.schools.map((s) => s.name));
    expect(dup.schools[0].directors).toEqual(source.schools[0].directors);
    // Stable detail settings and document selection carry forward.
    expect(dup.details.critiqueFormat).toBe('after_each');
    expect(dup.details.numJudges).toBe(2);
    expect(dup.details.entryFee).toBe('50');
    expect(dup.details.admissionFee).toBe('10');
    expect(dup.documents).toEqual(source.documents);
  });

  it('CLEARS per-season dates, deadlines, and meeting/show times', () => {
    const dup = duplicateContest(filledContest());
    expect(dup.details.contestDate).toBe('');
    expect(dup.details.directorsMeetingTime).toBe('');
    expect(dup.details.firstShowTime).toBe('');
    expect(dup.details.rehearsalDate1).toBe('');
    expect(dup.details.rehearsalDate2).toBe('');
    expect(dup.details.entrySystemDeadline).toBe('');
    expect(dup.details.lightCueDeadlineDate).toBe('');
    expect(dup.details.bidcContestDate).toBe('');
  });

  it('CLEARS judges, play titles, performance order, and device-only credentials', () => {
    const dup = duplicateContest(filledContest());
    expect(dup.adjudicators).toEqual(defaultAdjudicators());
    expect(dup.schools.map((s) => s.playTitle)).toEqual(['', '', '', '', '', '']);
    expect(dup.schools.map((s) => s.performanceOrder)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(dup.speechwire).toEqual({ username: '', password: '' });
  });

  it('deep-copies directors so editing the duplicate never touches the source', () => {
    const source = filledContest();
    const dup = duplicateContest(source);
    const edited = withDirector(dup, 0, 0, { name: 'Changed' });
    expect(source.schools[0].directors[0].name).toBe('Pat Director');
    expect(edited.schools[0].directors[0].name).toBe('Changed');
  });

  it('a duplicated contest is schema-valid and round-trips through serialize/parse', () => {
    const dup = duplicateContest(filledContest(), { id: 'dup-id', now: LATER });
    expect(validateContest(dup)).toEqual([]);
    expect(parseContest(serializeContest(dup))).toEqual({
      ...dup,
      speechwire: { username: '', password: '' },
    });
  });
});

/* ────────────────────────── compliance tracker (PRD #64) ────────────────────────── */

describe('compliance model foundation', () => {
  it('encodes the 8 fixed handbook items with stable ids', () => {
    expect(BUILT_IN_COMPLIANCE_ITEMS).toHaveLength(8);
    expect(BUILT_IN_COMPLIANCE_ITEMS.map((i) => i.id)).toEqual([
      'community_standards',
      'performance_license',
      'royalty_payment',
      'cutting_permission',
      'play_approval',
      'scenic_approval',
      'online_entry',
      'title_registration',
    ]);
  });

  it('a new contest starts with an empty tracker (no custom items, blank school maps)', () => {
    const c = contest();
    expect(c.customComplianceItems).toEqual([]);
    expect(c.schools.every((s) => Object.keys(s.compliance).length === 0)).toBe(true);
    expect(complianceItems(c)).toEqual([...BUILT_IN_COMPLIANCE_ITEMS]);
  });

  describe('complianceProgress derivation', () => {
    const c = contest();
    const items = complianceItems(c); // 8 built-ins

    it('all pending ⇒ red, 0/8', () => {
      const p = complianceProgress(c.schools[0], items);
      expect(p).toEqual({ done: 0, applicable: 8, color: 'red' });
    });

    it('mixed (some received, rest pending) ⇒ yellow', () => {
      let c2 = setComplianceStatus(c, 0, 'community_standards', 'received');
      c2 = setComplianceStatus(c2, 0, 'performance_license', 'received');
      expect(complianceProgress(c2.schools[0], items)).toEqual({ done: 2, applicable: 8, color: 'yellow' });
    });

    it('every applicable item received ⇒ green', () => {
      let c2 = c;
      for (const item of BUILT_IN_COMPLIANCE_ITEMS) {
        c2 = setComplianceStatus(c2, 0, item.id, 'received');
      }
      expect(complianceProgress(c2.schools[0], items)).toEqual({ done: 8, applicable: 8, color: 'green' });
    });

    it('all items N/A ⇒ green 0/0 (nothing to collect)', () => {
      let c2 = c;
      for (const item of BUILT_IN_COMPLIANCE_ITEMS) {
        c2 = setComplianceStatus(c2, 0, item.id, 'na');
      }
      expect(complianceProgress(c2.schools[0], items)).toEqual({ done: 0, applicable: 0, color: 'green' });
    });

    it('mixed N/A: N/A items drop out of the denominator', () => {
      // 2 N/A, 3 received, 3 pending ⇒ applicable 6, done 3, yellow.
      let c2 = c;
      c2 = setComplianceStatus(c2, 0, 'cutting_permission', 'na');
      c2 = setComplianceStatus(c2, 0, 'play_approval', 'na');
      c2 = setComplianceStatus(c2, 0, 'community_standards', 'received');
      c2 = setComplianceStatus(c2, 0, 'performance_license', 'received');
      c2 = setComplianceStatus(c2, 0, 'royalty_payment', 'received');
      expect(complianceProgress(c2.schools[0], items)).toEqual({ done: 3, applicable: 6, color: 'yellow' });
    });

    it('N/A everything except one received item ⇒ green (all applicable resolved)', () => {
      let c2 = c;
      for (const item of BUILT_IN_COMPLIANCE_ITEMS) {
        c2 = setComplianceStatus(c2, 0, item.id, 'na');
      }
      c2 = setComplianceStatus(c2, 0, 'title_registration', 'received');
      expect(complianceProgress(c2.schools[0], items)).toEqual({ done: 1, applicable: 1, color: 'green' });
    });

    it('counts custom items alongside built-ins', () => {
      let c2 = addComplianceItem(c, { id: 'custom-1', label: 'Proof of insurance' });
      const items2 = complianceItems(c2);
      expect(items2).toHaveLength(9);
      c2 = setComplianceStatus(c2, 0, 'custom-1', 'received');
      expect(complianceProgress(c2.schools[0], items2)).toEqual({ done: 1, applicable: 9, color: 'yellow' });
    });
  });

  describe('setComplianceStatus', () => {
    it('is immutable and bumps updatedAt', () => {
      const c = contest();
      const next = setComplianceStatus(c, 0, 'royalty_payment', 'received', LATER);
      expect(next).not.toBe(c);
      expect(c.schools[0].compliance).toEqual({}); // source untouched
      expect(next.schools[0].compliance).toEqual({ royalty_payment: 'received' });
      expect(next.updatedAt).toBe(LATER);
    });

    it("writing 'pending' drops the key so an untouched item serializes to nothing", () => {
      let c = setComplianceStatus(contest(), 0, 'royalty_payment', 'received');
      c = setComplianceStatus(c, 0, 'royalty_payment', 'pending');
      expect(c.schools[0].compliance).toEqual({});
    });

    it('only touches the targeted school', () => {
      const c = setComplianceStatus(contest(), 1, 'online_entry', 'na');
      expect(c.schools[1].compliance).toEqual({ online_entry: 'na' });
      expect(c.schools[0].compliance).toEqual({});
    });

    it('out-of-range school index is a no-op', () => {
      const c = contest();
      expect(setComplianceStatus(c, 99, 'online_entry', 'received')).toBe(c);
      expect(setComplianceStatus(c, -1, 'online_entry', 'received')).toBe(c);
    });
  });

  describe('add / remove custom items', () => {
    it('a custom item applies to every school (defined once)', () => {
      const c = addComplianceItem(contest(), { id: 'ins', label: 'Proof of insurance' }, LATER);
      expect(c.customComplianceItems).toEqual([{ id: 'ins', label: 'Proof of insurance' }]);
      expect(c.updatedAt).toBe(LATER);
      // Every school can hold a status for it, all starting Pending (absent).
      const items = complianceItems(c);
      expect(c.schools.every((s) => complianceProgress(s, items).applicable === 9)).toBe(true);
    });

    it('removing a custom item drops its status from every school', () => {
      let c = addComplianceItem(contest(), { id: 'ins', label: 'Proof of insurance' });
      c = setComplianceStatus(c, 0, 'ins', 'received');
      c = setComplianceStatus(c, 2, 'ins', 'na');
      c = removeComplianceItem(c, 'ins', LATER);
      expect(c.customComplianceItems).toEqual([]);
      expect(c.schools[0].compliance).toEqual({});
      expect(c.schools[2].compliance).toEqual({});
      expect(c.updatedAt).toBe(LATER);
    });

    it('removing preserves other items and other custom items', () => {
      let c = addComplianceItem(contest(), { id: 'a', label: 'A' });
      c = addComplianceItem(c, { id: 'b', label: 'B' });
      c = setComplianceStatus(c, 0, 'community_standards', 'received');
      c = setComplianceStatus(c, 0, 'a', 'received');
      c = removeComplianceItem(c, 'a');
      expect(c.customComplianceItems).toEqual([{ id: 'b', label: 'B' }]);
      expect(c.schools[0].compliance).toEqual({ community_standards: 'received' });
    });

    it('removing a non-custom / unknown id is a no-op', () => {
      const c = addComplianceItem(contest(), { id: 'a', label: 'A' });
      expect(removeComplianceItem(c, 'community_standards')).toBe(c); // built-in, not removable
      expect(removeComplianceItem(c, 'nope')).toBe(c);
    });
  });

  it('compliance state is keyed to the school, surviving reordering and school-count changes', () => {
    let c = contest();
    c = setComplianceStatus(c, 0, 'community_standards', 'received');
    c = setComplianceStatus(c, 1, 'online_entry', 'na');
    // Rename school 0 — its status stays put (keyed to the school record).
    c = withSchool(c, 0, { name: 'Renamed HS' });
    expect(c.schools[0].compliance).toEqual({ community_standards: 'received' });
    // Grow then shrink back — surviving schools keep their state.
    const grown = setNumSchools(c, MAX_SCHOOLS);
    expect(grown.schools[0].compliance).toEqual({ community_standards: 'received' });
    expect(grown.schools[1].compliance).toEqual({ online_entry: 'na' });
    const shrunk = setNumSchools(grown, 4);
    expect(shrunk.schools[0].compliance).toEqual({ community_standards: 'received' });
    expect(shrunk.schools[1].compliance).toEqual({ online_entry: 'na' });
  });

  it('round-trips through serialize/parse, including custom items and statuses', () => {
    let c = contest();
    c = addComplianceItem(c, { id: 'ins', label: 'Proof of insurance' });
    c = setComplianceStatus(c, 0, 'community_standards', 'received');
    c = setComplianceStatus(c, 0, 'ins', 'na');
    const back = parseContest(serializeContest(c));
    expect(back.customComplianceItems).toEqual([{ id: 'ins', label: 'Proof of insurance' }]);
    expect(back.schools[0].compliance).toEqual({ community_standards: 'received', ins: 'na' });
  });

  it('duplicateContest carries custom item DEFINITIONS but clears every school status', () => {
    let source = filledContest();
    source = addComplianceItem(source, { id: 'ins', label: 'Proof of insurance' });
    source = setComplianceStatus(source, 0, 'community_standards', 'received');
    source = setComplianceStatus(source, 0, 'ins', 'received');
    const dup = duplicateContest(source, { id: 'dup-id', now: LATER });
    expect(dup.customComplianceItems).toEqual([{ id: 'ins', label: 'Proof of insurance' }]);
    expect(dup.schools.every((s) => Object.keys(s.compliance).length === 0)).toBe(true);
    // Source untouched.
    expect(source.schools[0].compliance).toEqual({ community_standards: 'received', ins: 'received' });
  });
});

describe('v3 → v4 migration (compliance tracker)', () => {
  it('migrates a pre-compliance (v3) payload to an all-Pending tracker', () => {
    const v3Contest = {
      ...contest({ districtNumber: '20' }),
      schools: [
        { name: 'Westlake HS', directors: [{ name: 'Pat', email: 'pat@x.org' }], playTitle: 'Our Town', performanceOrder: 1 },
        { name: 'Anderson HS', directors: [{ name: '', email: '' }], playTitle: '', performanceOrder: 2 },
      ],
    };
    // Strip the fields v3 didn't have so the fixture is honest.
    delete (v3Contest as Record<string, unknown>).customComplianceItems;
    const v3 = JSON.stringify({ schemaVersion: 3, contest: v3Contest });

    const migrated = parseContest(v3);
    expect(migrated.customComplianceItems).toEqual([]);
    expect(migrated.schools.map((s) => s.compliance)).toEqual([{}, {}]);
    expect(migrated.schools[0].name).toBe('Westlake HS'); // pre-existing data preserved
    expect(migrated.identity.districtNumber).toBe('20');
    // A migrated contest reads as all-Pending and re-serializes at the new version.
    expect(complianceProgress(migrated.schools[0], complianceItems(migrated)).color).toBe('red');
    expect(JSON.parse(serializeContest(migrated)).schemaVersion).toBe(CONTEST_SCHEMA_VERSION);
  });
});

describe('v4 → v5 migration (performance-order draw)', () => {
  it('migrates a pre-draw (v4) payload to no draw record, order fully editable', () => {
    // A full current contest minus the field #78 added: strip `draw` from the envelope.
    const { draw: _dropped, speechwire: _dev, ...v4Contest } = filledContest();
    const v4 = JSON.stringify({ schemaVersion: 4, contest: v4Contest });

    const migrated = parseContest(v4);
    expect(migrated.draw).toBeNull(); // no draw ⇒ order stays hand-editable
    // Pre-existing data (including the hand-entered performance order) is preserved.
    expect(migrated.schools[0].name).toBe('Westlake HS');
    expect(migrated.schools[0].performanceOrder).toBe(3);
    expect(migrated.identity.districtNumber).toBe('20');
    expect(JSON.parse(serializeContest(migrated)).schemaVersion).toBe(CONTEST_SCHEMA_VERSION);
  });
});

describe('advanceContest', () => {
  /** filledContest + recorded results: idx1 & idx0 advance, idx2 is the alternate. */
  function advancing(): Contest {
    let c = filledContest();
    c = setAdvancing(c, [1, 0]); // Anderson (idx1) 1st, Westlake (idx0) 2nd (rank order)
    c = setAlternate(c, 2);
    c = withNextContest(c, {
      date: '2026-04-25',
      location: 'Region Venue',
      cmName: 'Next Manager',
      cmEmail: 'next@x.org',
      cmPhone: '555-0000',
    });
    return c;
  }

  it('bumps the level one step via NEXT_CONTEST_LEVEL', () => {
    expect(nextContestLevel('Zone')).toBe('District');
    expect(nextContestLevel('District')).toBe('BiDistrict');
    expect(nextContestLevel('BiDistrict')).toBe('Area');
    expect(nextContestLevel('Area')).toBe('Region');
    expect(nextContestLevel('Region')).toBeNull();
    const adv = advanceContest(advancing(), { id: 'adv', now: LATER })!;
    expect(adv.identity.contestLevel).toBe('BiDistrict'); // District → BiDistrict
  });

  it('is unavailable (returns null) at Region — no managed next level', () => {
    const region = withIdentity(advancing(), { contestLevel: 'Region' });
    expect(canAdvanceContest(region)).toBe(false);
    expect(advanceContest(region)).toBeNull();
    expect(canAdvanceContest(advancing())).toBe(true);
  });

  it('carries ONLY advancing companies (play title + directors kept, order reset, alternate excluded)', () => {
    const adv = advanceContest(advancing(), { id: 'adv', now: LATER })!;
    expect(adv.schools).toHaveLength(2);
    // Carried in school FORM order (idx0, idx1), not advancing/rank order.
    expect(adv.schools.map((s) => s.name)).toEqual(['Westlake HS', 'Anderson HS']);
    expect(adv.schools.map((s) => s.playTitle)).toEqual(['Our Town', 'Proof']); // shows kept
    expect(adv.schools.map((s) => s.performanceOrder)).toEqual([1, 2]); // reset
    expect(adv.schools[0].directors).toEqual(filledContest().schools[0].directors); // directors kept
    expect(adv.schools[0].compliance).toEqual({}); // last year's paperwork dropped
    // The alternate (idx2) and every non-advancing school are gone.
    expect(adv.schools.some((s) => s.name === 'School 3')).toBe(false);
  });

  it('carries no schools when no results were recorded', () => {
    const adv = advanceContest(filledContest(), { id: 'adv' })!;
    expect(adv.schools).toEqual([]);
  });

  it('drops stale advancing indices (schools removed after recording)', () => {
    let c = filledContest();
    c = setAdvancing(c, [0, 1, 5]); // idx5 advances
    c = setNumSchools(c, 3); // idx5 no longer exists
    const adv = advanceContest(c, { id: 'adv' })!;
    expect(adv.schools.map((s) => s.name)).toEqual(['Westlake HS', 'Anderson HS']); // idx5 dropped
  });

  it('clears season data and next-level info; identity keeps classification + year, clears host/district', () => {
    const src = advancing();
    const adv = advanceContest(src, { id: 'adv', now: LATER, seedFromNextContest: false })!;
    // Identity carry vs clear.
    expect(adv.identity.classification).toBe(src.identity.classification);
    expect(adv.identity.contestYear).toBe(src.identity.contestYear);
    expect(adv.identity.districtNumber).toBe('');
    expect(adv.identity.hostSchoolName).toBe('');
    expect(adv.identity.hostVenueName).toBe('');
    expect(adv.identity.hostAddress).toBe('');
    // Judges / critique / draw / results / next-level / credentials cleared.
    expect(adv.adjudicators).toEqual(defaultAdjudicators());
    expect(adv.critique).toBeNull();
    expect(adv.draw).toBeNull();
    expect(adv.results).toBeNull();
    expect(adv.nextContest).toEqual(defaultNextContest());
    expect(adv.speechwire).toEqual({ username: '', password: '' });
    // Season detail fields cleared; the CM's own info carried (no seeding).
    expect(adv.details.contestDate).toBe('');
    expect(adv.details.directorsMeetingTime).toBe('');
    expect(adv.details.firstShowTime).toBe('');
    expect(adv.details.rehearsalDate1).toBe('');
    expect(adv.details.rehearsalDate2).toBe('');
    expect(adv.details.entrySystemDeadline).toBe('');
    expect(adv.cmInfo).toEqual(src.cmInfo);
    // Stable settings carry (like duplicateContest).
    expect(adv.details.critiqueFormat).toBe(src.details.critiqueFormat);
    expect(adv.details.numJudges).toBe(src.details.numJudges);
    expect(adv.details.entryFee).toBe(src.details.entryFee);
    expect(adv.documents).toEqual(src.documents);
  });

  it('pre-seeds date / location / next-CM from nextContest when present (default)', () => {
    const adv = advanceContest(advancing(), { id: 'adv', now: LATER })!;
    expect(adv.details.contestDate).toBe('2026-04-25');
    expect(adv.identity.hostVenueName).toBe('Region Venue');
    expect(adv.cmInfo.name).toBe('Next Manager');
    expect(adv.cmInfo.email).toBe('next@x.org');
    expect(adv.cmInfo.phone).toBe('555-0000');
    // Other CM fields still carry from the source (only name/email/phone seeded).
    expect(adv.cmInfo.mailingAddress).toBe(filledContest().cmInfo.mailingAddress);
  });

  it('honors identity carry-forward overrides, and they win over nextContest seeding', () => {
    const adv = advanceContest(advancing(), {
      id: 'adv',
      identity: { hostSchoolName: 'Carried Host', districtNumber: '5', hostVenueName: 'Explicit Venue' },
    })!;
    expect(adv.identity.hostSchoolName).toBe('Carried Host');
    expect(adv.identity.districtNumber).toBe('5');
    expect(adv.identity.hostVenueName).toBe('Explicit Venue'); // override beats the seeded location
    expect(adv.identity.contestLevel).toBe('BiDistrict'); // still bumped
  });

  it('is non-destructive: new id/timestamps, source untouched', () => {
    const src = advancing();
    const before = JSON.stringify(src);
    const adv = advanceContest(src, { id: 'adv', now: LATER })!;
    expect(adv.id).toBe('adv');
    expect(adv.createdAt).toBe(LATER);
    expect(adv.updatedAt).toBe(LATER);
    expect(adv.id).not.toBe(src.id);
    expect(JSON.stringify(src)).toBe(before); // source contest is unchanged
  });
});

/* ────────────────────────── results & advancement (PRD #66) ────────────────────────── */

describe('results & next-level defaults', () => {
  it('a new contest has no results and a blank next-level block', () => {
    const c = contest();
    expect(c.results).toBeNull();
    expect(c.nextContest).toEqual({ date: '', location: '', cmName: '', cmEmail: '', cmPhone: '' });
    expect(c.nextContest).toEqual(defaultNextContest());
  });
});

describe('advancingPlaceCount', () => {
  it('is 3 at every level except Region', () => {
    expect(advancingPlaceCount('Zone')).toBe(3);
    expect(advancingPlaceCount('District')).toBe(3);
    expect(advancingPlaceCount('BiDistrict')).toBe(3);
    expect(advancingPlaceCount('Area')).toBe(3);
  });

  it('is 2 at Region (which advances to a two-company State field)', () => {
    expect(advancingPlaceCount('Region')).toBe(2);
  });
});

describe('setAdvancing', () => {
  it('stores the advancing indices in rank order and materializes the record', () => {
    const c = setAdvancing(contest(), [4, 1, 2], NOW);
    expect(c.results?.advancing).toEqual([4, 1, 2]); // slot 0 = 1st, rank preserved
    expect(c.updatedAt).toBe(NOW);
  });

  it('truncates to advancingPlaceCount — 3 normally, 2 at Region', () => {
    expect(setAdvancing(contest(), [0, 1, 2, 3]).results?.advancing).toEqual([0, 1, 2]);
    const region = setAdvancing(contest({ contestLevel: 'Region' }), [0, 1, 2, 3]);
    expect(region.results?.advancing).toEqual([0, 1]);
  });

  it('is immutable and does not touch the source contest', () => {
    const before = contest();
    const after = setAdvancing(before, [1, 0]);
    expect(before.results).toBeNull();
    expect(after).not.toBe(before);
  });
});

describe('setAlternate / setBestCrew', () => {
  it('records and clears the alternate', () => {
    const withAlt = setAlternate(contest(), 3, NOW);
    expect(withAlt.results?.alternate).toBe(3);
    expect(setAlternate(withAlt, null).results?.alternate).toBeNull();
  });

  it('records and clears Best Crew', () => {
    const withCrew = setBestCrew(contest(), 2);
    expect(withCrew.results?.bestCrew).toBe(2);
    expect(setBestCrew(withCrew, null).results?.bestCrew).toBeNull();
  });
});

describe('addAwardWinner / removeAwardWinner cap enforcement', () => {
  it('appends Best Performers up to the cap (2), then adds are no-ops', () => {
    let c = contest();
    c = addAwardWinner(c, 'bestPerformers', { studentName: 'A', schoolIndex: 0 });
    c = addAwardWinner(c, 'bestPerformers', { studentName: 'B', schoolIndex: 1 });
    expect(c.results?.bestPerformers).toHaveLength(MAX_BEST_PERFORMERS);
    const capped = addAwardWinner(c, 'bestPerformers', { studentName: 'C', schoolIndex: 2 });
    expect(capped).toBe(c); // add past the cap is a no-op — same reference, no updatedAt bump
    expect(capped.results?.bestPerformers).toHaveLength(2);
  });

  it('caps All-Star Cast at 8 and Honorable Mention at 8', () => {
    const fill = (category: 'allStarCast' | 'honorableMention', cap: number) => {
      let c = contest();
      for (let i = 0; i < cap + 3; i++) {
        c = addAwardWinner(c, category, { studentName: `S${i}`, schoolIndex: i % 6 });
      }
      return c.results?.[category];
    };
    expect(fill('allStarCast', MAX_ALL_STAR_CAST)).toHaveLength(8);
    expect(fill('honorableMention', MAX_HONORABLE_MENTION)).toHaveLength(8);
  });

  it('removes by index and no-ops on an out-of-range index', () => {
    let c = contest();
    c = addAwardWinner(c, 'allStarCast', { studentName: 'A', schoolIndex: 0 });
    c = addAwardWinner(c, 'allStarCast', { studentName: 'B', schoolIndex: 1 });
    const removed = removeAwardWinner(c, 'allStarCast', 0);
    expect(removed.results?.allStarCast).toEqual([{ studentName: 'B', schoolIndex: 1 }]);
    expect(removeAwardWinner(c, 'allStarCast', 5)).toBe(c); // no-op
  });

  it('bumps updatedAt on a real add and leaves the source untouched', () => {
    const before = contest();
    const after = addAwardWinner(before, 'bestPerformers', { studentName: 'A', schoolIndex: 0 }, LATER);
    expect(after.updatedAt).toBe(LATER);
    expect(before.results).toBeNull();
  });
});

describe('Outstanding Technician (one per school)', () => {
  it('records one technician per school and UPDATES rather than duplicating for the same school', () => {
    let c = contest();
    c = setOutstandingTechnician(c, 0, 'Alex');
    c = setOutstandingTechnician(c, 1, 'Bailey');
    expect(c.results?.outstandingTechnicians).toHaveLength(2);
    // A second set for school 0 overwrites the name — still one entry per school.
    c = setOutstandingTechnician(c, 0, 'Casey');
    expect(c.results?.outstandingTechnicians).toEqual([
      { studentName: 'Casey', schoolIndex: 0 },
      { studentName: 'Bailey', schoolIndex: 1 },
    ]);
  });

  it('removes a school technician and no-ops when the school has none', () => {
    let c = setOutstandingTechnician(contest(), 2, 'Drew');
    expect(removeOutstandingTechnician(c, 2).results?.outstandingTechnicians).toEqual([]);
    expect(removeOutstandingTechnician(c, 5)).toBe(c); // school 5 has no technician ⇒ no-op
  });
});

describe('clearResults / withNextContest', () => {
  it('clears a recorded results block back to null and no-ops when already null', () => {
    const withResults = setAdvancing(contest(), [0, 1, 2]);
    expect(clearResults(withResults, LATER).results).toBeNull();
    const blank = contest();
    expect(clearResults(blank)).toBe(blank); // already null ⇒ no-op
  });

  it('patches the next-level info block and bumps updatedAt', () => {
    const c = withNextContest(contest(), { location: 'Region HS', cmName: 'Sam Manager' }, LATER);
    expect(c.nextContest).toEqual({
      date: '',
      location: 'Region HS',
      cmName: 'Sam Manager',
      cmEmail: '',
      cmPhone: '',
    });
    expect(c.updatedAt).toBe(LATER);
  });
});

describe('duplicateContest clears results & next-level info', () => {
  it('a roll-forward starts with nothing recorded and a blank next-level block', () => {
    let source = setAdvancing(filledContest(), [1, 0]);
    source = setOutstandingTechnician(source, 0, 'Alex');
    source = withNextContest(source, { location: 'Region HS' });
    const dup = duplicateContest(source, { id: 'dup', now: LATER });
    expect(dup.results).toBeNull();
    expect(dup.nextContest).toEqual(defaultNextContest());
  });
});

describe('results serialization round-trip', () => {
  it('preserves the results record and next-level info through serialize → parse', () => {
    let c = filledContest();
    c = setAdvancing(c, [1, 0]);
    c = setAlternate(c, 3);
    c = addAwardWinner(c, 'bestPerformers', { studentName: 'Alex', schoolIndex: 1 });
    c = setOutstandingTechnician(c, 0, 'Bailey');
    c = setBestCrew(c, 1);
    c = withNextContest(c, { date: '2026-04-20', location: 'Region HS', cmName: 'Sam' });

    const restored = parseContest(serializeContest(c));
    expect(restored.results).toEqual(c.results);
    expect(restored.nextContest).toEqual(c.nextContest);
  });
});

describe('v5 → v6 migration (results & advancement)', () => {
  it('migrates a pre-results (v5) payload to no results and a blank next-level block', () => {
    // A full current contest minus the fields #81 added: strip results/nextContest.
    const { results: _r, nextContest: _n, speechwire: _dev, ...v5Contest } = filledContest();
    const v5 = JSON.stringify({ schemaVersion: 5, contest: v5Contest });

    const migrated = parseContest(v5);
    expect(migrated.results).toBeNull();
    expect(migrated.nextContest).toEqual(defaultNextContest());
    // Pre-existing data is preserved and it re-serializes at the current version.
    expect(migrated.schools[0].name).toBe('Westlake HS');
    expect(migrated.identity.districtNumber).toBe('20');
    expect(JSON.parse(serializeContest(migrated)).schemaVersion).toBe(CONTEST_SCHEMA_VERSION);
  });
});

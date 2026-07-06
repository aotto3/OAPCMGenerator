import { describe, expect, it } from 'vitest';
import {
  CONTEST_SCHEMA_VERSION,
  DEFAULT_JUDGES,
  DEFAULT_SCHOOLS,
  DOCUMENT_TYPES,
  MAX_SCHOOLS,
  MIN_SCHOOLS,
  addDirector,
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
  numSchools,
  parseContest,
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

const NOW = '2026-07-05T12:00:00.000Z';
const LATER = '2026-07-06T00:00:00.000Z';

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

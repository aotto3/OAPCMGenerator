import { describe, expect, it } from 'vitest';
import { MAX_JUDGES, createContest, defaultAdjudicators, withDetails, type Adjudicator, type Contest } from './contest';
import {
  JUDGE_FIELD_SCOPE,
  activeJudgeSlots,
  activeJudges,
  hasJudgeData,
  judgeForOtherContest,
  normalizeEmail,
  setJudge,
} from './judgePanel';
import { addAsJudge } from './judgePreferences';
import { applySubmissions, blankAnswers, type JudgeSubmission } from '../questionnaire/submission';

const NOW = '2026-11-01T12:00:00.000Z';
const LATER = '2026-11-20T12:00:00.000Z';
const STAMP = '2026-11-05T00:00:00.000Z';

const BLANK: Adjudicator = defaultAdjudicators()[0];

/** A judge with every field set to something other than its blank value. */
const FULL: Adjudicator = {
  name: 'Jane Judge',
  email: 'jane@x.org',
  mailingAddress: '1 Main St',
  cellPhone: '512-555-0100',
  needsPower: true,
  dietary: 'vegetarian',
  bio: 'A bio',
  judgeNotes: 'Arriving late',
  needsHotel: true,
  hotelNights: { before: true, after: true },
  requestingFlight: true,
  ttaoContractDate: '2026-10-01',
  paymentPaperworkSentDate: '2026-10-02',
  paymentPaperworkReturnedDate: '2026-10-03',
  questionnaireUpdatedAt: STAMP,
};

function named(numJudges: number): Contest {
  let c = createContest({ id: 'c1', now: NOW });
  for (let i = 0; i < MAX_JUDGES; i++) c = setJudge(c, i, { name: `Judge ${i + 1}` }, NOW);
  return withDetails(c, { numJudges }, NOW);
}

describe('activeJudges', () => {
  for (let n = 1; n <= MAX_JUDGES; n++) {
    it(`returns the first ${n} slot(s) when the count is ${n}, keeping stored slots beyond it out`, () => {
      const c = named(n);
      expect(c.adjudicators).toHaveLength(MAX_JUDGES);
      expect(activeJudges(c).map((j) => j.name)).toEqual(
        Array.from({ length: n }, (_, i) => `Judge ${i + 1}`),
      );
      expect(activeJudgeSlots(c).map((s) => [s.index, s.judge.name])).toEqual(
        Array.from({ length: n }, (_, i) => [i, `Judge ${i + 1}`]),
      );
    });
  }
});

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  Jane@X.Org ')).toBe('jane@x.org');
  });
});

describe('setJudge', () => {
  const stamped = (): Contest => setJudge(createContest({ id: 'c1', now: NOW }), 0, FULL, NOW);

  it('changing the email clears the stamp and keeps every typed field', () => {
    const next = setJudge(stamped(), 0, { email: 'sam@x.org' }, LATER);
    expect(next.adjudicators[0]).toEqual({ ...FULL, email: 'sam@x.org', questionnaireUpdatedAt: '' });
    expect(next.updatedAt).toBe(LATER);
  });

  it('clearing the email clears the stamp', () => {
    expect(setJudge(stamped(), 0, { email: '' }, LATER).adjudicators[0].questionnaireUpdatedAt).toBe('');
  });

  it('a case or surrounding-whitespace change to the email keeps the stamp', () => {
    const next = setJudge(stamped(), 0, { email: '  JANE@X.org ' }, LATER);
    expect(next.adjudicators[0].email).toBe('  JANE@X.org ');
    expect(next.adjudicators[0].questionnaireUpdatedAt).toBe(STAMP);
  });

  it('changing any other field keeps the stamp', () => {
    const patches: Partial<Adjudicator>[] = [
      { name: 'Janet Judge' },
      { mailingAddress: '2 Elm St' },
      { cellPhone: '' },
      { needsPower: false },
      { dietary: '' },
      { bio: '' },
      { judgeNotes: '' },
      { needsHotel: false },
      { hotelNights: { before: false, after: false } },
      { requestingFlight: false },
      { ttaoContractDate: '' },
      { paymentPaperworkSentDate: '' },
      { paymentPaperworkReturnedDate: '' },
    ];
    for (const patch of patches) {
      expect(setJudge(stamped(), 0, patch, LATER).adjudicators[0].questionnaireUpdatedAt).toBe(STAMP);
    }
  });

  it('a patch that sets the stamp itself wins, even with an email change', () => {
    const next = setJudge(stamped(), 0, { email: 'sam@x.org', questionnaireUpdatedAt: LATER }, LATER);
    expect(next.adjudicators[0].questionnaireUpdatedAt).toBe(LATER);
  });

  it('touches only the given slot', () => {
    const before = stamped();
    const next = setJudge(before, 1, { email: 'sam@x.org' }, LATER);
    expect(next.adjudicators[0]).toBe(before.adjudicators[0]);
    expect(next.adjudicators[1].email).toBe('sam@x.org');
  });

  it('addAsJudge goes through the same rule', () => {
    const c = addAsJudge(createContest({ id: 'c1', now: NOW }), 'Jane Judge', LATER);
    expect(c.adjudicators[0].name).toBe('Jane Judge');
    expect(c.updatedAt).toBe(LATER);
  });
});

describe('JUDGE_FIELD_SCOPE drives hasJudgeData and judgeForOtherContest', () => {
  const fields = Object.keys(JUDGE_FIELD_SCOPE) as (keyof Adjudicator)[];

  it('classifies every Adjudicator field', () => {
    expect([...fields].sort()).toEqual(Object.keys(BLANK).sort());
  });

  it('matches the RFC #267 scopes', () => {
    const byScope = (scope: string) => fields.filter((f) => JUDGE_FIELD_SCOPE[f] === scope).sort();
    expect(byScope('identity')).toEqual(['email', 'name']);
    expect(byScope('person')).toEqual(['bio', 'cellPhone', 'dietary', 'judgeNotes', 'mailingAddress', 'needsPower']);
    expect(byScope('perContest')).toEqual(['hotelNights', 'needsHotel', 'requestingFlight']);
    expect(byScope('bookkeeping')).toEqual([
      'paymentPaperworkReturnedDate',
      'paymentPaperworkSentDate',
      'ttaoContractDate',
    ]);
    expect(byScope('stamp')).toEqual(['questionnaireUpdatedAt']);
  });

  it('a blank judge has no data', () => {
    expect(hasJudgeData(BLANK)).toBe(false);
  });

  for (const field of fields) {
    const only: Adjudicator = { ...BLANK, [field]: FULL[field] };
    const scope = JUDGE_FIELD_SCOPE[field];
    // The stamp alone is not data; hotel nights only count once needsHotel is set.
    const counts = scope !== 'stamp' && field !== 'hotelNights';

    it(`${field} (${scope}) ${counts ? 'counts' : 'does not count'} as judge data`, () => {
      expect(hasJudgeData(only)).toBe(counts);
    });

    it(`${field} (${scope}) is ${scope === 'perContest' || scope === 'stamp' ? 'blanked' : 'kept'} for another contest`, () => {
      const copied = judgeForOtherContest(FULL)[field];
      expect(copied).toEqual(scope === 'perContest' || scope === 'stamp' ? BLANK[field] : FULL[field]);
    });
  }

  it('whitespace-only text is not data', () => {
    expect(hasJudgeData({ ...BLANK, name: '   ', bio: '\n' })).toBe(false);
  });

  it('judgeForOtherContest leaves the original untouched and shares no nested object', () => {
    const copy = judgeForOtherContest(FULL);
    expect(FULL.hotelNights).toEqual({ before: true, after: true });
    expect(copy.hotelNights).not.toBe(FULL.hotelNights);
  });
});

describe('the stamp follows the email through questionnaire submissions', () => {
  function submission(email: string, submittedAt: string, dietary: string): JudgeSubmission {
    return {
      email,
      submittedAt,
      answers: {
        ...blankAnswers(['c1']),
        dietary,
        contests: { c1: { hotelBefore: false, hotelAfter: false, requestingFlight: false, needsPower: false } },
      },
    };
  }

  const subs = [
    submission('jane@x.org', '2026-11-05T00:00:00.000Z', 'jane answer'),
    submission('sam@x.org', '2026-11-03T00:00:00.000Z', 'sam answer'),
  ];

  function janeApplied(): Contest {
    const c = setJudge(createContest({ id: 'c1', now: NOW }), 0, { name: 'Jane', email: 'jane@x.org' }, NOW);
    return applySubmissions(c, subs, NOW);
  }

  it("after an email change, the new email's latest submission applies, even if older than the old stamp", () => {
    const jane = janeApplied();
    expect(jane.adjudicators[0].dietary).toBe('jane answer');
    const sam = applySubmissions(setJudge(jane, 0, { name: 'Sam', email: 'sam@x.org' }, LATER), subs, LATER);
    expect(sam.adjudicators[0].dietary).toBe('sam answer');
    expect(sam.adjudicators[0].questionnaireUpdatedAt).toBe('2026-11-03T00:00:00.000Z');
  });

  it('after a typo and a fix back to the same person, the same answers re-apply', () => {
    let c = setJudge(janeApplied(), 0, { dietary: 'typed by CM' }, LATER);
    c = setJudge(c, 0, { email: 'jnae@x.org' }, LATER);
    c = applySubmissions(c, subs, LATER);
    expect(c.adjudicators[0].dietary).toBe('typed by CM');
    expect(c.adjudicators[0].questionnaireUpdatedAt).toBe('');
    c = applySubmissions(setJudge(c, 0, { email: 'jane@x.org' }, LATER), subs, LATER);
    expect(c.adjudicators[0].dietary).toBe('jane answer');
    expect(c.adjudicators[0].questionnaireUpdatedAt).toBe('2026-11-05T00:00:00.000Z');
  });
});

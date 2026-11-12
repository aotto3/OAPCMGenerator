import { describe, expect, it } from 'vitest';
import {
  createContest,
  defaultAdjudicators,
  lockCritique,
  setCritiqueAssignment,
  withAdjudicator,
  withDetails,
  withSchool,
  type Adjudicator,
  type Contest,
} from './contest';
import { canCopyJudges, copyJudges, judgeCopyImpact, judgeCopyTargets } from './copyJudges';
import { applySubmissions, type JudgeSubmission } from '../questionnaire/submission';

const NOW = '2026-07-05T12:00:00.000Z';
const LATER = '2026-07-06T00:00:00.000Z';

function zone(id: string, zoneNumber: string): Contest {
  return createContest({
    id,
    now: NOW,
    identity: { contestLevel: 'Zone', district: '20', zone: zoneNumber },
  });
}

const FULL_JUDGE: Adjudicator = {
  name: 'Jane Doe',
  mailingAddress: '1 Main St, Austin TX 78701',
  email: 'jane@example.org',
  cellPhone: '512-555-0100',
  needsPower: true,
  needsHotel: true,
  hotelNights: { before: true, after: true },
  requestingFlight: true,
  dietary: 'vegetarian',
  ttaoContractDate: '2026-01-10',
  paymentPaperworkSentDate: '2026-01-11',
  paymentPaperworkReturnedDate: '2026-01-12',
  bio: 'A longtime adjudicator.',
  judgeNotes: 'Prefers aisle seats',
  questionnaireUpdatedAt: '2026-01-09T12:00:00.000Z',
};

/** A source zone with a full Judge 1, a named Judge 2, and an empty Judge 3. */
function sourceZone(): Contest {
  const withJudge1 = withAdjudicator(zone('source', '1'), 0, FULL_JUDGE, NOW);
  return withAdjudicator(withJudge1, 1, { name: 'Sam Lee' }, NOW);
}

describe('copyJudges', () => {
  it('copies person-level fields and checklist dates in the same order; blanks travel answers and the stamp (#263)', () => {
    const result = copyJudges(sourceZone(), zone('target', '2'), LATER);
    expect(result.adjudicators[0]).toEqual({
      ...FULL_JUDGE,
      needsHotel: false,
      hotelNights: { before: false, after: false },
      requestingFlight: false,
      questionnaireUpdatedAt: '',
    });
    expect(result.adjudicators[1].name).toBe('Sam Lee');
    expect(result.adjudicators[2]).toEqual(defaultAdjudicators()[2]);
  });

  it('replaces every target slot, leaving no mix of old and new judges', () => {
    const target = withAdjudicator(zone('target', '2'), 2, { name: 'Old Judge', dietary: 'none' }, NOW);
    const result = copyJudges(sourceZone(), target, LATER);
    expect(result.adjudicators[2]).toEqual(defaultAdjudicators()[2]);
  });

  it('copies the judge count', () => {
    const source = withDetails(sourceZone(), { numJudges: 2 }, NOW);
    expect(copyJudges(source, zone('target', '2'), LATER).details.numJudges).toBe(2);
  });

  it('keeps the target critique assignment when the judge count is unchanged', () => {
    const target = lockCritique(setCritiqueAssignment(zone('target', '2'), [1, 2, 3, 1, 2, 3], NOW), NOW);
    const result = copyJudges(sourceZone(), target, LATER);
    expect(result.critique).toEqual(target.critique);
  });

  it('clears the target critique assignment when the judge count changes', () => {
    const target = setCritiqueAssignment(zone('target', '2'), [1, 2, 3, 1, 2, 3], NOW);
    const source = withDetails(sourceZone(), { numJudges: 1 }, NOW);
    expect(copyJudges(source, target, LATER).critique).toBeNull();
  });

  it('clears a locked critique assignment when the judge count changes', () => {
    const target = lockCritique(setCritiqueAssignment(zone('target', '2'), [1, 2, 3, 1, 2, 3], NOW), NOW);
    const source = withDetails(sourceZone(), { numJudges: 2 }, NOW);
    expect(copyJudges(source, target, LATER).critique).toBeNull();
  });

  it('changes nothing else on the target except its updatedAt', () => {
    const target = withSchool(zone('target', '2'), 0, { name: 'Target High' }, NOW);
    const result = copyJudges(sourceZone(), target, LATER);
    expect(result).toEqual({
      ...target,
      adjudicators: result.adjudicators,
      updatedAt: LATER,
    });
    expect(result.adjudicators.map((j) => j.name)).toEqual(sourceZone().adjudicators.map((j) => j.name));
  });

  it('leaves the source unchanged and shares no judge objects with it', () => {
    const source = sourceZone();
    const snapshot = structuredClone(source);
    const result = copyJudges(source, zone('target', '2'), LATER);
    expect(source).toEqual(snapshot);
    result.adjudicators[0].name = 'Edited Later';
    expect(source.adjudicators[0].name).toBe('Jane Doe');
  });
});

describe('judgeCopyImpact', () => {
  it('reports nothing to confirm for an empty target with the same judge count', () => {
    expect(judgeCopyImpact(sourceZone(), zone('target', '2'))).toEqual({
      replacedJudgeNames: [],
      targetHasJudgeData: false,
      clearsCritique: false,
      needsConfirmation: false,
    });
  });

  it('names the target judges being replaced', () => {
    const target = withAdjudicator(
      withAdjudicator(zone('target', '2'), 0, { name: ' Pat Roe ' }, NOW),
      2,
      { name: 'Kim Poe' },
      NOW,
    );
    const impact = judgeCopyImpact(sourceZone(), target);
    expect(impact.replacedJudgeNames).toEqual(['Pat Roe', 'Kim Poe']);
    expect(impact.targetHasJudgeData).toBe(true);
    expect(impact.needsConfirmation).toBe(true);
  });

  it('counts judges hidden by a lower judge count, because they get replaced too', () => {
    const target = withDetails(
      withAdjudicator(zone('target', '2'), 2, { name: 'Hidden Judge' }, NOW),
      { numJudges: 1 },
      NOW,
    );
    const impact = judgeCopyImpact(withDetails(sourceZone(), { numJudges: 1 }, NOW), target);
    expect(impact.replacedJudgeNames).toEqual(['Hidden Judge']);
    expect(impact.needsConfirmation).toBe(true);
  });

  it.each<[string, Partial<Adjudicator>]>([
    ['mailing address', { mailingAddress: '2 Elm St' }],
    ['dietary notes', { dietary: 'vegan' }],
    ['bio', { bio: 'Bio' }],
    ['power need', { needsPower: true }],
    ['hotel need', { needsHotel: true }],
    ['fly request', { requestingFlight: true }],
    ['judge notes', { judgeNotes: 'Call first' }],
    ['checklist date', { ttaoContractDate: '2026-01-10' }],
  ])('treats an unnamed judge with only a %s as data to confirm', (_field, patch) => {
    const target = withAdjudicator(zone('target', '2'), 0, patch, NOW);
    const impact = judgeCopyImpact(sourceZone(), target);
    expect(impact.replacedJudgeNames).toEqual([]);
    expect(impact.targetHasJudgeData).toBe(true);
    expect(impact.needsConfirmation).toBe(true);
  });

  it('ignores whitespace and hotel nights with no hotel need', () => {
    const target = withAdjudicator(zone('target', '2'), 0, { name: '   ', hotelNights: { before: true, after: true } }, NOW);
    expect(judgeCopyImpact(sourceZone(), target).targetHasJudgeData).toBe(false);
  });

  it('warns about critique when the count changes, even with no judge data to replace', () => {
    const target = setCritiqueAssignment(zone('target', '2'), [1, 2, 3, 1, 2, 3], NOW);
    const impact = judgeCopyImpact(withDetails(sourceZone(), { numJudges: 2 }, NOW), target);
    expect(impact.clearsCritique).toBe(true);
    expect(impact.targetHasJudgeData).toBe(false);
    expect(impact.needsConfirmation).toBe(true);
  });

  it('has no critique to warn about when the target has no assignment', () => {
    const impact = judgeCopyImpact(withDetails(sourceZone(), { numJudges: 2 }, NOW), zone('target', '2'));
    expect(impact.clearsCritique).toBe(false);
    expect(impact.needsConfirmation).toBe(false);
  });

  it('does not warn about critique when the count is unchanged', () => {
    const target = setCritiqueAssignment(zone('target', '2'), [1, 2, 3, 1, 2, 3], NOW);
    expect(judgeCopyImpact(sourceZone(), target).clearsCritique).toBe(false);
  });
});

describe('judge email in Copy Judges (PRD #227)', () => {
  it('asks for confirmation before replacing a target judge that has only an email', () => {
    const target = withAdjudicator(zone('target', '2'), 0, { email: 'keep@x.org' }, NOW);
    expect(judgeCopyImpact(sourceZone(), target).needsConfirmation).toBe(true);
  });

  it('copies the judge email to the target', () => {
    expect(copyJudges(sourceZone(), zone('target', '2'), LATER).adjudicators[0].email).toBe('jane@example.org');
  });
});

describe('canCopyJudges', () => {
  it('is false when the active judges are blank', () => {
    expect(canCopyJudges(zone('source', '1'))).toBe(false);
  });

  it('is true when any active judge has data', () => {
    expect(canCopyJudges(withAdjudicator(zone('source', '1'), 0, { dietary: 'vegan' }, NOW))).toBe(true);
  });

  it('counts a judge with only an email as having data (PRD #227)', () => {
    expect(canCopyJudges(withAdjudicator(zone('source', '1'), 0, { email: 'only@x.org' }, NOW))).toBe(true);
  });

  it('ignores data in slots hidden by the judge count', () => {
    const source = withDetails(
      withAdjudicator(zone('source', '1'), 2, { name: 'Hidden Judge' }, NOW),
      { numJudges: 1 },
      NOW,
    );
    expect(canCopyJudges(source)).toBe(false);
  });
});

describe('judgeCopyTargets', () => {
  const row = (id: string, contestLevel: string, archived = false) => ({ id, contestLevel, archived });

  it('lists every other non-archived Zone contest', () => {
    const rows = [
      row('open', 'Zone'),
      row('zone-2', 'Zone'),
      row('zone-3', 'Zone'),
      row('archived-zone', 'Zone', true),
      row('district', 'District'),
    ];
    expect(judgeCopyTargets(rows, 'open').map((r) => r.id)).toEqual(['zone-2', 'zone-3']);
  });

  it('is empty when no other Zone contest exists', () => {
    expect(judgeCopyTargets([row('open', 'Zone'), row('district', 'District')], 'open')).toEqual([]);
  });
});

describe('Copy Judges and the questionnaire (#263)', () => {
  it("the target's own questionnaire answers apply after a copy", () => {
    const source = sourceZone();
    const submission: JudgeSubmission = {
      email: FULL_JUDGE.email,
      submittedAt: '2026-01-20T12:00:00.000Z',
      answers: {
        cellPhone: FULL_JUDGE.cellPhone,
        mailingAddress: FULL_JUDGE.mailingAddress,
        dietary: FULL_JUDGE.dietary,
        needsPower: FULL_JUDGE.needsPower,
        bio: FULL_JUDGE.bio,
        notes: FULL_JUDGE.judgeNotes,
        contests: {
          source: { hotelBefore: true, hotelAfter: true, requestingFlight: true },
          target: { hotelBefore: false, hotelAfter: true, requestingFlight: false },
        },
      },
    };
    // The source has already absorbed this submission (stamp equals it).
    const appliedSource = applySubmissions(source, [submission], NOW);
    const copied = copyJudges(appliedSource, zone('target', '2'), LATER);
    const result = applySubmissions(copied, [submission], LATER);
    const judge = result.adjudicators[0];
    expect(judge.needsHotel).toBe(true);
    expect(judge.hotelNights).toEqual({ before: false, after: true });
    expect(judge.requestingFlight).toBe(false);
    expect(judge.questionnaireUpdatedAt).toBe(submission.submittedAt);
  });

  it('leaves the source travel answers and stamp untouched', () => {
    const source = sourceZone();
    copyJudges(source, zone('target', '2'), LATER);
    expect(source.adjudicators[0]).toEqual(FULL_JUDGE);
  });
});

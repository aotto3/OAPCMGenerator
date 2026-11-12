/**
 * The judge panel (RFC #267): who is judging this contest, what each Adjudicator
 * field means across contests, and when the questionnaire stamp is valid.
 *
 * Pure. Everything that reads "the active judges", classifies judge fields or edits
 * a judge slot goes through here, so a new field or a new rule lands in one place.
 */
import { activeJudges, defaultAdjudicators, type Adjudicator, type Contest } from './contest';

/** The one definition of who is judging: the first details.numJudges stored slots. */
export { activeJudges };

/** The active judges with their 0-based slot index, for UIs and per-slot writes. */
export function activeJudgeSlots(contest: Contest): { index: number; judge: Adjudicator }[] {
  return activeJudges(contest).map((judge, index) => ({ index, judge }));
}

/** Trimmed and lower-cased; how judge emails are compared everywhere. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * What a field means across contests:
 * - identity: who the judge is (name, email).
 * - person: about the person, the same in every contest they judge.
 * - perContest: answers that belong to one contest (travel).
 * - bookkeeping: the CM's contracting dates for the judge.
 * - stamp: when questionnaire answers were last applied to the slot.
 */
export type JudgeFieldScope = 'identity' | 'person' | 'perContest' | 'bookkeeping' | 'stamp';

/**
 * Every Adjudicator field has exactly one scope. Total over keyof Adjudicator, so a
 * new field without a scope fails to compile.
 *
 * needsPower is asked per contest on the questionnaire (#288) but stays 'person'
 * here: the #262 decision blanks only the travel answers on Copy Judges.
 */
export const JUDGE_FIELD_SCOPE: Record<keyof Adjudicator, JudgeFieldScope> = {
  name: 'identity',
  email: 'identity',
  mailingAddress: 'person',
  cellPhone: 'person',
  needsPower: 'person',
  dietary: 'person',
  bio: 'person',
  judgeNotes: 'person',
  needsHotel: 'perContest',
  hotelNights: 'perContest',
  requestingFlight: 'perContest',
  ttaoContractDate: 'bookkeeping',
  paymentPaperworkSentDate: 'bookkeeping',
  paymentPaperworkReturnedDate: 'bookkeeping',
  questionnaireUpdatedAt: 'stamp',
};

const FIELDS = Object.keys(JUDGE_FIELD_SCOPE) as (keyof Adjudicator)[];

/**
 * Whether one field holds something on its own. hotelNights never does: the nights
 * only mean something once needsHotel is set, and needsHotel is checked itself.
 */
function fieldHasData(judge: Adjudicator, field: keyof Adjudicator): boolean {
  const value = judge[field];
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'boolean') return value;
  return false;
}

/** True when a slot holds anything worth protecting. The stamp alone is not data. */
export function hasJudgeData(judge: Adjudicator): boolean {
  return FIELDS.some((field) => JUDGE_FIELD_SCOPE[field] !== 'stamp' && fieldHasData(judge, field));
}

const BLANK: Adjudicator = defaultAdjudicators()[0];

/**
 * A judge as they should appear when copied into a different contest: identity,
 * person and bookkeeping fields carry over; perContest fields are blanked and the
 * stamp cleared, so the judge's own answers for that contest still apply (#263).
 */
export function judgeForOtherContest(judge: Adjudicator): Adjudicator {
  const copy: Adjudicator = { ...judge, hotelNights: { ...judge.hotelNights } };
  for (const field of FIELDS) {
    const scope = JUDGE_FIELD_SCOPE[field];
    if (scope === 'perContest' || scope === 'stamp') {
      (copy as unknown as Record<string, unknown>)[field] = structuredClone(BLANK[field]);
    }
  }
  return copy;
}

/**
 * The one way to change a judge slot. The questionnaire stamp belongs to the
 * judge's email (#262): when the normalized email changes, the stamp is cleared and
 * the typed fields stay, unless the patch sets the stamp itself. Bumps updatedAt.
 */
export function setJudge(contest: Contest, index: number, patch: Partial<Adjudicator>, now?: string): Contest {
  const adjudicators = contest.adjudicators.map((judge, i) => {
    if (i !== index) return judge;
    const next = { ...judge, ...patch };
    const emailChanged = normalizeEmail(next.email) !== normalizeEmail(judge.email);
    if (emailChanged && patch.questionnaireUpdatedAt === undefined) next.questionnaireUpdatedAt = '';
    return next;
  });
  return { ...contest, updatedAt: now ?? new Date().toISOString(), adjudicators };
}

/**
 * The judge questionnaire service (PRD #252, RFC #270 slice #273).
 *
 * Owns link tokens, roster validation and storage, judge matching, submission
 * storage, and who gets the CM notice. Hides the storage encoding, the tables,
 * the limits and the mail fan-out. HTTP concerns (sessions, rate limits, the
 * honeypot, status codes) belong to `questionnaireRoutes.ts`.
 *
 * Every timestamp comes from the injected `now`.
 */
import { randomBytes } from 'node:crypto';
import {
  findJudge,
  normalizeEmail,
  parseAnswers,
  parseRoster,
  type JudgeLookup,
  type SubmissionAnswers,
} from './judgeRoster';
import type { Mailer } from './mailer';
import { buildSubmissionNotices } from './questionnaireEmail';
import type { QuestionnaireStore, StoredSubmission } from './questionnaireStore';

/** One judge's current answers, as the owner lists them. */
export type JudgeSubmission = StoredSubmission;

/** What the public page gets for a matched judge. */
export interface JudgeLookupResult extends JudgeLookup {
  /** The judge's current answers, or null before the first submit. */
  lastSubmission: SubmissionAnswers | null;
}

export interface QuestionnaireService {
  /** The account's standing token, created on first ask. */
  linkFor(ownerId: string): Promise<{ token: string }>;
  /** Replaces the token; the old link stops working at once. */
  resetLink(ownerId: string): Promise<{ token: string }>;
  /** Validates and replaces the account's roster. */
  publishRoster(ownerId: string, roster: unknown): Promise<{ ok: true } | { error: 'invalid' | 'too_large' }>;
  submissionsFor(ownerId: string): Promise<JudgeSubmission[]>;
  /** Public. null covers unknown token, no roster and unknown email alike. */
  lookup(token: string, email: string): Promise<JudgeLookupResult | null>;
  /**
   * Public. Stores the answers and notifies each CM involved (best-effort: a
   * mail failure never fails the submit).
   */
  submit(
    token: string,
    email: string,
    answers: unknown,
  ): Promise<{ submittedAt: string } | { error: 'not_found' | 'invalid_answers' }>;
}

export interface QuestionnaireServiceDeps {
  store: QuestionnaireStore;
  mailer: Mailer;
  /** The account's sign-in email: the notice's fallback recipient. */
  ownerEmail(ownerId: string): Promise<string | null | undefined>;
  now: () => Date;
  /** Link token generator; defaults to 144 random bits, base64url. */
  newToken?: () => string;
}

const defaultNewToken = () => randomBytes(18).toString('base64url');

export function createQuestionnaireService(deps: QuestionnaireServiceDeps): QuestionnaireService {
  const { store, mailer, now } = deps;
  const newToken = deps.newToken ?? defaultNewToken;
  const stamp = () => now().toISOString();

  async function issue(ownerId: string): Promise<{ token: string }> {
    const token = newToken();
    await store.setToken(ownerId, token, stamp());
    return { token };
  }

  /** Token + email -> the owning account and the judge, or null. */
  async function match(token: string, email: string) {
    const key = normalizeEmail(email);
    if (key === '') return null;
    const owner = await store.ownerForToken(token);
    if (!owner) return null;
    const roster = await store.getRoster(owner);
    const judge = roster ? findJudge(roster, key) : null;
    return judge ? { owner, email: key, judge } : null;
  }

  async function notifyCms(
    m: { owner: string; email: string; judge: JudgeLookup },
    answers: SubmissionAnswers,
    isUpdate: boolean,
  ): Promise<void> {
    try {
      const fallbackEmail = (await deps.ownerEmail(m.owner).catch(() => undefined)) ?? undefined;
      const mails = buildSubmissionNotices({
        judgeName: m.judge.judgeName,
        judgeEmail: m.email,
        contests: m.judge.contests,
        answers,
        isUpdate,
        fallbackEmail,
      });
      for (const mail of mails) {
        try {
          await mailer.send(mail);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('Questionnaire notice failed to send (ignored)', err);
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Questionnaire notice failed (ignored)', err);
    }
  }

  return {
    async linkFor(ownerId) {
      const token = await store.getToken(ownerId);
      return token ? { token } : issue(ownerId);
    },

    resetLink: issue,

    async publishRoster(ownerId, input) {
      const roster = parseRoster(input);
      if (!roster) return { error: 'invalid' };
      const result = await store.putRoster(ownerId, roster, stamp());
      return result === 'ok' ? { ok: true } : { error: 'too_large' };
    },

    submissionsFor: (ownerId) => store.listSubmissions(ownerId),

    async lookup(token, email) {
      const m = await match(token, email);
      if (!m) return null;
      const last = await store.getSubmission(m.owner, m.email);
      return { ...m.judge, lastSubmission: last ? last.answers : null };
    },

    async submit(token, email, input) {
      const m = await match(token, email);
      if (!m) return { error: 'not_found' };
      const answers = parseAnswers(
        input,
        m.judge.contests.map((c) => c.id),
      );
      if (!answers) return { error: 'invalid_answers' };
      const previous = await store.getSubmission(m.owner, m.email);
      const submittedAt = stamp();
      await store.putSubmission(m.owner, { email: m.email, submittedAt, answers });
      await notifyCms(m, answers, previous !== undefined);
      return { submittedAt };
    },
  };
}

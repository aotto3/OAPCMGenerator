/**
 * Storage for the judge questionnaire (PRD #252, RFC #270 slice #273): each
 * account's standing link token, its published judge roster, and its judges'
 * current submissions.
 *
 * Typed in and out. The JSON encoding, the three tables and the roster byte
 * limit are internal here; callers never see text. A roster is validated by
 * `parseRoster` before it is put, so a stored roster is decoded once when read
 * and not re-validated. Owner-scoped like the contest repo; the one
 * cross-account read is token -> owner, which is how a public link finds its
 * account. Pool-injected so the tests run on pg-mem.
 */
import type { Pool } from './db';
import type { JudgeRoster, SubmissionAnswers } from './judgeRoster';

/** Serialized roster cap; far above a real account's roster. */
export const MAX_ROSTER_BYTES = 512 * 1024;

export interface StoredSubmission {
  /** The judge's normalized email. */
  email: string;
  submittedAt: string;
  answers: SubmissionAnswers;
}

export interface QuestionnaireStore {
  /** The account's link token, or undefined if it has never had one. */
  getToken(ownerId: string): Promise<string | undefined>;
  /** Creates or replaces the account's token. */
  setToken(ownerId: string, token: string, at: string): Promise<void>;
  /** The account a public token belongs to, or undefined. */
  ownerForToken(token: string): Promise<string | undefined>;
  /**
   * Replaces the account's roster (already validated). Refuses, storing
   * nothing, when its encoding is over MAX_ROSTER_BYTES.
   */
  putRoster(ownerId: string, roster: JudgeRoster, at: string): Promise<'ok' | 'too_large'>;
  getRoster(ownerId: string): Promise<JudgeRoster | undefined>;
  /** Creates or replaces one judge's submission. */
  putSubmission(ownerId: string, submission: StoredSubmission): Promise<void>;
  getSubmission(ownerId: string, email: string): Promise<StoredSubmission | undefined>;
  /** Oldest first. */
  listSubmissions(ownerId: string): Promise<StoredSubmission[]>;
}

interface SubmissionRow {
  email: string;
  submitted_at: string;
  answers: string;
}

const toSubmission = (r: SubmissionRow): StoredSubmission => ({
  email: r.email,
  submittedAt: r.submitted_at,
  answers: JSON.parse(r.answers) as SubmissionAnswers,
});

export function createQuestionnaireStore(pool: Pool): QuestionnaireStore {
  return {
    async getToken(ownerId) {
      const { rows } = await pool.query('select token from questionnaire_links where owner_id = $1', [ownerId]);
      return rows[0]?.token;
    },

    async setToken(ownerId, token, at) {
      await pool.query(
        `insert into questionnaire_links (owner_id, token, created_at) values ($1, $2, $3)
         on conflict (owner_id) do update set token = excluded.token, created_at = excluded.created_at`,
        [ownerId, token, at],
      );
    },

    async ownerForToken(token) {
      const { rows } = await pool.query('select owner_id from questionnaire_links where token = $1', [token]);
      return rows[0]?.owner_id;
    },

    async putRoster(ownerId, roster, at) {
      const text = JSON.stringify(roster);
      if (Buffer.byteLength(text, 'utf8') > MAX_ROSTER_BYTES) return 'too_large';
      await pool.query(
        `insert into judge_rosters (owner_id, roster, updated_at) values ($1, $2, $3)
         on conflict (owner_id) do update set roster = excluded.roster, updated_at = excluded.updated_at`,
        [ownerId, text, at],
      );
      return 'ok';
    },

    async getRoster(ownerId) {
      const { rows } = await pool.query('select roster from judge_rosters where owner_id = $1', [ownerId]);
      const text: string | undefined = rows[0]?.roster;
      return text === undefined ? undefined : (JSON.parse(text) as JudgeRoster);
    },

    async putSubmission(ownerId, s) {
      await pool.query(
        `insert into judge_submissions (owner_id, email, submitted_at, answers) values ($1, $2, $3, $4)
         on conflict (owner_id, email) do update
           set submitted_at = excluded.submitted_at, answers = excluded.answers`,
        [ownerId, s.email, s.submittedAt, JSON.stringify(s.answers)],
      );
    },

    async getSubmission(ownerId, email) {
      const { rows } = await pool.query(
        'select email, submitted_at, answers from judge_submissions where owner_id = $1 and email = $2',
        [ownerId, email],
      );
      return rows[0] ? toSubmission(rows[0]) : undefined;
    },

    async listSubmissions(ownerId) {
      const { rows } = await pool.query(
        `select email, submitted_at, answers from judge_submissions
         where owner_id = $1 order by submitted_at`,
        [ownerId],
      );
      return rows.map(toSubmission);
    },
  };
}

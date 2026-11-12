/**
 * Data access for the judge questionnaire (PRD #252): each account's standing link
 * token and its published judge roster. Owner-scoped like the contest repo; the
 * one cross-account read is token -> owner, which is how a public link finds its
 * account. Pool-injected so the integration tests run on pg-mem.
 */
import type { Pool } from './db';

export interface QuestionnaireRepo {
  /** The account's link token, or undefined if it has never had one. */
  getToken(ownerId: string): Promise<string | undefined>;
  /** Creates or replaces the account's token. */
  setToken(ownerId: string, token: string, at: string): Promise<void>;
  /** The account a public token belongs to, or undefined. */
  ownerForToken(token: string): Promise<string | undefined>;
  /** Replaces the account's roster (JSON text). */
  putRoster(ownerId: string, roster: string, at: string): Promise<void>;
  getRoster(ownerId: string): Promise<string | undefined>;
}

export function createQuestionnaireRepo(pool: Pool): QuestionnaireRepo {
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
      await pool.query(
        `insert into judge_rosters (owner_id, roster, updated_at) values ($1, $2, $3)
         on conflict (owner_id) do update set roster = excluded.roster, updated_at = excluded.updated_at`,
        [ownerId, roster, at],
      );
    },

    async getRoster(ownerId) {
      const { rows } = await pool.query('select roster from judge_rosters where owner_id = $1', [ownerId]);
      return rows[0]?.roster;
    },
  };
}

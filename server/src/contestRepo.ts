/**
 * Data access for the contests table. Every method is scoped by ownerId — the
 * single place that enforces "a user only ever sees their own contests" — so
 * the routes never write a query that could cross accounts. Pool-injected so
 * the integration tests can hand it an in-memory Postgres.
 */
import type { Pool } from './db';

export interface ContestSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface ContestRecord extends ContestSummary {
  payload: string;
}

export interface NewContest {
  id: string;
  ownerId: string;
  name: string;
  updatedAt: string;
  payload: string;
  createdAt: string;
}

export interface ContestPatch {
  name: string;
  updatedAt: string;
  payload: string;
}

export interface ContestRepo {
  listByOwner(ownerId: string): Promise<ContestSummary[]>;
  getOwned(ownerId: string, id: string): Promise<ContestRecord | undefined>;
  /** True if a contest with this id exists for ANY owner (id is the global PK). */
  exists(id: string): Promise<boolean>;
  insert(contest: NewContest): Promise<void>;
  /** Returns false when no owned row matched (unknown id or another owner). */
  update(ownerId: string, id: string, patch: ContestPatch): Promise<boolean>;
  /** Returns false when no owned row matched. */
  remove(ownerId: string, id: string): Promise<boolean>;
  /** Total contest count across all owners (admin stats). */
  countAll(): Promise<number>;
  /** Contest count per owner id (admin users table). Owners with none are absent. */
  countsByOwner(): Promise<Record<string, number>>;
}

export function createContestRepo(pool: Pool): ContestRepo {
  return {
    async listByOwner(ownerId) {
      const { rows } = await pool.query(
        `select id, name, updated_at from contests
         where owner_id = $1
         order by updated_at desc`,
        [ownerId],
      );
      return rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at }));
    },

    async getOwned(ownerId, id) {
      const { rows } = await pool.query(
        `select id, name, updated_at, payload from contests
         where owner_id = $1 and id = $2`,
        [ownerId, id],
      );
      const r = rows[0];
      if (!r) return undefined;
      return { id: r.id, name: r.name, updatedAt: r.updated_at, payload: r.payload };
    },

    async exists(id) {
      const { rows } = await pool.query('select 1 from contests where id = $1', [id]);
      return rows.length > 0;
    },

    async insert(contest) {
      await pool.query(
        `insert into contests (id, owner_id, name, updated_at, payload, created_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [contest.id, contest.ownerId, contest.name, contest.updatedAt, contest.payload, contest.createdAt],
      );
    },

    async update(ownerId, id, patch) {
      const { rowCount } = await pool.query(
        `update contests set name = $3, updated_at = $4, payload = $5
         where owner_id = $1 and id = $2`,
        [ownerId, id, patch.name, patch.updatedAt, patch.payload],
      );
      return (rowCount ?? 0) > 0;
    },

    async remove(ownerId, id) {
      const { rowCount } = await pool.query(
        'delete from contests where owner_id = $1 and id = $2',
        [ownerId, id],
      );
      return (rowCount ?? 0) > 0;
    },

    async countAll() {
      const { rows } = await pool.query('select count(*)::int as n from contests');
      return rows[0]?.n ?? 0;
    },

    async countsByOwner() {
      const { rows } = await pool.query(
        'select owner_id, count(*)::int as n from contests group by owner_id',
      );
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.owner_id] = r.n;
      return counts;
    },
  };
}

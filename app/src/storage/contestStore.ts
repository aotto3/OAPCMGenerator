/**
 * Local-first contest storage (IndexedDB).
 *
 * Contests are stored as their versioned serialized envelope (the same string
 * serializeContest produces for export/sync later), plus a thin metadata row
 * the dashboard can list without parsing every payload. The contest model
 * module owns the payload format; this module never inspects it beyond
 * (de)serializing at the boundary.
 *
 * A future sync layer reads/writes the same store — IndexedDB stays the
 * source of truth on-device, the server is a replica (PRD issue #13).
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  contestDisplayName,
  parseContest,
  serializeContest,
  type Contest,
} from '../model/contest';

interface ContestRecord {
  id: string;
  /** Denormalized for dashboard listing; recomputed on every save. */
  name: string;
  updatedAt: string;
  /** Versioned envelope from serializeContest(). */
  payload: string;
}

interface OapDB extends DBSchema {
  contests: { key: string; value: ContestRecord };
}

const DB_NAME = 'oap-contest-manager';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<OapDB>> | undefined;

function db(): Promise<IDBPDatabase<OapDB>> {
  dbPromise ??= openDB<OapDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      database.createObjectStore('contests', { keyPath: 'id' });
    },
  });
  return dbPromise;
}

export interface ContestSummary {
  id: string;
  name: string;
  updatedAt: string;
}

/** Newest-edited first, for the dashboard. */
export async function listContests(): Promise<ContestSummary[]> {
  const records = await (await db()).getAll('contests');
  return records
    .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getContest(id: string): Promise<Contest | undefined> {
  const record = await (await db()).get('contests', id);
  return record ? parseContest(record.payload) : undefined;
}

export async function saveContest(contest: Contest): Promise<void> {
  await (await db()).put('contests', {
    id: contest.id,
    name: contestDisplayName(contest.identity),
    updatedAt: contest.updatedAt,
    payload: serializeContest(contest),
  });
}

export async function deleteContest(id: string): Promise<void> {
  await (await db()).delete('contests', id);
}

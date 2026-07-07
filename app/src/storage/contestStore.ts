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
  defaultSpeechwire,
  parseContest,
  serializeContest,
  type Contest,
  type SpeechwireCredentials,
} from '../model/contest';

interface ContestRecord {
  id: string;
  /** Denormalized for dashboard listing; recomputed on every save. */
  name: string;
  updatedAt: string;
  /** Versioned envelope from serializeContest(). */
  payload: string;
  /**
   * Device-only fields (Speechwire credentials). serializeContest() strips
   * them from the payload by construction, so they are stored here beside
   * it — the future sync layer and contest-file export read only `payload`
   * and can never ship credentials off this device.
   */
  deviceOnly?: SpeechwireCredentials;
}

/**
 * An immutable checkpoint snapshot (storage/checkpointStore.ts owns the API).
 * The record IS the model's Checkpoint — id, contestId, name, note, createdAt,
 * and the serializeContest() payload — so the store never reshapes it. The
 * `byContest` index lists a single contest's history without scanning.
 */
interface CheckpointRecord {
  id: string;
  contestId: string;
  name: string;
  note: string;
  createdAt: string;
  /** Versioned envelope from serializeContest(); device-only fields never in it. */
  payload: string;
}

interface OapDB extends DBSchema {
  contests: { key: string; value: ContestRecord };
  checkpoints: {
    key: string;
    value: CheckpointRecord;
    indexes: { byContest: string };
  };
}

const DB_NAME = 'oap-contest-manager';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<OapDB>> | undefined;

/**
 * Shared handle to the on-device database. contestStore owns the schema and
 * upgrade path; checkpointStore imports this so both live in one versioned DB.
 */
export function db(): Promise<IDBPDatabase<OapDB>> {
  dbPromise ??= openDB<OapDB>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      // Version-guarded so an existing v1 device only adds the new store.
      if (oldVersion < 1) {
        database.createObjectStore('contests', { keyPath: 'id' });
      }
      if (oldVersion < 2) {
        const checkpoints = database.createObjectStore('checkpoints', { keyPath: 'id' });
        checkpoints.createIndex('byContest', 'contestId');
      }
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
  if (!record) return undefined;
  const contest = parseContest(record.payload);
  // Re-attach this device's credentials (parseContest hydrates them blank).
  return { ...contest, speechwire: record.deviceOnly ?? defaultSpeechwire() };
}

export async function saveContest(contest: Contest): Promise<void> {
  await (await db()).put('contests', {
    id: contest.id,
    name: contestDisplayName(contest.identity),
    updatedAt: contest.updatedAt,
    payload: serializeContest(contest),
    deviceOnly: contest.speechwire,
  });
}

export async function deleteContest(id: string): Promise<void> {
  await (await db()).delete('contests', id);
}

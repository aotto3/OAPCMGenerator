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
import type { Checkpoint } from '../model/checkpoint';

interface ContestRecord {
  id: string;
  /** Denormalized for dashboard listing; recomputed on every save. */
  name: string;
  updatedAt: string;
  /**
   * Denormalized for dashboard listing alongside `name`; recomputed on every
   * save. Optional because records written before this field existed lack it —
   * `contestSummaryFromRecord` falls back to parsing the payload for those.
   */
  contestDate?: string;
  /** Denormalized host school name; see `contestDate` for the optionality note. */
  hostSchoolName?: string;
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

/* ────────────────────────── sync change notifications ──────────────────────────
 * The sync layer (storage/syncEngine.ts) needs to know when local contest data
 * changes so it can push. Rather than have the UI or the sync layer poll, the
 * store publishes a change for the contest whose data was written. This runs
 * AFTER the IndexedDB write and only marks work for a later async flush — no
 * network call touches the edit path. Pull writes (putPulledContest) deliberately
 * do NOT publish, so a pull can never bounce back as a push.
 */
export type ContestChangeType = 'save' | 'delete';
type ContestChangeListener = (id: string, type: ContestChangeType) => void;

const changeListeners = new Set<ContestChangeListener>();

/** Subscribe to local contest data changes. Returns an unsubscribe function. */
export function onContestChanged(listener: ContestChangeListener): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function emitChange(id: string, type: ContestChangeType): void {
  for (const listener of changeListeners) listener(id, type);
}

/* ────────────────────────── pull notifications (UI refresh) ──────────────────────────
 * A pull applies a remote contest to this device (putPulledContest). It must NOT
 * go through emitChange — that drives the sync engine's push and would bounce the
 * just-pulled data straight back up. But the UI does need to know: the dashboard
 * reads its contest list once on mount, so a pull arriving while it is open would
 * otherwise stay invisible until a reload (Slice 14 known gap, closed here in
 * Slice 15). This is a separate channel with exactly that one consumer — a pure
 * "remote data landed" signal, no push semantics.
 */
type ContestPulledListener = (id: string) => void;

const pullListeners = new Set<ContestPulledListener>();

/** Subscribe to remote pulls landing on this device. Returns an unsubscribe fn. */
export function onContestPulled(listener: ContestPulledListener): () => void {
  pullListeners.add(listener);
  return () => pullListeners.delete(listener);
}

function emitPulled(id: string): void {
  for (const listener of pullListeners) listener(id);
}

export interface ContestSummary {
  id: string;
  name: string;
  updatedAt: string;
  /** Denormalized contest date (ISO yyyy-mm-dd) or '' when unset. */
  contestDate: string;
  /** Denormalized host school name, or '' when unset. */
  hostSchoolName: string;
}

/**
 * Builds a dashboard summary from a stored record. The date and host school are
 * denormalized onto the record at save time (like `name`), but records written
 * before that denormalization existed lack those fields — for them, parse the
 * payload once to recover the values so they still display without a re-save.
 * Pure and exported so the summary/fallback logic is testable without IndexedDB.
 */
export function contestSummaryFromRecord(record: ContestRecord): ContestSummary {
  let contestDate = record.contestDate;
  let hostSchoolName = record.hostSchoolName;
  if (contestDate === undefined || hostSchoolName === undefined) {
    const contest = parseContest(record.payload);
    contestDate ??= contest.details.contestDate;
    hostSchoolName ??= contest.identity.hostSchoolName;
  }
  return { id: record.id, name: record.name, updatedAt: record.updatedAt, contestDate, hostSchoolName };
}

/** Newest-edited first, for the dashboard. */
export async function listContests(): Promise<ContestSummary[]> {
  const records = await (await db()).getAll('contests');
  return records
    .map(contestSummaryFromRecord)
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
    contestDate: contest.details.contestDate,
    hostSchoolName: contest.identity.hostSchoolName,
    payload: serializeContest(contest),
    deviceOnly: contest.speechwire,
  });
  emitChange(contest.id, 'save');
}

export async function deleteContest(id: string): Promise<void> {
  await (await db()).delete('contests', id);
  emitChange(id, 'delete');
}

/* ────────────────────────── sync-layer access ──────────────────────────
 * These serve the background sync layer (storage/syncEngine.ts) and keep this
 * file the only one that touches IndexedDB. The device-only Speechwire field is
 * never exposed here: getContestRecord hands back only the serializable payload
 * (which serializeContest already stripped), so nothing on the sync path can
 * read credentials.
 */

/** The stored contest payload + metadata for one contest (no device-only data). */
export interface StoredContest {
  id: string;
  name: string;
  updatedAt: string;
  /** serializeContest() envelope — the contest without checkpoints or creds. */
  payload: string;
}

/** Raw stored contest for the sync layer to build an upload bundle from. */
export async function getContestRecord(id: string): Promise<StoredContest | undefined> {
  const record = await (await db()).get('contests', id);
  if (!record) return undefined;
  return { id: record.id, name: record.name, updatedAt: record.updatedAt, payload: record.payload };
}

/**
 * Writes a contest pulled from the server, together with its checkpoints, as
 * this device's copy. Used by the sync layer's PULL path:
 *  - `updatedAt` is the server's version clock (the LWW winner), stored as the
 *    record's updatedAt so subsequent reconciles compare correctly. It may run
 *    ahead of the payload's own contest.updatedAt (e.g. after a checkpoint-only
 *    bump), which is expected and harmless — later edits use a fresh `now`.
 *  - the device's existing Speechwire credentials are PRESERVED (device-only
 *    data is per-device and never travels with a pull).
 *  - the contest's checkpoints are REPLACED wholesale with the pulled set, so
 *    checkpoints ride the same last-write-wins-per-contest resolution.
 * Deliberately does NOT publish a CHANGE (that drives the push path — a pull must
 * not re-trigger a push). It does emit a PULLED signal, a UI-only channel the
 * dashboard listens on to refresh; the two channels are kept separate for exactly
 * this reason.
 */
export async function putPulledContest(
  contest: Contest,
  checkpoints: Checkpoint[],
  updatedAt: string,
): Promise<void> {
  const database = await db();
  const existing = await database.get('contests', contest.id);
  const tx = database.transaction(['contests', 'checkpoints'], 'readwrite');

  await tx.objectStore('contests').put({
    id: contest.id,
    name: contestDisplayName(contest.identity),
    updatedAt,
    contestDate: contest.details.contestDate,
    hostSchoolName: contest.identity.hostSchoolName,
    // Store the contest-only envelope locally; checkpoints live in their store.
    payload: serializeContest(contest),
    deviceOnly: existing?.deviceOnly ?? contest.speechwire,
  });

  const cpStore = tx.objectStore('checkpoints');
  const stale = await cpStore.index('byContest').getAllKeys(contest.id);
  for (const key of stale) await cpStore.delete(key);
  for (const checkpoint of checkpoints) await cpStore.put(checkpoint);

  await tx.done;

  // Notify the UI (not the sync engine) that remote data landed, so an open
  // dashboard can refresh. This is NOT emitChange — a pull must not re-push.
  emitPulled(contest.id);
}

/**
 * Advances a contest's updatedAt clock for a checkpoint-only change (create,
 * delete, or note edit that doesn't otherwise touch the contest) and publishes
 * the change so sync uploads the refreshed bundle. Because checkpoints are
 * folded into the contest's sync payload, they only propagate when the contest's
 * clock moves — this is what moves it. No-op if the contest isn't stored (a
 * brand-new draft has nothing to sync yet).
 */
export async function bumpContestForCheckpointChange(
  contestId: string,
  now: string = new Date().toISOString(),
): Promise<void> {
  const database = await db();
  const record = await database.get('contests', contestId);
  if (!record) return;
  await database.put('contests', { ...record, updatedAt: now });
  emitChange(contestId, 'save');
}

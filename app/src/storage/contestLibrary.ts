/**
 * The contest library (RFC #276, slice A1 #277): this device's contests and
 * their checkpoints, and the ONE place that touches IndexedDB.
 *
 * Every write (an autosave, an import, a duplicate, a transform, a delete, a
 * checkpoint operation, a pull) goes through a single commit path inside one
 * IndexedDB transaction, builds the denormalized listing fields with the one
 * `summarize()`, assigns the record's version with the one version rule, and
 * then emits a `ContestEvent`. Callers never see the record shape.
 *
 * In this slice the existing sync engine still runs underneath: it subscribes
 * to `device` events to push, and writes pulls back through `applyRemote`,
 * which emits `remote` events (so a pull never bounces back up as a push, and
 * every listener, including the dashboard list, hears about it).
 *
 * No React, no `window`, no `fetch`: IndexedDB and the clock are injected, so
 * tests run against fake-indexeddb with a manual clock.
 */
import { wrap, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { makeCheckpoint, planRestore, type Checkpoint } from '../model/checkpoint';
import {
  createContest,
  defaultSpeechwire,
  effectiveContestTitle,
  parseContest,
  serializeContest,
  type Classification,
  type Contest,
  type ContestLevel,
  type SpeechwireCredentials,
} from '../model/contest';
import { bundleFromEnvelope, parseSyncBundle } from '../model/syncBundle';

/** What the dashboard (and the zone controls) list without parsing payloads. */
export interface ContestSummary {
  id: string;
  name: string;
  /** The record's version (the LWW clock the sync layer compares). */
  updatedAt: string;
  /** Contest date (ISO yyyy-mm-dd) or '' when unset. */
  contestDate: string;
  /** Host school name, or '' when unset. */
  hostSchoolName: string;
  /** Archived flag (PRD #141); false for active contests. */
  archived: boolean;
  /** Sort keys (PRD #142). */
  contestLevel: ContestLevel;
  classification: Classification;
  contestYear: string;
  /** For finding sibling zones (PRD #220). */
  district: string;
  zone: string;
}

/** `device` = a write made on this device; `remote` = a pull from the server. */
export type Origin = 'device' | 'remote';

export type ContestEvent =
  | { type: 'changed'; id: string; origin: Origin; by?: string; contest: Contest; summary: ContestSummary }
  | { type: 'removed'; id: string; origin: Origin };

/** A pulled contest as the sync engine hands it over (the server's record). */
export interface RemoteBundle {
  /** The server's version clock for the contest (the LWW winner). */
  updatedAt: string;
  /** Opaque sync bundle: { schemaVersion, contest, checkpoints }. */
  payload: string;
}

export interface ContestLibrary {
  list(): Promise<ContestSummary[]>;
  read(id: string): Promise<Contest | undefined>;
  readAll(): Promise<Contest[]>;
  /**
   * Reads the stored contest, runs the pure `fn`, and persists the result, all in
   * ONE transaction. Returns undefined (and writes nothing) if the contest is
   * gone; returning the same object is a no-op with no event.
   */
  transform(id: string, fn: (fresh: Contest) => Contest, opts?: { by?: string }): Promise<Contest | undefined>;
  /** Stores a fully-formed new contest (import, duplicate, sibling zone, advance-clone). */
  add(contest: Contest): Promise<void>;
  /** Stores the whole contest as this device's copy (the workspace autosave). */
  save(contest: Contest): Promise<void>;
  /** Deletes the contest and its checkpoints in one transaction. */
  remove(id: string): Promise<void>;
  subscribe(listener: (event: ContestEvent) => void): () => void;
  checkpoints: {
    /** A contest's checkpoints, newest first. */
    list(contestId: string): Promise<Checkpoint[]>;
    /** Snapshots `contest` as a named checkpoint; bumps the stored contest's version in the same transaction. */
    save(contest: Contest, name: string, note?: string): Promise<Checkpoint>;
    /**
     * Restores a checkpoint over `current` (the live working copy), undoably: the
     * pre-restore state is auto-checkpointed in the same transaction. Returns the
     * restored contest.
     */
    restore(current: Contest, checkpointId: string): Promise<Contest>;
    /** Updates a checkpoint's note (trimmed). No-op if it is gone. */
    setNote(checkpointId: string, note: string): Promise<void>;
    remove(checkpointId: string): Promise<void>;
  };
  /** Sync engine seam (until A5 folds the engine in): the upload bundle for one contest. */
  bundleFor(id: string): Promise<{ name: string; updatedAt: string; payload: string } | undefined>;
  /** Sync engine seam: writes a pulled contest and its checkpoints; emits a `remote` event. */
  applyRemote(remote: RemoteBundle): Promise<void>;
  /** Closes the database handle (tests; a reload in production). */
  close(): Promise<void>;
}

export interface LibraryDeps {
  /** Production: the browser's `indexedDB`; tests: a fake-indexeddb `IDBFactory`. */
  idb: IDBFactory;
  /** ISO timestamp for checkpoint stamps and restores. */
  clock: () => string;
}

/* ────────────────────────── record shape (private) ────────────────────────── */

/**
 * The stored contest: the summary fields denormalized beside the versioned
 * envelope. Summary fields are optional because records written before a given
 * field existed lack it (`summaryFromRecord` falls back to the payload).
 */
type ContestRecord = { id: string; name: string; updatedAt: string } & Partial<ContestSummary> & {
    /** Versioned envelope from serializeContest(); device-only fields never in it. */
    payload: string;
    /**
     * Device-only fields (Speechwire credentials), stored beside the payload so
     * the sync path, which reads only `payload`, can never ship them.
     */
    deviceOnly?: SpeechwireCredentials;
  };

interface OapDB extends DBSchema {
  contests: { key: string; value: ContestRecord };
  checkpoints: { key: string; value: Checkpoint; indexes: { byContest: string } };
}

const DB_NAME = 'oap-contest-manager';
const DB_VERSION = 2;

function openDatabase(factory: IDBFactory): Promise<IDBPDatabase<OapDB>> {
  const request = factory.open(DB_NAME, DB_VERSION);
  request.addEventListener('upgradeneeded', (event) => {
    const database = request.result;
    // Version-guarded so an existing device only adds the new stores.
    if (event.oldVersion < 1) database.createObjectStore('contests', { keyPath: 'id' });
    if (event.oldVersion < 2) {
      database.createObjectStore('checkpoints', { keyPath: 'id' }).createIndex('byContest', 'contestId');
    }
  });
  return wrap(request) as Promise<IDBPDatabase<OapDB>>;
}

/* ────────────────────────── pure helpers ────────────────────────── */

/**
 * The one place the denormalized listing fields are built. `version` is the
 * record's version; it defaults to the contest's own `updatedAt`.
 */
export function summarize(contest: Contest, version: string = contest.updatedAt): ContestSummary {
  return {
    id: contest.id,
    name: effectiveContestTitle(contest),
    updatedAt: version,
    contestDate: contest.details.contestDate,
    hostSchoolName: contest.identity.hostSchoolName,
    archived: contest.archived,
    contestLevel: contest.identity.contestLevel,
    classification: contest.identity.classification,
    contestYear: contest.identity.contestYear,
    district: contest.identity.district,
    zone: contest.identity.zone,
  };
}

/** The summary keys, derived from `summarize` so the field list lives in one place. */
let summaryKeys: (keyof ContestSummary)[] | undefined;
function keysOfSummary(): (keyof ContestSummary)[] {
  summaryKeys ??= Object.keys(summarize(createContest({ id: 'k', now: '1970-01-01T00:00:00.000Z' }))) as (keyof ContestSummary)[];
  return summaryKeys;
}

/** A record's summary, parsing the payload once only for a legacy record missing a field. */
function summaryFromRecord(record: ContestRecord): ContestSummary {
  const stored: Partial<ContestSummary> = {};
  let complete = true;
  for (const key of keysOfSummary()) {
    if (record[key] === undefined) complete = false;
    else (stored as Record<string, unknown>)[key] = record[key];
  }
  if (complete) return stored as ContestSummary;
  // Stored values win; the payload only fills the gaps.
  return { ...summarize(parseContest(record.payload), record.updatedAt), ...stored };
}

function contestFromRecord(record: ContestRecord): Contest {
  // Re-attach this device's credentials (parseContest hydrates them blank).
  return { ...parseContest(record.payload), speechwire: record.deviceOnly ?? defaultSpeechwire() };
}

function toRecord(contest: Contest, version: string, deviceOnly: SpeechwireCredentials): ContestRecord {
  return { ...summarize(contest, version), payload: serializeContest(contest), deviceOnly };
}

/**
 * The version rule: the later of the contest's `updatedAt` and one millisecond
 * past the stored version, so a save after pulling a copy stamped by a device
 * whose clock runs ahead still counts as newer.
 */
export function nextVersion(contestUpdatedAt: string, storedVersion: string | undefined): string {
  if (storedVersion === undefined) return contestUpdatedAt;
  const floor = Date.parse(storedVersion) + 1;
  const own = Date.parse(contestUpdatedAt);
  if (Number.isNaN(floor)) return contestUpdatedAt;
  return !Number.isNaN(own) && own >= floor ? contestUpdatedAt : new Date(floor).toISOString();
}

/* ────────────────────────── the library ────────────────────────── */

export function createContestLibrary(deps: LibraryDeps): ContestLibrary {
  let dbPromise: Promise<IDBPDatabase<OapDB>> | undefined;
  const db = () => (dbPromise ??= openDatabase(deps.idb));
  const listeners = new Set<(event: ContestEvent) => void>();

  function emit(event: ContestEvent): void {
    for (const listener of listeners) listener(event);
  }

  type Tx = IDBPTransaction<OapDB, ['contests', 'checkpoints'], 'readwrite'>;
  async function readWrite(): Promise<Tx> {
    return (await db()).transaction(['contests', 'checkpoints'], 'readwrite');
  }

  /**
   * The single commit path for a device write: the version rule, the summary,
   * and the put, inside the caller's transaction. Returns the event to emit once
   * the transaction completes.
   */
  async function commitDevice(tx: Tx, contest: Contest, by?: string): Promise<ContestEvent> {
    const store = tx.objectStore('contests');
    const stored = await store.get(contest.id);
    const record = toRecord(contest, nextVersion(contest.updatedAt, stored?.updatedAt), contest.speechwire);
    await store.put(record);
    return { type: 'changed', id: contest.id, origin: 'device', by, contest, summary: summaryFromRecord(record) };
  }

  /** Moves a stored contest's version for a checkpoint-only change. Undefined if not stored. */
  async function bumpForCheckpoint(tx: Tx, contestId: string, now: string): Promise<ContestEvent | undefined> {
    const store = tx.objectStore('contests');
    const stored = await store.get(contestId);
    if (!stored) return undefined;
    const record = { ...stored, updatedAt: nextVersion(now, stored.updatedAt) };
    await store.put(record);
    return {
      type: 'changed',
      id: contestId,
      origin: 'device',
      contest: contestFromRecord(record),
      summary: summaryFromRecord(record),
    };
  }

  async function finish(tx: Tx, ...events: (ContestEvent | undefined)[]): Promise<void> {
    await tx.done;
    for (const event of events) if (event) emit(event);
  }

  async function writeWhole(contest: Contest): Promise<void> {
    const tx = await readWrite();
    const event = await commitDevice(tx, contest);
    await finish(tx, event);
  }

  return {
    async list() {
      return (await (await db()).getAll('contests')).map(summaryFromRecord);
    },

    async read(id) {
      const record = await (await db()).get('contests', id);
      return record ? contestFromRecord(record) : undefined;
    },

    async readAll() {
      return (await (await db()).getAll('contests')).map(contestFromRecord);
    },

    async transform(id, fn, opts) {
      const tx = await readWrite();
      const record = await tx.objectStore('contests').get(id);
      if (!record) {
        await tx.done;
        return undefined;
      }
      const fresh = contestFromRecord(record);
      const next = fn(fresh);
      if (next === fresh) {
        await tx.done;
        return fresh;
      }
      const event = await commitDevice(tx, next, opts?.by);
      await finish(tx, event);
      return next;
    },

    add: writeWhole,
    save: writeWhole,

    async remove(id) {
      const tx = await readWrite();
      await tx.objectStore('contests').delete(id);
      const checkpoints = tx.objectStore('checkpoints');
      for (const key of await checkpoints.index('byContest').getAllKeys(id)) await checkpoints.delete(key);
      await finish(tx, { type: 'removed', id, origin: 'device' });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    checkpoints: {
      async list(contestId) {
        const records = await (await db()).getAllFromIndex('checkpoints', 'byContest', contestId);
        return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      },

      async save(contest, name, note = '') {
        const now = deps.clock();
        const checkpoint = makeCheckpoint(contest, name, note, now);
        const tx = await readWrite();
        await tx.objectStore('checkpoints').put(checkpoint);
        // Checkpoints ride the contest's sync bundle, so the contest's version moves with them.
        const event = await bumpForCheckpoint(tx, contest.id, now);
        await finish(tx, event);
        return checkpoint;
      },

      async restore(current, checkpointId) {
        const tx = await readWrite();
        const target = await tx.objectStore('checkpoints').get(checkpointId);
        if (!target) {
          await tx.done;
          throw new Error('Checkpoint not found.');
        }
        const plan = planRestore(current, target, deps.clock());
        await tx.objectStore('checkpoints').put(plan.autoCheckpoint);
        const event = await commitDevice(tx, plan.restored);
        await finish(tx, event);
        return plan.restored;
      },

      async setNote(checkpointId, note) {
        const tx = await readWrite();
        const existing = await tx.objectStore('checkpoints').get(checkpointId);
        if (!existing) {
          await tx.done;
          return;
        }
        await tx.objectStore('checkpoints').put({ ...existing, note: note.trim() });
        const event = await bumpForCheckpoint(tx, existing.contestId, deps.clock());
        await finish(tx, event);
      },

      async remove(checkpointId) {
        const tx = await readWrite();
        const existing = await tx.objectStore('checkpoints').get(checkpointId);
        if (!existing) {
          await tx.done;
          return;
        }
        await tx.objectStore('checkpoints').delete(checkpointId);
        const event = await bumpForCheckpoint(tx, existing.contestId, deps.clock());
        await finish(tx, event);
      },
    },

    async bundleFor(id) {
      const tx = (await db()).transaction(['contests', 'checkpoints'], 'readonly');
      const record = await tx.objectStore('contests').get(id);
      const checkpoints = record ? await tx.objectStore('checkpoints').index('byContest').getAll(id) : [];
      await tx.done;
      if (!record) return undefined;
      checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        name: record.name,
        updatedAt: record.updatedAt,
        // The envelope already lacks device-only fields, so no credential reaches the wire.
        payload: bundleFromEnvelope(record.payload, checkpoints),
      };
    },

    async applyRemote(remote) {
      const { contest, checkpoints } = parseSyncBundle(remote.payload);
      const tx = await readWrite();
      const contests = tx.objectStore('contests');
      const existing = await contests.get(contest.id);
      // The server's clock is stored as the version; this device's credentials are kept.
      const deviceOnly = existing?.deviceOnly ?? contest.speechwire;
      const record = toRecord(contest, remote.updatedAt, deviceOnly);
      await contests.put(record);
      // Checkpoints are replaced wholesale, so they ride the same LWW resolution.
      const store = tx.objectStore('checkpoints');
      for (const key of await store.index('byContest').getAllKeys(contest.id)) await store.delete(key);
      for (const checkpoint of checkpoints) await store.put(checkpoint);
      await finish(tx, {
        type: 'changed',
        id: contest.id,
        origin: 'remote',
        contest: contestFromRecord(record),
        summary: summaryFromRecord(record),
      });
    },

    async close() {
      if (dbPromise) (await dbPromise).close();
      dbPromise = undefined;
    },
  };
}

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
 * Convergence with the server (slice A5 #281) lives behind `library.sync`
 * (the loop itself is the private librarySync.ts): every `device` write marks
 * the contest for a push, pulls are written through the same commit path as
 * `remote` events (so a pull never bounces back up as a push, and every
 * listener, including the dashboard list, hears about it), and a delete is a
 * durable tombstone, removed in the same transaction as the contest and its
 * checkpoints, that the next server pass sends even after a reload. A server
 * delete that wins removes the local copy and puts an open session in `removed`.
 *
 * Open-contest sessions (slice A2 #278): `open(id)` hands the workspace a live
 * in-memory copy that owns the debounced write, the "unedited draft is not
 * stored" rule, and the flush on close and on `flush()` (pagehide). Every other
 * write to an open contest (a pull, a `transform`, an add, a checkpoint restore)
 * goes through the session too, so the workspace never autosaves a stale copy
 * over it: a newer pull swaps the session and sets `notice`; a newer session
 * edit survives the pull and is pushed.
 *
 * Followers (slice A3 #279): `follow(name, handler)` runs background work (the
 * judge roster publisher, the questionnaire answer follower) on data events
 * and on `reconciled`, the event for a completed server pass, instead of on the
 * UI's sync status. The library owns the timing: nothing before the first
 * server pass, bursts coalesced, single-flight with rerun, a follower's own
 * writes kept out of its next batch, and a failed run retried at the next
 * event or wake.
 *
 * No React, no `window`, no `fetch`: IndexedDB, the server port, the clock, the
 * timers, connectivity and wake are injected, so tests run against
 * fake-indexeddb and the in-memory server with a manual clock and timers.
 */
import { wrap, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { autoCheckpointsToPrune, makeCheckpoint, planRestore, type Checkpoint } from '../model/checkpoint';
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
import type { ContestServer, RemoteContest } from './contestServer';
import { createSyncLoop, type LocalSide, type Online, type SyncLoop, type SyncStatus } from './librarySync';

export type { Online, SyncStatus };

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

/** `device` = a write made on this device; `remote` = a pull or a delete from the server. */
export type Origin = 'device' | 'remote';

export type ContestEvent =
  | { type: 'changed'; id: string; origin: Origin; by?: string; contest: Contest; summary: ContestSummary }
  | { type: 'removed'; id: string; origin: Origin }
  /** A full server pass completed: this device's copy reflects the server. */
  | { type: 'reconciled' };

/**
 * What a follower is handed (slice A3 #279): everything that happened since its
 * last successful run, coalesced. A failed run's batch is folded into the next one.
 */
export interface FollowBatch {
  /** The follower's first batch (true until a run succeeds). */
  first: boolean;
  /** The batch includes a completed server pass. */
  reconciled: boolean;
  /** Changed contests, latest copy of each; excludes this follower's own writes. */
  changed: Contest[];
  /** Ids removed since the last run. */
  removed: string[];
  /** Every stored contest, parsed. */
  all(): Promise<Contest[]>;
  /** The library's transform, tagged with the follower's name so its writes skip its next batch. */
  transform: ContestLibrary['transform'];
}

/** What an open session holds. `getState()` returns a stable snapshot (for useSyncExternalStore). */
export type OpenState =
  | { status: 'loading' }
  | { status: 'missing' }
  /** Deleted while open. */
  | { status: 'removed'; origin: Origin }
  | { status: 'ready'; contest: Contest; notice: { origin: Origin; at: string } | null };

export interface OpenContest {
  getState(): OpenState;
  subscribe(listener: () => void): () => void;
  /** Synchronous: replaces the live copy and arms the debounced write. Never awaits. */
  set(next: Contest): void;
  update(fn: (contest: Contest) => Contest): void;
  dismissNotice(): void;
  checkpoints: {
    list(): Promise<Checkpoint[]>;
    save(name: string, note?: string): Promise<Checkpoint>;
    /** Auto-checkpoint + swap, counted as the session's own change (no notice). */
    restore(checkpointId: string): Promise<void>;
    setNote(checkpointId: string, note: string): Promise<void>;
    remove(checkpointId: string): Promise<void>;
  };
  /** Flushes any pending write and releases this handle. */
  close(): Promise<void>;
}

export interface ContestLibrary {
  /**
   * Opens a session on a contest. Handles opened on the same id share one live
   * copy. `draft` is a brand-new contest not in storage yet: it is stored only
   * after its first edit.
   */
  open(id: string, opts?: { draft?: Contest }): OpenContest;
  /** Writes every open session's pending edit now (pagehide). */
  flush(): Promise<void>;
  list(): Promise<ContestSummary[]>;
  read(id: string): Promise<Contest | undefined>;
  readAll(): Promise<Contest[]>;
  /**
   * Reads the stored contest, runs the pure `fn`, and persists the result, all in
   * ONE transaction. Returns undefined (and writes nothing) if the contest is
   * gone; returning the same object is a no-op with no event. If the contest is
   * open, `fn` runs on the session's live copy (unflushed edits included), the
   * session swaps to the result, and the result is written at once.
   */
  transform(id: string, fn: (fresh: Contest) => Contest, opts?: { by?: string }): Promise<Contest | undefined>;
  /** Stores a fully-formed new contest (import, duplicate, sibling zone, advance-clone). */
  add(contest: Contest): Promise<void>;
  /** Stores the whole contest as this device's copy (the workspace autosave). */
  save(contest: Contest): Promise<void>;
  /**
   * Deletes the contest and its checkpoints and writes a durable tombstone
   * stamped by the injected clock, in one transaction. The tombstone is the
   * delete queue: the next server pass sends it, even after a reload.
   */
  remove(id: string): Promise<void>;
  subscribe(listener: (event: ContestEvent) => void): () => void;
  /**
   * Runs `handler` on data events instead of UI status. The library owns when:
   * never before the first completed server pass after registering; bursts are
   * coalesced (FOLLOW_DEBOUNCE_MS); one run at a time, with a rerun if events
   * arrive meanwhile; the follower's own writes are left out of its next batch.
   * A run that throws keeps its batch for the next event or wake. Returns a stop.
   */
  follow(name: string, handler: (batch: FollowBatch) => Promise<void>): () => void;
  checkpoints: {
    /** A contest's checkpoints, newest first. */
    list(contestId: string): Promise<Checkpoint[]>;
    /** Snapshots `contest` as a named checkpoint; bumps the stored contest's version in the same transaction. */
    save(contest: Contest, name: string, note?: string): Promise<Checkpoint>;
    /**
     * Snapshots `contest` exactly as given (no flush: the caller passes the state
     * from BEFORE a destructive change) as an AUTOMATIC checkpoint labeled `name`,
     * then prunes that contest's automatic checkpoints to the newest
     * MAX_AUTO_CHECKPOINTS, in one transaction (#309). Named ones are untouched.
     */
    saveAuto(contest: Contest, name: string): Promise<Checkpoint>;
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
  /**
   * Convergence with the server, last-write-wins per contest with delete
   * tombstones. Inert (always `synced`) when the library has no server.
   */
  sync: {
    /** Starts the reconcile loop (a pass now, pushes, retries, wake, connectivity); returns disconnect. */
    connect(): () => void;
    status(): SyncStatus;
    /** Calls `listener` with the current status, then on every change. */
    onStatus(listener: (status: SyncStatus) => void): () => void;
    /** One full server pass now; emits `reconciled` when it completes. */
    reconcileNow(): Promise<void>;
  };
  /** Disconnects sync and closes the database handle (tests; a reload in production). */
  close(): Promise<void>;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface LibraryDeps {
  /** Production: the browser's `indexedDB`; tests: a fake-indexeddb `IDBFactory`. */
  idb: IDBFactory;
  /** ISO timestamp for checkpoint stamps, restores and notices. */
  clock: () => string;
  /** The session debounce's timers. Defaults to the global setTimeout/clearTimeout. */
  timers?: Timers;
  /**
   * Production: tab focus/visibility and a periodic tick (storage/browserWake.ts).
   * A wake reruns any follower whose last run failed, and asks a connected sync
   * for a (throttled) server pass.
   */
  wake?: (listener: () => void) => () => void;
  /** Production: the HTTP adapter (contestServer.ts); tests: the in-memory fake. Omitted: no sync. */
  server?: ContestServer;
  /** Production: navigator.onLine and the window events. Defaults to always online. */
  online?: Online;
  /** Retry delay for attempt n (0-based). Defaults to syncBackoff's backoffDelay. */
  backoff?: (attempt: number) => number;
}

/** How long an open session waits after the last edit before writing it. */
export const SAVE_DEBOUNCE_MS = 300;

/** How long a follower waits after the last event before running, so a burst is one run. */
export const FOLLOW_DEBOUNCE_MS = 1000;

const globalTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

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

/** A contest deleted on this device; kept until the server holds the delete. */
interface TombstoneRecord {
  id: string;
  deletedAt: string;
}

interface OapDB extends DBSchema {
  contests: { key: string; value: ContestRecord };
  checkpoints: { key: string; value: Checkpoint; indexes: { byContest: string } };
  tombstones: { key: string; value: TombstoneRecord };
}

const DB_NAME = 'oap-contest-manager';
const DB_VERSION = 3;

function openDatabase(factory: IDBFactory): Promise<IDBPDatabase<OapDB>> {
  const request = factory.open(DB_NAME, DB_VERSION);
  request.addEventListener('upgradeneeded', (event) => {
    const database = request.result;
    // Version-guarded so an existing device only adds the new stores.
    if (event.oldVersion < 1) database.createObjectStore('contests', { keyPath: 'id' });
    if (event.oldVersion < 2) {
      database.createObjectStore('checkpoints', { keyPath: 'id' }).createIndex('byContest', 'contestId');
    }
    if (event.oldVersion < 3) database.createObjectStore('tombstones', { keyPath: 'id' });
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

const alwaysOnline: Online = { isOnline: () => true, onChange: () => () => {} };

const laterThan = (a: string, b: string) => Date.parse(a) > Date.parse(b);

/* ────────────────────────── the library ────────────────────────── */

export function createContestLibrary(deps: LibraryDeps): ContestLibrary {
  let dbPromise: Promise<IDBPDatabase<OapDB>> | undefined;
  const db = () => (dbPromise ??= openDatabase(deps.idb));
  const timers = deps.timers ?? globalTimers;
  const listeners = new Set<(event: ContestEvent) => void>();

  function emit(event: ContestEvent): void {
    // Every device write (a save or a delete) is pushed; pulls never bounce back.
    if (event.type !== 'reconciled' && event.origin === 'device') sync?.markDirty(event.id);
    for (const listener of [...listeners]) listener(event);
  }

  type Tx = IDBPTransaction<OapDB, ['contests', 'checkpoints', 'tombstones'], 'readwrite'>;
  async function readWrite(): Promise<Tx> {
    return (await db()).transaction(['contests', 'checkpoints', 'tombstones'], 'readwrite');
  }

  /**
   * The single commit path for a device write: the version rule, the summary,
   * and the put, inside the caller's transaction. Returns the event to emit once
   * the transaction completes.
   */
  async function commitDevice(tx: Tx, contest: Contest, by?: string): Promise<ContestEvent> {
    const store = tx.objectStore('contests');
    const stored = await store.get(contest.id);
    // Re-adding a deleted id must outrank its own delete, and replaces it.
    const tombstone = stored ? undefined : await tx.objectStore('tombstones').get(contest.id);
    if (tombstone) await tx.objectStore('tombstones').delete(contest.id);
    const floor = stored?.updatedAt ?? tombstone?.deletedAt;
    const record = toRecord(contest, nextVersion(contest.updatedAt, floor), contest.speechwire);
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

  /* ────────────────────────── open-contest sessions ────────────────────────── */

  interface Session {
    handles: number;
    state: OpenState;
    /** The live copy while `ready`. */
    live?: Contest;
    /** Whether a stored record backs this session (false for a draft not yet written). */
    stored: boolean;
    /** False only for a draft that has not been edited yet: it is never stored. */
    persistable: boolean;
    /** The live copy has edits not yet written. */
    dirty: boolean;
    timer?: unknown;
    /** A write that landed while the session was still loading wins over the load's read. */
    loadedOverride?: Contest;
    subscribers: Set<() => void>;
  }

  const sessions = new Map<string, Session>();
  /** Final flushes of sessions whose last handle closed; a reopen waits for them. */
  const closing = new Map<string, Promise<void>>();

  function setState(session: Session, state: OpenState): void {
    session.state = state;
    for (const subscriber of session.subscribers) subscriber();
  }

  function readySession(id: string): Session | undefined {
    const session = sessions.get(id);
    return session?.state.status === 'ready' ? session : undefined;
  }

  function cancelTimer(session: Session): void {
    if (session.timer !== undefined) timers.clear(session.timer);
    session.timer = undefined;
  }

  /** Writes the session's pending edit now. A failure leaves it pending for the next flush. */
  async function flushSession(session: Session, by?: string): Promise<void> {
    cancelTimer(session);
    if (!session.dirty || !session.live) return;
    const contest = session.live;
    session.dirty = false;
    try {
      const tx = await readWrite();
      const event = await commitDevice(tx, contest, by);
      await finish(tx, event);
      session.stored = true;
    } catch (err) {
      if (session.state.status === 'ready') session.dirty = true;
      throw err;
    }
  }

  function setLive(session: Session, next: Contest): void {
    const state = session.state;
    if (state.status !== 'ready' || next === session.live) return;
    session.live = next;
    // An unedited draft (updatedAt still equals createdAt) is not stored, so an
    // accidental "+ New Contest" click never creates a contest. The first real
    // edit bumps updatedAt and makes the session persistable for good.
    if (!session.persistable && next.updatedAt !== next.createdAt) session.persistable = true;
    if (session.persistable) {
      session.dirty = true;
      cancelTimer(session);
      session.timer = timers.set(() => {
        session.timer = undefined;
        void flushSession(session).catch(() => {});
      }, SAVE_DEBOUNCE_MS);
    }
    setState(session, { status: 'ready', contest: next, notice: state.notice });
  }

  /**
   * After a write that did not come from the session's own edits: the session
   * now holds what was stored. A loading session keeps it for when its read lands.
   */
  function adoptStored(id: string, contest: Contest, notice?: { origin: Origin; at: string }): void {
    const session = sessions.get(id);
    if (!session) return;
    if (session.state.status === 'loading') {
      session.loadedOverride = contest;
      return;
    }
    if (session.state.status !== 'ready') return;
    cancelTimer(session);
    session.live = contest;
    session.dirty = false;
    session.stored = true;
    session.persistable = true;
    setState(session, { status: 'ready', contest, notice: notice ?? session.state.notice });
  }

  function markRemoved(id: string, origin: Origin): void {
    const session = sessions.get(id);
    if (!session) return;
    cancelTimer(session);
    session.dirty = false;
    session.live = undefined;
    session.loadedOverride = undefined;
    setState(session, { status: 'removed', origin });
  }

  function startSession(id: string, draft: Contest | undefined): Session {
    const session: Session = {
      handles: 0,
      state: { status: 'loading' },
      stored: false,
      persistable: true,
      dirty: false,
      subscribers: new Set(),
    };
    if (draft && draft.id === id) {
      session.live = draft;
      session.persistable = draft.updatedAt !== draft.createdAt;
      session.state = { status: 'ready', contest: draft, notice: null };
      return session;
    }
    void (async () => {
      await closing.get(id);
      let contest: Contest | undefined;
      try {
        contest = await library.read(id);
      } catch {
        contest = undefined;
      }
      if (session.state.status !== 'loading') return; // removed while loading
      contest = session.loadedOverride ?? contest;
      session.loadedOverride = undefined;
      if (!contest) {
        setState(session, { status: 'missing' });
        return;
      }
      session.live = contest;
      session.stored = true;
      setState(session, { status: 'ready', contest, notice: null });
    })();
    return session;
  }

  /** Writes the open session's pending edit on `id`, if any, before another write to it. */
  async function flushIfOpen(id: string): Promise<Session | undefined> {
    const session = readySession(id);
    if (session) await flushSession(session);
    return session;
  }

  async function writeWhole(contest: Contest): Promise<void> {
    await flushIfOpen(contest.id);
    const tx = await readWrite();
    const event = await commitDevice(tx, contest);
    await finish(tx, event);
    adoptStored(contest.id, contest);
  }

  /* ────────────────────────── the server side (slice A5 #281) ────────────────────────── */

  /** Removes a stored contest and its checkpoints inside the caller's transaction. */
  async function deleteContestIn(tx: Tx, id: string): Promise<void> {
    await tx.objectStore('contests').delete(id);
    const checkpoints = tx.objectStore('checkpoints');
    for (const key of await checkpoints.index('byContest').getAllKeys(id)) await checkpoints.delete(key);
  }

  /**
   * An open session's pending edit is resolved before an outside write to its
   * contest, in that write's transaction: if it is newer than `than`, it is
   * stored (and so pushed) and true is returned; otherwise it is dropped.
   */
  async function keepNewerPending(tx: Tx, id: string, stored: ContestRecord | undefined, than: string): Promise<boolean> {
    const session = readySession(id);
    if (!session?.dirty || !session.live) return false;
    const pending = session.live;
    cancelTimer(session);
    session.dirty = false;
    if (!laterThan(nextVersion(pending.updatedAt, stored?.updatedAt), than)) return false;
    const event = await commitDevice(tx, pending);
    await finish(tx, event);
    session.stored = true;
    return true;
  }

  /** Writes a pulled contest and its checkpoints; emits a `remote` event. */
  async function applyRemote(remote: RemoteContest): Promise<void> {
    const { contest, checkpoints } = parseSyncBundle(remote.payload);
    const tx = await readWrite();
    const contests = tx.objectStore('contests');
    const existing = await contests.get(contest.id);
    if (await keepNewerPending(tx, contest.id, existing, remote.updatedAt)) return;
    // A local write or delete that landed after this pull was planned, and is
    // at least as new, wins (a delete wins a tie).
    const tombstone = existing ? undefined : await tx.objectStore('tombstones').get(contest.id);
    const local = existing?.updatedAt ?? tombstone?.deletedAt;
    if (local !== undefined && !laterThan(remote.updatedAt, local)) {
      await tx.done;
      return;
    }
    if (tombstone) await tx.objectStore('tombstones').delete(contest.id);

    // The server's clock is stored as the version; this device's credentials are kept.
    const deviceOnly = existing?.deviceOnly ?? contest.speechwire;
    const record = toRecord(contest, remote.updatedAt, deviceOnly);
    await contests.put(record);
    // Checkpoints are replaced wholesale, so they ride the same LWW resolution.
    const store = tx.objectStore('checkpoints');
    for (const key of await store.index('byContest').getAllKeys(contest.id)) await store.delete(key);
    for (const checkpoint of checkpoints) await store.put(checkpoint);
    const pulled = contestFromRecord(record);
    await finish(tx, {
      type: 'changed',
      id: contest.id,
      origin: 'remote',
      contest: pulled,
      summary: summaryFromRecord(record),
    });
    adoptStored(contest.id, pulled, { origin: 'remote', at: deps.clock() });
  }

  /** A server delete at `deletedAt` reached this device: removes the copy unless it is newer. */
  async function applyRemoteDelete(id: string, deletedAt: string): Promise<void> {
    const tx = await readWrite();
    const existing = await tx.objectStore('contests').get(id);
    if (await keepNewerPending(tx, id, existing, deletedAt)) return;
    if (!existing || laterThan(existing.updatedAt, deletedAt)) {
      await tx.done;
      return;
    }
    await deleteContestIn(tx, id);
    await finish(tx, { type: 'removed', id, origin: 'remote' });
    markRemoved(id, 'remote');
  }

  const local: LocalSide = {
    async state() {
      const tx = (await db()).transaction(['contests', 'tombstones'], 'readonly');
      const contests = (await tx.objectStore('contests').getAll()).map(({ id, updatedAt }) => ({ id, updatedAt }));
      const tombstones = await tx.objectStore('tombstones').getAll();
      await tx.done;
      return { contests, tombstones };
    },
    async bundle(id) {
      const tx = (await db()).transaction(['contests', 'checkpoints'], 'readonly');
      const record = await tx.objectStore('contests').get(id);
      const checkpoints = record ? await tx.objectStore('checkpoints').index('byContest').getAll(id) : [];
      await tx.done;
      if (!record) return undefined;
      checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        id,
        name: record.name,
        updatedAt: record.updatedAt,
        // The envelope already lacks device-only fields, so no credential reaches the server.
        payload: bundleFromEnvelope(record.payload, checkpoints),
      };
    },
    async tombstone(id) {
      return (await (await db()).get('tombstones', id))?.deletedAt;
    },
    applyRemote,
    applyRemoteDelete,
    async clearTombstone(id, deletedAt) {
      const tx = await readWrite();
      const tombstone = await tx.objectStore('tombstones').get(id);
      if (tombstone?.deletedAt === deletedAt) await tx.objectStore('tombstones').delete(id);
      await tx.done;
    },
    reconciled() {
      emit({ type: 'reconciled' });
    },
  };

  const sync: SyncLoop | undefined = deps.server
    ? createSyncLoop({
        server: deps.server,
        local,
        timers,
        online: deps.online ?? alwaysOnline,
        wake: deps.wake,
        now: () => Date.parse(deps.clock()),
        backoff: deps.backoff,
      })
    : undefined;
  /** Live sync connections, disconnected by close(). */
  const connections = new Set<() => void>();

  /* ────────────────────────── followers (slice A3 #279) ────────────────────────── */

  interface Accumulated {
    first: boolean;
    reconciled: boolean;
    changed: Map<string, Contest>;
    removed: Set<string>;
  }

  const emptyBatch = (first: boolean): Accumulated => ({
    first,
    reconciled: false,
    changed: new Map(),
    removed: new Set(),
  });
  const isEmptyBatch = (b: Accumulated) => !b.reconciled && b.changed.size === 0 && b.removed.size === 0;

  /** A failed batch folded under whatever arrived since (the newer news wins). */
  function foldFailed(failed: Accumulated, since: Accumulated): Accumulated {
    const changed = new Map(failed.changed);
    const removed = new Set(failed.removed);
    for (const [id, contest] of since.changed) {
      changed.set(id, contest);
      removed.delete(id);
    }
    for (const id of since.removed) {
      changed.delete(id);
      removed.add(id);
    }
    return { first: failed.first || since.first, reconciled: failed.reconciled || since.reconciled, changed, removed };
  }

  /** Retry kicks for followers whose last run failed; a wake fires them. */
  const failedFollowers = new Set<() => void>();
  const offWake = deps.wake?.(() => {
    for (const retry of [...failedFollowers]) retry();
  });

  function follow(name: string, handler: (batch: FollowBatch) => Promise<void>): () => void {
    let pending = emptyBatch(true);
    /** No run before a completed server pass seen since registering (a fresh device's empty store). */
    let sawReconcile = false;
    let timer: unknown;
    let running = false;
    let stopped = false;

    function arm(): void {
      if (stopped || !sawReconcile) return;
      if (timer !== undefined) timers.clear(timer);
      timer = timers.set(() => {
        timer = undefined;
        void drain();
      }, FOLLOW_DEBOUNCE_MS);
    }

    const retry = () => {
      if (!isEmptyBatch(pending)) arm();
    };

    async function drain(): Promise<void> {
      if (running || stopped) return;
      running = true;
      try {
        // A burst that arrives mid-run re-arms the debounce; the timer then takes over.
        while (!stopped && timer === undefined && !isEmptyBatch(pending)) {
          const taken = pending;
          pending = emptyBatch(false);
          try {
            await handler({
              first: taken.first,
              reconciled: taken.reconciled,
              changed: [...taken.changed.values()],
              removed: [...taken.removed],
              all: () => library.readAll(),
              transform: (id, fn) => library.transform(id, fn, { by: name }),
            });
            failedFollowers.delete(retry);
          } catch {
            // Kept for the next event or wake.
            pending = foldFailed(taken, pending);
            failedFollowers.add(retry);
            break;
          }
        }
      } finally {
        running = false;
      }
    }

    const off = library.subscribe((event) => {
      if (event.type === 'reconciled') {
        sawReconcile = true;
        pending.reconciled = true;
      } else if (event.type === 'changed') {
        if (event.by === name) {
          // Its own write: not news, but a stale copy already queued is replaced.
          if (pending.changed.has(event.id)) pending.changed.set(event.id, event.contest);
          return;
        }
        pending.changed.set(event.id, event.contest);
        pending.removed.delete(event.id);
      } else {
        pending.changed.delete(event.id);
        pending.removed.add(event.id);
      }
      arm();
    });

    return () => {
      stopped = true;
      off();
      if (timer !== undefined) timers.clear(timer);
      timer = undefined;
      failedFollowers.delete(retry);
    };
  }

  const library: ContestLibrary = {
    follow,

    open(id, opts) {
      let session = sessions.get(id);
      if (!session) {
        session = startSession(id, opts?.draft);
        sessions.set(id, session);
      }
      const s = session;
      s.handles += 1;
      let closed = false;
      return {
        getState: () => s.state,
        subscribe(listener) {
          s.subscribers.add(listener);
          return () => s.subscribers.delete(listener);
        },
        set: (next) => setLive(s, next),
        update(fn) {
          if (s.state.status === 'ready' && s.live) setLive(s, fn(s.live));
        },
        dismissNotice() {
          if (s.state.status === 'ready' && s.state.notice) setState(s, { ...s.state, notice: null });
        },
        checkpoints: {
          list: () => library.checkpoints.list(id),
          async save(name, note) {
            if (!s.live) throw new Error('The contest is not open.');
            return library.checkpoints.save(s.live, name, note);
          },
          async restore(checkpointId) {
            if (!s.live) throw new Error('The contest is not open.');
            await library.checkpoints.restore(s.live, checkpointId);
          },
          setNote: (checkpointId, note) => library.checkpoints.setNote(checkpointId, note),
          remove: (checkpointId) => library.checkpoints.remove(checkpointId),
        },
        async close() {
          if (closed) return;
          closed = true;
          s.handles -= 1;
          if (s.handles > 0) {
            await flushSession(s);
            return;
          }
          if (sessions.get(id) === s) sessions.delete(id);
          const final = flushSession(s).catch(() => {});
          closing.set(id, final);
          await final;
          if (closing.get(id) === final) closing.delete(id);
        },
      };
    },

    async flush() {
      await Promise.all([...sessions.values()].map((session) => flushSession(session).catch(() => {})));
    },

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
      const session = readySession(id);
      if (session?.stored && session.live) {
        // The live copy is the freshest: it holds the edits the debounce has not written yet.
        const fresh = session.live;
        const next = fn(fresh);
        if (next === fresh) return fresh;
        setLive(session, next);
        await flushSession(session, opts?.by);
        return next;
      }
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
      adoptStored(id, next);
      return next;
    },

    add: writeWhole,
    save: writeWhole,

    async remove(id) {
      const tx = await readWrite();
      const stored = await tx.objectStore('contests').get(id);
      await deleteContestIn(tx, id);
      if (stored) {
        // The version rule again: a clock running behind cannot stamp the delete older than the copy it deletes.
        await tx.objectStore('tombstones').put({ id, deletedAt: nextVersion(deps.clock(), stored.updatedAt) });
      }
      await finish(tx, { type: 'removed', id, origin: 'device' });
      markRemoved(id, 'device');
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
        // An open contest is snapshotted as its session holds it, after writing its pending edit.
        const session = await flushIfOpen(contest.id);
        const subject = session?.live ?? contest;
        const now = deps.clock();
        const checkpoint = makeCheckpoint(subject, name, note, now);
        const tx = await readWrite();
        await tx.objectStore('checkpoints').put(checkpoint);
        // Checkpoints ride the contest's sync bundle, so the contest's version moves with them.
        const event = await bumpForCheckpoint(tx, contest.id, now);
        await finish(tx, event);
        return checkpoint;
      },

      async saveAuto(contest, name) {
        // Captured synchronously, before any await, so a change the caller makes
        // right after this call can never leak into the snapshot.
        const checkpoint: Checkpoint = { ...makeCheckpoint(contest, name, '', deps.clock()), auto: true };
        const tx = await readWrite();
        const store = tx.objectStore('checkpoints');
        await store.put(checkpoint);
        for (const id of autoCheckpointsToPrune(await store.index('byContest').getAll(contest.id))) {
          await store.delete(id);
        }
        const event = await bumpForCheckpoint(tx, contest.id, checkpoint.createdAt);
        await finish(tx, event);
        return checkpoint;
      },

      async restore(current, checkpointId) {
        const session = await flushIfOpen(current.id);
        const subject = session?.live ?? current;
        const tx = await readWrite();
        const target = await tx.objectStore('checkpoints').get(checkpointId);
        if (!target) {
          await tx.done;
          throw new Error('Checkpoint not found.');
        }
        const plan = planRestore(subject, target, deps.clock());
        await tx.objectStore('checkpoints').put(plan.autoCheckpoint);
        const event = await commitDevice(tx, plan.restored);
        await finish(tx, event);
        // The session's own change: it swaps without a notice.
        adoptStored(current.id, plan.restored);
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

    sync: {
      connect() {
        if (!sync) return () => {};
        const disconnect = sync.connect();
        const off = () => {
          connections.delete(off);
          disconnect();
        };
        connections.add(off);
        return off;
      },
      status: () => (sync ? sync.status() : 'synced'),
      onStatus(listener) {
        if (sync) return sync.onStatus(listener);
        listener('synced');
        return () => {};
      },
      reconcileNow: async () => {
        await sync?.reconcileNow();
      },
    },

    async close() {
      offWake?.();
      for (const disconnect of [...connections]) disconnect();
      if (dbPromise) (await dbPromise).close();
      dbPromise = undefined;
    },
  };
  return library;
}

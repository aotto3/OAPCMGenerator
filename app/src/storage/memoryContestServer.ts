/**
 * An in-memory account on the contest API, for tests (RFC #276, slice A5 #281).
 * Not a test file: library, follower and questionnaire tests share it.
 *
 * `client` speaks the HTTP sync client's language (SyncHttpError with the
 * server's status and body) and implements the server's tombstone rules from
 * #280; the shared case table in server/test/tombstoneScenarios.json is
 * asserted against both this fake and the real routes, so it cannot drift.
 * `server` is the library's port, built over `client` by the same adapter the
 * app uses, so two libraries on one fake model two devices on one account.
 */
import { serializeSyncBundle } from '../model/syncBundle';
import type { Checkpoint } from '../model/checkpoint';
import { effectiveContestTitle, type Contest } from '../model/contest';
import { contestServerFromClient, type ContestServer } from './contestServer';
import { SyncHttpError, SyncNetworkError, type RemoteContest, type SyncClient } from './syncClient';

export interface ServerCall {
  method: 'list' | 'get' | 'create' | 'update' | 'remove';
  id?: string;
  deletedAt?: string;
  /** The request body as sent (for writes). */
  body?: unknown;
}

export interface MemoryContestServer {
  client: SyncClient;
  server: ContestServer;
  contests: Map<string, RemoteContest>;
  tombstones: Map<string, string>;
  calls: ServerCall[];
  /** False: every call fails with a network error. */
  reachable: boolean;
  /** Fails the next `count` calls (of `method`, or any) with this error. */
  failNext(error: unknown, count?: number, method?: ServerCall['method']): void;
  /** Runs before each `get` answers (to race a local write against a pull). */
  beforeGet?: (id: string) => Promise<void> | void;
  /** Stores a contest as another device would have pushed it. */
  seed(contest: Contest, opts?: { version?: string; checkpoints?: Checkpoint[] }): void;
}

const ms = (iso: string) => Date.parse(iso);

export function createMemoryContestServer(): MemoryContestServer {
  const contests = new Map<string, RemoteContest>();
  const tombstones = new Map<string, string>();
  const calls: ServerCall[] = [];
  const failures: { error: unknown; method?: ServerCall['method'] }[] = [];

  function enter(call: ServerCall): void {
    calls.push(call);
    if (!fake.reachable) throw new SyncNetworkError();
    const index = failures.findIndex((f) => f.method === undefined || f.method === call.method);
    if (index >= 0) throw failures.splice(index, 1)[0].error;
  }

  /** The tombstone gate for a write: 410 unless the write is strictly newer (ties go to the delete). */
  function gate(id: string, updatedAt: string): void {
    const deletedAt = tombstones.get(id);
    if (deletedAt !== undefined && !(ms(updatedAt) > ms(deletedAt))) {
      throw new SyncHttpError(410, { error: 'Contest was deleted', deletedAt });
    }
  }

  const client: SyncClient = {
    async list() {
      enter({ method: 'list' });
      return {
        contests: [...contests.values()].map(({ id, name, updatedAt }) => ({ id, name, updatedAt })),
        tombstones: [...tombstones].map(([id, deletedAt]) => ({ id, deletedAt })),
      };
    },
    async get(id) {
      enter({ method: 'get', id });
      await fake.beforeGet?.(id);
      const record = contests.get(id);
      if (!record) throw new SyncHttpError(404, { error: 'Not found' });
      return { ...record };
    },
    async create(body) {
      enter({ method: 'create', id: body.id, body });
      gate(body.id, body.updatedAt);
      if (contests.has(body.id)) throw new SyncHttpError(409, { error: 'A contest with this id already exists' });
      tombstones.delete(body.id);
      contests.set(body.id, { ...body });
    },
    async update(id, body) {
      enter({ method: 'update', id, body });
      gate(id, body.updatedAt);
      // A newer write to a missing row is 404 and keeps the tombstone for the follow-up POST.
      if (!contests.has(id)) throw new SyncHttpError(404, { error: 'Not found' });
      tombstones.delete(id);
      contests.set(id, { id, ...body });
    },
    async remove(id, deletedAt) {
      enter({ method: 'remove', id, deletedAt });
      const existing = contests.get(id);
      if (deletedAt === undefined) {
        // Legacy delete: no tombstone, and a missing row is 404.
        if (!existing) throw new SyncHttpError(404, { error: 'Not found' });
        contests.delete(id);
        return;
      }
      if (existing && ms(existing.updatedAt) > ms(deletedAt)) {
        throw new SyncHttpError(409, { error: 'Contest was edited after the delete', updatedAt: existing.updatedAt });
      }
      contests.delete(id);
      const stored = tombstones.get(id);
      if (stored === undefined || ms(deletedAt) > ms(stored)) tombstones.set(id, deletedAt);
    },
  };

  const fake: MemoryContestServer = {
    client,
    server: contestServerFromClient(client),
    contests,
    tombstones,
    calls,
    reachable: true,
    failNext(error, count = 1, method) {
      for (let i = 0; i < count; i++) failures.push({ error, method });
    },
    seed(contest, opts = {}) {
      contests.set(contest.id, {
        id: contest.id,
        name: effectiveContestTitle(contest),
        updatedAt: opts.version ?? contest.updatedAt,
        payload: serializeSyncBundle(contest, opts.checkpoints ?? []),
      });
    },
  };
  return fake;
}

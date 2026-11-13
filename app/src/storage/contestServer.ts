/**
 * The contest library's server port (RFC #276, slice A5 #281) and its adapter
 * over the HTTP sync client. The library only ever sees this shape: a list of
 * contests and delete tombstones, a get, a put that reports `gone` when a
 * newer-or-equal delete beat it (410), and a remove that reports `newer` when
 * the server copy was edited after the delete (409).
 *
 * The adapter hides the wire details: PUT-404-then-POST for a contest the
 * server has never seen, and a 404 from DELETE (an older server, or a row
 * already gone) counting as done. Transient and auth failures pass through as
 * the client's SyncNetworkError / SyncHttpError, which the library's retry
 * policy classifies.
 *
 * Device-only fields cannot reach the server through this port: a
 * `RemoteContest` carries only the opaque sync bundle, which never holds them.
 */
import {
  createBrowserSyncClient,
  SyncHttpError,
  type RemoteContest,
  type RemoteSummary,
  type SyncClient,
  type Tombstone,
} from './syncClient';

export type { RemoteContest, RemoteSummary, Tombstone };

export interface ContestServer {
  list(): Promise<{ contests: RemoteSummary[]; tombstones: Tombstone[] }>;
  get(id: string): Promise<RemoteContest>;
  /** Stores the contest; `gone` when the server holds a delete at or after its version. */
  put(contest: RemoteContest): Promise<{ ok: true } | { gone: string }>;
  /** Deletes as of `deletedAt`; `newer` when the server copy was edited after it. */
  remove(id: string, deletedAt: string): Promise<{ ok: true } | { newer: string }>;
}

/** A string field of an error body, or undefined. */
function bodyField(err: SyncHttpError, key: string): string | undefined {
  const body = err.body as Record<string, unknown> | undefined;
  const value = body?.[key];
  return typeof value === 'string' ? value : undefined;
}

/** A 410 carrying the server's delete time, or undefined for any other failure. */
function goneAt(err: unknown): string | undefined {
  return err instanceof SyncHttpError && err.status === 410 ? bodyField(err, 'deletedAt') : undefined;
}

export function contestServerFromClient(client: SyncClient): ContestServer {
  return {
    list: () => client.list(),
    get: (id) => client.get(id),

    async put({ id, name, updatedAt, payload }) {
      try {
        try {
          await client.update(id, { name, updatedAt, payload });
        } catch (err) {
          // First push of a contest the server has never seen: PUT 404, so create it.
          if (!(err instanceof SyncHttpError && err.status === 404)) throw err;
          await client.create({ id, name, updatedAt, payload });
        }
        return { ok: true };
      } catch (err) {
        const deletedAt = goneAt(err);
        if (deletedAt !== undefined) return { gone: deletedAt };
        throw err;
      }
    },

    async remove(id, deletedAt) {
      try {
        await client.remove(id, deletedAt);
        return { ok: true };
      } catch (err) {
        if (err instanceof SyncHttpError && err.status === 409) {
          const updatedAt = bodyField(err, 'updatedAt');
          if (updatedAt !== undefined) return { newer: updatedAt };
        }
        // Already gone (an older server answers 404) is the outcome we wanted.
        if (err instanceof SyncHttpError && err.status === 404) return { ok: true };
        throw err;
      }
    },
  };
}

/** The production server port: the deployed API through the shared transport. */
export function createHttpContestServer(fetchImpl?: typeof fetch): ContestServer {
  return contestServerFromClient(createBrowserSyncClient(fetchImpl));
}

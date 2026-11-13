/**
 * The network boundary for sync: a thin, typed wrapper over the server's
 * per-account contest CRUD (Slice 13) and its delete tombstones (#280). This is
 * the ONLY file in the sync layer that calls fetch; the library talks to the
 * `ContestServer` port (contestServer.ts), which is built over this client, so
 * tests inject the in-memory fake and never touch the network.
 *
 * Transport (origin, credentials, JSON) is the shared `api/http.ts`; this file
 * keeps the contest endpoints and classifies failures for the library's retry
 * policy: a dropped connection is a SyncNetworkError (transient); a non-2xx
 * response is a SyncHttpError carrying its status and body (5xx/429 transient,
 * 401 auth-lost, 404/409/410 handled structurally by the port).
 */
import { ApiHttpError, ApiNetworkError, createApi } from '../api/http';

export interface RemoteSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface RemoteContest extends RemoteSummary {
  /** Opaque sync bundle: { schemaVersion, contest, checkpoints }. */
  payload: string;
}

/** A delete the server recorded (#280): the contest stays deleted unless a newer write arrives. */
export interface Tombstone {
  id: string;
  deletedAt: string;
}

export interface ContestWrite {
  id: string;
  name: string;
  updatedAt: string;
  payload: string;
}

/** The connection dropped / never reached the server — always worth retrying. */
export class SyncNetworkError extends Error {
  constructor(message = 'Network request failed') {
    super(message);
    this.name = 'SyncNetworkError';
  }
}

/** The server answered non-2xx. `status` drives the retry policy; `body` carries 409/410 details. */
export class SyncHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown = undefined,
  ) {
    super(`Server responded ${status}`);
    this.name = 'SyncHttpError';
  }
}

/** Whether an error should be retried with backoff rather than surfaced/dropped. */
export function isTransient(err: unknown): boolean {
  if (err instanceof SyncNetworkError) return true;
  if (err instanceof SyncHttpError) return err.status >= 500 || err.status === 429;
  return false;
}

/** Session expired / not signed in — stop and wait for re-auth, don't retry-spam. */
export function isAuthError(err: unknown): boolean {
  return err instanceof SyncHttpError && err.status === 401;
}

export interface SyncClient {
  /** The account's contests and delete tombstones (an older server sends none). */
  list(): Promise<{ contests: RemoteSummary[]; tombstones: Tombstone[] }>;
  get(id: string): Promise<RemoteContest>;
  create(body: ContestWrite): Promise<void>;
  update(id: string, body: Omit<ContestWrite, 'id'>): Promise<void>;
  /** With `deletedAt`, a tombstone-aware delete (409 when the server copy is newer); without, the legacy delete. */
  remove(id: string, deletedAt?: string): Promise<void>;
}

/** Maps the shared transport's errors onto the sync layer's own classes. */
function toSyncError(err: unknown): unknown {
  if (err instanceof ApiNetworkError) return new SyncNetworkError();
  if (err instanceof ApiHttpError) return new SyncHttpError(err.status, err.body);
  return err;
}

/**
 * The production SyncClient talking to the deployed API, built on the shared
 * transport (`api/http.ts`). `fetchImpl` is injectable (defaulting to the global
 * fetch) so the request wiring and error classification are testable offline.
 */
export function createBrowserSyncClient(fetchImpl?: typeof fetch): SyncClient {
  const api = createApi(fetchImpl);
  const contestPath = (id: string) => `/api/contests/${encodeURIComponent(id)}`;
  async function call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw toSyncError(err);
    }
  }

  return {
    async list() {
      const body = await call(() =>
        api.get<{ contests: RemoteSummary[]; tombstones?: Tombstone[] }>('/api/contests'),
      );
      return { contests: body.contests, tombstones: body.tombstones ?? [] };
    },
    get(id) {
      return call(() => api.get<RemoteContest>(contestPath(id)));
    },
    async create(body) {
      await call(() => api.send('POST', '/api/contests', body));
    },
    async update(id, body) {
      await call(() => api.send('PUT', contestPath(id), body));
    },
    async remove(id, deletedAt) {
      const query = deletedAt === undefined ? '' : `?deletedAt=${encodeURIComponent(deletedAt)}`;
      await call(() => api.send('DELETE', `${contestPath(id)}${query}`));
    },
  };
}

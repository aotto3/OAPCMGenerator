/**
 * The network boundary for sync — a thin, typed wrapper over the server's
 * per-account contest CRUD (Slice 13). This is the ONLY file in the sync layer
 * that calls fetch; the engine talks to the SyncClient interface, so tests
 * inject a fake and never touch the network.
 *
 * Transport (origin, credentials, JSON) is the shared `api/http.ts`; this file
 * keeps the contest endpoints and classifies failures for the engine's retry
 * policy: a dropped connection is a SyncNetworkError (transient);
 * a non-2xx response is a SyncHttpError carrying its status (the engine decides
 * — 5xx/429 transient, 401 auth-lost, 404/409 handled structurally).
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

/** The server answered non-2xx. `status` drives the engine's handling. */
export class SyncHttpError extends Error {
  constructor(public readonly status: number) {
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
  list(): Promise<RemoteSummary[]>;
  get(id: string): Promise<RemoteContest>;
  create(body: ContestWrite): Promise<void>;
  update(id: string, body: Omit<ContestWrite, 'id'>): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Maps the shared transport's errors onto the sync layer's own classes. */
function toSyncError(err: unknown): unknown {
  if (err instanceof ApiNetworkError) return new SyncNetworkError();
  if (err instanceof ApiHttpError) return new SyncHttpError(err.status);
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
      const body = await call(() => api.get<{ contests: RemoteSummary[] }>('/api/contests'));
      return body.contests;
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
    async remove(id) {
      await call(() => api.send('DELETE', contestPath(id)));
    },
  };
}

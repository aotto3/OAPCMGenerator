/**
 * The network boundary for sync — a thin, typed wrapper over the server's
 * per-account contest CRUD (Slice 13). This is the ONLY file in the sync layer
 * that calls fetch; the engine talks to the SyncClient interface, so tests
 * inject a fake and never touch the network.
 *
 * Requests are credentialed (the Better Auth session cookie rides along, as in
 * authClient.ts) and point at VITE_API_URL. Failures are classified for the
 * engine's retry policy: a dropped connection is a SyncNetworkError (transient);
 * a non-2xx response is a SyncHttpError carrying its status (the engine decides
 * — 5xx/429 transient, 401 auth-lost, 404/409 handled structurally).
 */

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

const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8080').replace(/\/+$/, '');

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      credentials: 'include',
      headers: init.body ? { 'content-type': 'application/json' } : undefined,
      ...init,
    });
  } catch {
    // fetch rejects only on network-level failure (offline, DNS, CORS preflight).
    throw new SyncNetworkError();
  }
  if (!res.ok) throw new SyncHttpError(res.status);
  return res;
}

/** The production SyncClient talking to the deployed API. */
export function createBrowserSyncClient(): SyncClient {
  return {
    async list() {
      const res = await request('/api/contests');
      const body = (await res.json()) as { contests: RemoteSummary[] };
      return body.contests;
    },
    async get(id) {
      const res = await request(`/api/contests/${encodeURIComponent(id)}`);
      return (await res.json()) as RemoteContest;
    },
    async create(body) {
      await request('/api/contests', { method: 'POST', body: JSON.stringify(body) });
    },
    async update(id, body) {
      await request(`/api/contests/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    },
    async remove(id) {
      await request(`/api/contests/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}

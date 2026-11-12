/**
 * The app's one transport to its own API (RFC #270, slice B4). Every client
 * (sync, questionnaire, admin, telemetry) is an adapter over `createApi`, and
 * `authClient` takes its base URL from `apiUrl`. Nothing else derives the API
 * origin or sets credentials.
 *
 * Same-origin by default: in production the frontend host reverse-proxies
 * /api/* to the API (Slice 17, #46), so requests are relative and the Better
 * Auth session cookie is first-party. `VITE_API_URL` overrides the origin, e.g.
 * pointing a local build straight at a remote API.
 *
 * Failures come in two kinds so callers can map them to their own results:
 * - `ApiNetworkError`: fetch rejected (offline, DNS, CORS). Worth retrying.
 * - `ApiHttpError`: the server answered non-2xx; carries `status` and the
 *   parsed body (or undefined when there is none).
 */

/** Credentials mode for every API call that carries the session. */
export const API_CREDENTIALS: RequestCredentials = 'include';

/** The connection dropped or never reached the server. */
export class ApiNetworkError extends Error {
  constructor(message = 'Network request failed') {
    super(message);
    this.name = 'ApiNetworkError';
  }
}

/** The server answered with a non-2xx status. */
export class ApiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown = undefined,
  ) {
    super(`Server responded ${status}`);
    this.name = 'ApiHttpError';
  }
}

/** The configured API origin with trailing slashes removed; '' means same-origin. */
function apiBase(): string {
  return (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
}

/** The full URL for an API path such as `/api/contests`. Relative unless overridden. */
export function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}

export interface RequestOptions {
  /** Send no cookies (the public questionnaire page). Default: the session rides along. */
  anonymous?: boolean;
  /** Let the request outlive a page unload (telemetry). */
  keepalive?: boolean;
}

export type SendMethod = 'POST' | 'PUT' | 'DELETE';

export interface Api {
  /** GET; resolves to the parsed JSON body, or undefined when empty. */
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  /** Send an optional JSON body; resolves to the parsed response body, or undefined when empty. */
  send<T = void>(method: SendMethod, path: string, body?: unknown, options?: RequestOptions): Promise<T>;
}

/** Parses a body as JSON when there is one; undefined for an empty or non-JSON body. */
async function readBody(res: Response): Promise<unknown> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return undefined;
  }
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Builds the transport. `fetchImpl` is injectable for tests; the default looks
 * up the global `fetch` at call time (so a stubbed global is honoured and the
 * browser's fetch is never called with a foreign `this`).
 */
export function createApi(fetchImpl: typeof fetch = (...args) => fetch(...args)): Api {
  async function request(
    method: string,
    path: string,
    body: unknown,
    options: RequestOptions = {},
  ): Promise<Response> {
    const init: RequestInit = {
      method,
      credentials: options.anonymous ? 'omit' : API_CREDENTIALS,
    };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    if (options.keepalive) init.keepalive = true;

    let res: Response;
    try {
      res = await fetchImpl(apiUrl(path), init);
    } catch (err) {
      throw new ApiNetworkError(err instanceof Error && err.message ? err.message : undefined);
    }
    if (!res.ok) throw new ApiHttpError(res.status, await readBody(res));
    return res;
  }

  return {
    async get<T>(path: string, options?: RequestOptions): Promise<T> {
      const res = await request('GET', path, undefined, options);
      return (await readBody(res)) as T;
    },
    async send<T = void>(method: SendMethod, path: string, body?: unknown, options?: RequestOptions): Promise<T> {
      const res = await request(method, path, body, options);
      return (await readBody(res)) as T;
    },
  };
}

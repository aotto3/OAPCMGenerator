/**
 * The sync network client, an adapter over the shared transport (api/http.ts).
 * `fetch` is injected so its endpoint wiring, credentialed same-origin requests,
 * and the mapping onto SyncHttpError / SyncNetworkError (which the engine's
 * retry policy depends on) are verifiable without the network.
 */
import { describe, expect, it } from 'vitest';
import {
  createBrowserSyncClient,
  isAuthError,
  isTransient,
  SyncHttpError,
  SyncNetworkError,
  type ContestWrite,
} from './syncClient';

/** A real Response carrying `body` as JSON (no body for 204). */
function response(status: number, body: unknown = {}): Response {
  return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status });
}

/** A fetch stub that records each call and replies via `responder`. */
function recordingFetch(responder: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return responder(String(input), init);
  }) as typeof fetch;
  return { fn, calls };
}

const headerOf = (init: RequestInit | undefined, name: string) =>
  (init?.headers as Record<string, string> | undefined)?.[name];

describe('createBrowserSyncClient — request wiring', () => {
  it('list() GETs /api/contests (credentialed) and returns the contests array', async () => {
    const summaries = [{ id: 'a', name: 'A', updatedAt: 't1' }];
    const { fn, calls } = recordingFetch(() => response(200, { contests: summaries }));
    const result = await createBrowserSyncClient(fn).list();
    expect(result).toEqual(summaries);
    expect(calls[0].url).toBe('/api/contests');
    expect(calls[0].init?.credentials).toBe('include');
  });

  it('get() GETs the URL-encoded contest path and parses the JSON body', async () => {
    const remote = { id: 'x/y', name: 'N', updatedAt: 't', payload: 'BUNDLE' };
    const { fn, calls } = recordingFetch(() => response(200, remote));
    const result = await createBrowserSyncClient(fn).get('x/y');
    expect(calls[0].url).toBe('/api/contests/x%2Fy');
    expect(result).toEqual(remote);
  });

  it('create() POSTs the body as JSON with a content-type header', async () => {
    const body: ContestWrite = { id: 'c1', name: 'N', updatedAt: 't', payload: 'P' };
    const { fn, calls } = recordingFetch(() => response(201));
    await createBrowserSyncClient(fn).create(body);
    expect(calls[0].url).toBe('/api/contests');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(body);
    expect(headerOf(calls[0].init, 'content-type')).toBe('application/json');
  });

  it('update() PUTs the body to the encoded contest path', async () => {
    const { fn, calls } = recordingFetch(() => response(200));
    await createBrowserSyncClient(fn).update('c 1', { name: 'N', updatedAt: 't', payload: 'P' });
    expect(calls[0].url).toBe('/api/contests/c%201');
    expect(calls[0].init?.method).toBe('PUT');
  });

  it('remove() DELETEs the encoded contest path', async () => {
    const { fn, calls } = recordingFetch(() => response(204));
    await createBrowserSyncClient(fn).remove('c1');
    expect(calls[0].url).toBe('/api/contests/c1');
    expect(calls[0].init?.method).toBe('DELETE');
  });
});

describe('createBrowserSyncClient — error mapping', () => {
  it('maps a rejected fetch (offline/DNS/CORS) to SyncNetworkError', async () => {
    const { fn } = recordingFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(createBrowserSyncClient(fn).list()).rejects.toBeInstanceOf(SyncNetworkError);
  });

  it('maps a non-2xx response to a SyncHttpError carrying the status', async () => {
    const { fn } = recordingFetch(() => response(404));
    await expect(createBrowserSyncClient(fn).get('missing')).rejects.toMatchObject({
      name: 'SyncHttpError',
      status: 404,
    });
  });
});

describe('error classification', () => {
  it('isTransient: network errors and 5xx/429 retry; 4xx (except 429) and unknown do not', () => {
    expect(isTransient(new SyncNetworkError())).toBe(true);
    expect(isTransient(new SyncHttpError(500))).toBe(true);
    expect(isTransient(new SyncHttpError(503))).toBe(true);
    expect(isTransient(new SyncHttpError(429))).toBe(true);
    expect(isTransient(new SyncHttpError(404))).toBe(false);
    expect(isTransient(new SyncHttpError(401))).toBe(false);
    expect(isTransient(new Error('other'))).toBe(false);
  });

  it('isAuthError: only a 401 is an auth-loss', () => {
    expect(isAuthError(new SyncHttpError(401))).toBe(true);
    expect(isAuthError(new SyncHttpError(403))).toBe(false);
    expect(isAuthError(new SyncNetworkError())).toBe(false);
  });
});

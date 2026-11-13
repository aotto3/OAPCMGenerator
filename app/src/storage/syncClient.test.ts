/**
 * The sync network client, an adapter over the shared transport (api/http.ts),
 * and the library's server port built on it (contestServer.ts, slice A5 #281).
 * `fetch` is injected so the endpoint wiring, credentialed same-origin requests,
 * the mapping onto SyncHttpError / SyncNetworkError (which the library's retry
 * policy depends on), and the port's 409/410/404 handling are verifiable
 * without the network.
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
import { createHttpContestServer } from './contestServer';

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
  it('list() GETs /api/contests (credentialed) and returns the contests and tombstones', async () => {
    const summaries = [{ id: 'a', name: 'A', updatedAt: 't1' }];
    const tombstones = [{ id: 'b', deletedAt: 't2' }];
    const { fn, calls } = recordingFetch(() => response(200, { contests: summaries, tombstones }));
    const result = await createBrowserSyncClient(fn).list();
    expect(result).toEqual({ contests: summaries, tombstones });
    expect(calls[0].url).toBe('/api/contests');
    expect(calls[0].init?.credentials).toBe('include');
  });

  it('list() from a server without tombstones reports none', async () => {
    const { fn } = recordingFetch(() => response(200, { contests: [] }));
    expect(await createBrowserSyncClient(fn).list()).toEqual({ contests: [], tombstones: [] });
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

  it('remove() DELETEs the encoded contest path, with deletedAt when given', async () => {
    const { fn, calls } = recordingFetch(() => response(204));
    await createBrowserSyncClient(fn).remove('c1');
    await createBrowserSyncClient(fn).remove('c1', '2026-09-01T09:00:00.000Z');
    expect(calls[0].url).toBe('/api/contests/c1');
    expect(calls[0].init?.method).toBe('DELETE');
    expect(calls[1].url).toBe('/api/contests/c1?deletedAt=2026-09-01T09%3A00%3A00.000Z');
  });
});

describe('createBrowserSyncClient — error mapping', () => {
  it('maps a rejected fetch (offline/DNS/CORS) to SyncNetworkError', async () => {
    const { fn } = recordingFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(createBrowserSyncClient(fn).list()).rejects.toBeInstanceOf(SyncNetworkError);
  });

  it('maps a non-2xx response to a SyncHttpError carrying the status and body', async () => {
    const { fn } = recordingFetch(() => response(404, { error: 'Not found' }));
    await expect(createBrowserSyncClient(fn).get('missing')).rejects.toMatchObject({
      name: 'SyncHttpError',
      status: 404,
      body: { error: 'Not found' },
    });
  });
});

describe('the HTTP ContestServer port', () => {
  const contest = { id: 'c1', name: 'N', updatedAt: '2026-09-01T10:00:00.000Z', payload: 'P' };

  it('put() PUTs, and creates with POST when the server has never seen the contest', async () => {
    const { fn, calls } = recordingFetch((_url, init) => (init?.method === 'PUT' ? response(404) : response(201)));
    expect(await createHttpContestServer(fn).put(contest)).toEqual({ ok: true });
    expect(calls.map((c) => c.init?.method)).toEqual(['PUT', 'POST']);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual(contest);
  });

  it('put() reports gone (410) with the server delete time, from PUT or the follow-up POST', async () => {
    const deletedAt = '2026-09-01T11:00:00.000Z';
    const gone = recordingFetch(() => response(410, { error: 'Contest was deleted', deletedAt }));
    expect(await createHttpContestServer(gone.fn).put(contest)).toEqual({ gone: deletedAt });
    const goneOnPost = recordingFetch((_url, init) =>
      init?.method === 'PUT' ? response(404) : response(410, { deletedAt }),
    );
    expect(await createHttpContestServer(goneOnPost.fn).put(contest)).toEqual({ gone: deletedAt });
  });

  it('remove() sends deletedAt; 409 is newer, 204 and 404 are done', async () => {
    const at = '2026-09-01T09:00:00.000Z';
    const ok = recordingFetch(() => response(204));
    expect(await createHttpContestServer(ok.fn).remove('c1', at)).toEqual({ ok: true });
    expect(ok.calls[0].url).toContain('deletedAt=');
    const newer = recordingFetch(() => response(409, { updatedAt: contest.updatedAt }));
    expect(await createHttpContestServer(newer.fn).remove('c1', at)).toEqual({ newer: contest.updatedAt });
    const missing = recordingFetch(() => response(404));
    expect(await createHttpContestServer(missing.fn).remove('c1', at)).toEqual({ ok: true });
  });

  it('passes transient and auth failures through for the retry policy', async () => {
    const down = recordingFetch(() => response(503));
    await expect(createHttpContestServer(down.fn).put(contest)).rejects.toMatchObject({ status: 503 });
    const signedOut = recordingFetch(() => response(401));
    await expect(createHttpContestServer(signedOut.fn).remove('c1', 't')).rejects.toMatchObject({ status: 401 });
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

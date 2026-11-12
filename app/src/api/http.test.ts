/**
 * The shared API transport (RFC #270, B4). Every client is built on it, so the
 * origin, credentials, JSON handling and error kinds are pinned here once.
 * `fetch` is injected; no network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiHttpError, ApiNetworkError, apiUrl, createApi } from './http';

function recordingFetch(responder: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return responder();
  }) as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('apiUrl', () => {
  it('is relative (same-origin) when no API origin is configured', () => {
    vi.stubEnv('VITE_API_URL', '');
    expect(apiUrl('/api/contests')).toBe('/api/contests');
  });

  it('joins a configured origin, dropping its trailing slashes', () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test//');
    expect(apiUrl('/api/contests')).toBe('https://api.example.test/api/contests');
  });

  it('createApi requests go to the joined URL', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test/');
    const { fn, calls } = recordingFetch(() => json(200, {}));
    await createApi(fn).get('/api/x');
    expect(calls[0].url).toBe('https://api.example.test/api/x');
  });
});

describe('createApi requests', () => {
  it('get sends a credentialed GET with no body and parses the JSON reply', async () => {
    const { fn, calls } = recordingFetch(() => json(200, { a: 1 }));
    await expect(createApi(fn).get('/api/thing')).resolves.toEqual({ a: 1 });
    expect(calls[0].url).toBe('/api/thing');
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[0].init?.credentials).toBe('include');
    expect(calls[0].init?.body).toBeUndefined();
    expect(calls[0].init?.headers).toBeUndefined();
  });

  it('send serialises the body as JSON with a content-type header', async () => {
    const { fn, calls } = recordingFetch(() => json(200, { ok: true }));
    const out = await createApi(fn).send('PUT', '/api/thing', { name: 'N' });
    expect(out).toEqual({ ok: true });
    expect(calls[0].init?.method).toBe('PUT');
    expect(calls[0].init?.credentials).toBe('include');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ name: 'N' });
    expect((calls[0].init?.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('send without a body sets no body or content-type, and an empty reply resolves undefined', async () => {
    const { fn, calls } = recordingFetch(() => new Response(null, { status: 204 }));
    await expect(createApi(fn).send('DELETE', '/api/thing/1')).resolves.toBeUndefined();
    expect(calls[0].init?.body).toBeUndefined();
    expect(calls[0].init?.headers).toBeUndefined();
  });

  it('anonymous requests send no cookies; keepalive is passed through', async () => {
    const { fn, calls } = recordingFetch(() => new Response(null, { status: 204 }));
    await createApi(fn).send('POST', '/api/public', { x: 1 }, { anonymous: true, keepalive: true });
    expect(calls[0].init?.credentials).toBe('omit');
    expect(calls[0].init?.keepalive).toBe(true);
  });
});

describe('createApi errors', () => {
  it('a non-2xx reply becomes ApiHttpError with the status and parsed body', async () => {
    const { fn } = recordingFetch(() => json(429, { error: 'slow down' }));
    const err = await createApi(fn).get('/api/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiHttpError);
    expect(err).toMatchObject({ status: 429, body: { error: 'slow down' } });
  });

  it('a non-2xx reply with no body still carries the status', async () => {
    const { fn } = recordingFetch(() => new Response(null, { status: 404 }));
    await expect(createApi(fn).send('DELETE', '/api/x')).rejects.toMatchObject({
      name: 'ApiHttpError',
      status: 404,
      body: undefined,
    });
  });

  it('a rejected fetch becomes ApiNetworkError', async () => {
    const { fn } = recordingFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(createApi(fn).get('/api/x')).rejects.toBeInstanceOf(ApiNetworkError);
  });
});

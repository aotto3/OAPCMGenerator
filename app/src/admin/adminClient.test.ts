/**
 * The admin client over the shared transport: event-filter query building, the
 * admin probe (any failure is "not admin"), the resend-link 429 mapping, and the
 * error message the panel shows. `fetch` is injected.
 */
import { describe, expect, it } from 'vitest';
import { createAdminClient } from './adminClient';

function recordingFetch(responder: () => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return responder();
  }) as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

describe('fetchEvents query string', () => {
  it('sends only paging when no filters are set', async () => {
    const { fn, calls } = recordingFetch(() => json(200, { events: [], total: 0 }));
    await createAdminClient(fn).fetchEvents({ limit: 50, offset: 0 });
    expect(calls[0].url).toBe('/api/admin/events?limit=50&offset=0');
    expect(calls[0].init?.credentials).toBe('include');
  });

  it('adds every set filter, encoded, and omits empty ones', async () => {
    const { fn, calls } = recordingFetch(() => json(200, { events: [], total: 0 }));
    await createAdminClient(fn).fetchEvents({
      limit: 25,
      offset: 50,
      userId: 'u1',
      type: 'contest.updated',
      contestId: '',
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-12T23:59:59.999Z',
      text: 'a&b c',
    });
    const url = new URL(calls[0].url, 'http://x.test');
    expect(url.pathname).toBe('/api/admin/events');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: '25',
      offset: '50',
      userId: 'u1',
      type: 'contest.updated',
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-12T23:59:59.999Z',
      text: 'a&b c',
    });
  });
});

describe('admin probe and errors', () => {
  it('probeAdmin is true on 2xx and false on 404 or a network failure', async () => {
    expect(await createAdminClient(recordingFetch(() => json(200, { admin: true })).fn).probeAdmin()).toBe(true);
    expect(await createAdminClient(recordingFetch(() => json(404)).fn).probeAdmin()).toBe(false);
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await createAdminClient(offline).probeAdmin()).toBe(false);
  });

  it('a failed read rejects with the message the panel shows', async () => {
    const { fn } = recordingFetch(() => json(500));
    await expect(createAdminClient(fn).fetchStats()).rejects.toThrow('Admin request failed: 500');
  });

  it('window queries are added only when given', async () => {
    const { fn, calls } = recordingFetch(() => json(200, { groups: [] }));
    const client = createAdminClient(fn);
    await client.fetchErrorGroups();
    await client.fetchErrorGroups(7);
    expect(calls.map((c) => c.url)).toEqual(['/api/admin/errors', '/api/admin/errors?window=7']);
  });
});

describe('resendSignInLink', () => {
  it('POSTs to the encoded user path; 2xx is sent, 429 is rate-limited, others throw', async () => {
    const ok = recordingFetch(() => json(200, { ok: true }));
    expect(await createAdminClient(ok.fn).resendSignInLink('u/1')).toBe('sent');
    expect(ok.calls[0].url).toBe('/api/admin/users/u%2F1/resend-signin');
    expect(ok.calls[0].init?.method).toBe('POST');

    expect(await createAdminClient(recordingFetch(() => json(429)).fn).resendSignInLink('u1')).toBe(
      'rate-limited',
    );
    await expect(
      createAdminClient(recordingFetch(() => json(502)).fn).resendSignInLink('u1'),
    ).rejects.toThrow('Admin request failed: 502');
  });
});

/**
 * The templates client (PRD #320): the endpoints it calls, the device copy it
 * keeps per account and serves offline, and how a refused or offline save is
 * reported. `fetch` and storage are injected.
 */
import { describe, expect, it } from 'vitest';
import { createTemplatesClient, deviceKey, type DeviceStorage, type EmailTemplate } from './templatesClient';

const T1: EmailTemplate = {
  id: 't1',
  name: 'Hotel info',
  subject: 'Hotels',
  body: 'Near {{venueName}}',
  createdAt: '2026-11-13T10:00:00.000Z',
  updatedAt: '2026-11-13T10:00:00.000Z',
};
const T2: EmailTemplate = { ...T1, id: 't2', name: 'Thanks' };

function memoryStorage(initial: Record<string, string> = {}): DeviceStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

function recordingFetch(responder: () => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return responder();
  }) as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

const offline = (async () => {
  throw new TypeError('Failed to fetch');
}) as typeof fetch;

describe('list', () => {
  it('a server answer is returned and replaces the device copy', async () => {
    const storage = memoryStorage({ [deviceKey('alice')]: JSON.stringify([T2]) });
    const { fn, calls } = recordingFetch(() => json(200, { templates: [T1] }));
    const client = createTemplatesClient({ userId: 'alice', fetchImpl: fn, storage });
    expect(await client.list()).toEqual({ kind: 'server', templates: [T1] });
    expect(calls[0].url).toBe('/api/templates');
    expect(calls[0].init?.credentials).toBe('include');
    expect(client.saved()).toEqual([T1]);
  });

  it('offline, the device copy is returned', async () => {
    const storage = memoryStorage({ [deviceKey('alice')]: JSON.stringify([T1]) });
    const client = createTemplatesClient({ userId: 'alice', fetchImpl: offline, storage });
    expect(await client.list()).toEqual({ kind: 'device', templates: [T1] });
  });

  it('a server error also falls back to the device copy and leaves it alone', async () => {
    const storage = memoryStorage({ [deviceKey('alice')]: JSON.stringify([T1]) });
    const { fn } = recordingFetch(() => json(500));
    const client = createTemplatesClient({ userId: 'alice', fetchImpl: fn, storage });
    expect(await client.list()).toEqual({ kind: 'device', templates: [T1] });
    expect(client.saved()).toEqual([T1]);
  });

  it('the device copy is per account', async () => {
    const storage = memoryStorage();
    const { fn } = recordingFetch(() => json(200, { templates: [T1] }));
    await createTemplatesClient({ userId: 'alice', fetchImpl: fn, storage }).list();
    expect(createTemplatesClient({ userId: 'bob', fetchImpl: offline, storage }).saved()).toEqual([]);
  });

  it('no storage, or a garbled device copy, means no device copy', async () => {
    expect(await createTemplatesClient({ userId: 'a', fetchImpl: offline, storage: null }).list()).toEqual({
      kind: 'device',
      templates: [],
    });
    const garbled = memoryStorage({ [deviceKey('a')]: '{not json' });
    expect(createTemplatesClient({ userId: 'a', fetchImpl: offline, storage: garbled }).saved()).toEqual([]);
  });

  it('a storage that throws never breaks a list', async () => {
    const throwing: DeviceStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const { fn } = recordingFetch(() => json(200, { templates: [T1] }));
    expect(await createTemplatesClient({ userId: 'a', fetchImpl: fn, storage: throwing }).list()).toEqual({
      kind: 'server',
      templates: [T1],
    });
  });
});

describe('create', () => {
  const input = { name: 'Thanks', subject: 'Hotels', body: 'Near {{venueName}}' };

  it('posts the template and adds the saved one to the device copy', async () => {
    const storage = memoryStorage({ [deviceKey('alice')]: JSON.stringify([T1]) });
    const { fn, calls } = recordingFetch(() => json(201, { template: T2 }));
    const client = createTemplatesClient({ userId: 'alice', fetchImpl: fn, storage });
    expect(await client.create(input)).toEqual({ kind: 'saved', template: T2 });
    expect(calls[0].url).toBe('/api/templates');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(input);
    expect(client.saved()).toEqual([T1, T2]);
  });

  it('offline: reported, and the device copy is unchanged', async () => {
    const storage = memoryStorage({ [deviceKey('alice')]: JSON.stringify([T1]) });
    const client = createTemplatesClient({ userId: 'alice', fetchImpl: offline, storage });
    expect(await client.create(input)).toEqual({ kind: 'offline' });
    expect(client.saved()).toEqual([T1]);
  });

  it('a refusal carries the server’s reason', async () => {
    const { fn } = recordingFetch(() => json(400, { error: 'duplicate_name' }));
    const client = createTemplatesClient({ userId: 'alice', fetchImpl: fn, storage: memoryStorage() });
    expect(await client.create(input)).toEqual({ kind: 'invalid', problem: 'duplicate_name' });
    expect(client.saved()).toEqual([]);
  });

  it('any other failure is an error', async () => {
    for (const res of [json(400, { error: 'invalid_body' }), json(401), json(500), json(201, {})]) {
      const client = createTemplatesClient({ userId: 'a', fetchImpl: async () => res, storage: memoryStorage() });
      expect(await client.create(input)).toEqual({ kind: 'error' });
    }
  });
});

describe('update', () => {
  const input = { name: 'Hotel details', subject: 'New', body: 'New body' };
  const edited: EmailTemplate = { ...T1, ...input, updatedAt: '2026-11-13T11:00:00.000Z' };

  it('puts the template and replaces it in place in the device copy', async () => {
    const storage = memoryStorage({ [deviceKey('alice')]: JSON.stringify([T1, T2]) });
    const { fn, calls } = recordingFetch(() => json(200, { template: edited }));
    const client = createTemplatesClient({ userId: 'alice', fetchImpl: fn, storage });
    expect(await client.update('t1', input)).toEqual({ kind: 'saved', template: edited });
    expect(calls[0].url).toBe('/api/templates/t1');
    expect(calls[0].init?.method).toBe('PUT');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(input);
    expect(client.saved()).toEqual([edited, T2]);
  });

  it('offline or refused: reported, device copy unchanged', async () => {
    const storage = memoryStorage({ [deviceKey('alice')]: JSON.stringify([T1]) });
    expect(await createTemplatesClient({ userId: 'alice', fetchImpl: offline, storage }).update('t1', input)).toEqual({
      kind: 'offline',
    });
    const { fn } = recordingFetch(() => json(400, { error: 'duplicate_name' }));
    const client = createTemplatesClient({ userId: 'alice', fetchImpl: fn, storage });
    expect(await client.update('t1', input)).toEqual({ kind: 'invalid', problem: 'duplicate_name' });
    expect(client.saved()).toEqual([T1]);
  });

  it('a template deleted elsewhere is not_found and leaves the device copy', async () => {
    const storage = memoryStorage({ [deviceKey('alice')]: JSON.stringify([T1, T2]) });
    const { fn } = recordingFetch(() => json(404));
    const client = createTemplatesClient({ userId: 'alice', fetchImpl: fn, storage });
    expect(await client.update('t1', input)).toEqual({ kind: 'not_found' });
    expect(client.saved()).toEqual([T2]);
  });
});

describe('remove', () => {
  it('deletes on the server, then from the device copy', async () => {
    const storage = memoryStorage({ [deviceKey('alice')]: JSON.stringify([T1, T2]) });
    const { fn, calls } = recordingFetch(() => new Response(null, { status: 204 }));
    const client = createTemplatesClient({ userId: 'alice', fetchImpl: fn, storage });
    expect(await client.remove('t1')).toEqual({ kind: 'deleted' });
    expect(calls[0].url).toBe('/api/templates/t1');
    expect(calls[0].init?.method).toBe('DELETE');
    expect(client.saved()).toEqual([T2]);
  });

  it('already gone on the server counts as deleted', async () => {
    const storage = memoryStorage({ [deviceKey('alice')]: JSON.stringify([T1]) });
    const { fn } = recordingFetch(() => json(404));
    const client = createTemplatesClient({ userId: 'alice', fetchImpl: fn, storage });
    expect(await client.remove('t1')).toEqual({ kind: 'deleted' });
    expect(client.saved()).toEqual([]);
  });

  it('offline or failed: reported, device copy unchanged', async () => {
    const storage = memoryStorage({ [deviceKey('alice')]: JSON.stringify([T1]) });
    expect(await createTemplatesClient({ userId: 'alice', fetchImpl: offline, storage }).remove('t1')).toEqual({
      kind: 'offline',
    });
    const client = createTemplatesClient({ userId: 'alice', fetchImpl: async () => json(500), storage });
    expect(await client.remove('t1')).toEqual({ kind: 'error' });
    expect(client.saved()).toEqual([T1]);
  });
});

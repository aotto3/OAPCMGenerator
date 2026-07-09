/**
 * Telemetry client unit tests (Slice #58). The load-bearing guarantees: a send
 * NEVER rejects — a failing endpoint, a network error, or a non-2xx response is
 * swallowed so no user-facing path can break — and a client-error report is
 * truncated and carries the app version. The fetch call is stubbed; no network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APP_VERSION,
  MAX_ERROR_MESSAGE,
  clientErrorDetail,
  reportClientError,
  sendTelemetry,
  truncateMessage,
} from './telemetryClient';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendTelemetry failure-swallowing', () => {
  it('resolves (never rejects) when fetch rejects — offline / network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(sendTelemetry({ type: 'client.error' })).resolves.toBeUndefined();
  });

  it('resolves when the endpoint answers non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(sendTelemetry({ type: 'documents.generated' })).resolves.toBeUndefined();
  });

  it('posts the payload as JSON to the telemetry endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    await sendTelemetry({ type: 'contest.exported', contestId: 'c1', contestName: 'Spring' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/telemetry$/);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toEqual({
      type: 'contest.exported',
      contestId: 'c1',
      contestName: 'Spring',
    });
  });

  it('reportClientError does not throw even when fetch throws synchronously', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('sync boom');
      }),
    );
    // A synchronous throw from fetch must not escape the fire-and-forget report.
    expect(() => reportClientError('boom')).not.toThrow();
  });
});

describe('client-error detail', () => {
  it('leaves a short message intact and attaches the app version', () => {
    const detail = clientErrorDetail('TypeError: x is not a function');
    expect(detail.message).toBe('TypeError: x is not a function');
    expect(detail.appVersion).toBe(APP_VERSION);
    expect(typeof detail.appVersion).toBe('string');
  });

  it('truncates an oversized message', () => {
    const long = 'x'.repeat(MAX_ERROR_MESSAGE + 500);
    const out = truncateMessage(long);
    expect(out.length).toBe(MAX_ERROR_MESSAGE + 1); // sliced + ellipsis
    expect(out.endsWith('…')).toBe(true);
    expect(clientErrorDetail(long).message).toBe(out);
  });
});

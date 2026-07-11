/**
 * Unit tests for the pure error-triage module — inputs → outputs at the module
 * boundary, no I/O. `fingerprint` must collapse same-bug/different-instance
 * messages to one key while keeping genuinely different messages apart;
 * `groupErrors` must compute count, first/last-seen ordering, affected-user
 * counts, and the latest app version.
 */
import { describe, expect, it } from 'vitest';
import { fingerprint, groupErrors, type ErrorGroup } from '../src/errorTriage';
import type { EventRecord } from '../src/eventLog';

let seq = 0;
function err(occurredAt: string, userId: string, message: string, appVersion = '1.0.0'): EventRecord {
  return {
    seq: ++seq,
    occurredAt,
    userId,
    userEmail: `${userId}@x.test`,
    type: 'client.error',
    detail: { message, appVersion },
  };
}

describe('fingerprint', () => {
  it('collapses the same bug with different volatile values', () => {
    expect(fingerprint('Failed to load contest 123')).toBe(fingerprint('Failed to load contest 456'));
    expect(fingerprint('Timeout after 30.5s')).toBe(fingerprint('Timeout after 12s'));
    expect(fingerprint('GET https://api.test/a/1 failed')).toBe(fingerprint('GET https://api.test/b/2 failed'));
    expect(fingerprint('bad id 550e8400-e29b-41d4-a716-446655440000')).toBe(
      fingerprint('bad id 6ba7b810-9dad-11d1-80b4-00c04fd430c8'),
    );
    expect(fingerprint('Unknown field "author"')).toBe(fingerprint("Unknown field 'publisher'"));
  });

  it('is case- and whitespace-insensitive', () => {
    expect(fingerprint('  Network   Request  Failed ')).toBe(fingerprint('network request failed'));
  });

  it('keeps genuinely different messages apart', () => {
    expect(fingerprint('Cannot read property x of undefined')).not.toBe(fingerprint('Network request failed'));
    expect(fingerprint('Failed to load contest 1')).not.toBe(fingerprint('Failed to save contest 1'));
  });
});

describe('groupErrors', () => {
  it('groups occurrences and computes count, seen-bounds, affected users, latest version', () => {
    const events = [
      err('2026-03-01T10:00:00.000Z', 'alice', 'Failed to load contest 1', '1.0.0'),
      err('2026-03-02T10:00:00.000Z', 'bob', 'Failed to load contest 2', '1.1.0'),
      err('2026-03-03T10:00:00.000Z', 'alice', 'Failed to load contest 3', '1.2.0'),
      err('2026-03-01T09:00:00.000Z', 'carol', 'Network request failed', '1.0.0'),
    ];
    const groups = groupErrors(events);
    expect(groups).toHaveLength(2);

    const load = groups.find((g) => g.sampleMessage.startsWith('Failed to load')) as ErrorGroup;
    expect(load.count).toBe(3);
    expect(load.affectedUsers).toBe(2); // alice (x2) + bob
    expect(load.firstSeen).toBe('2026-03-01T10:00:00.000Z');
    expect(load.lastSeen).toBe('2026-03-03T10:00:00.000Z');
    // Sample + version come from the most recent occurrence.
    expect(load.sampleMessage).toBe('Failed to load contest 3');
    expect(load.latestAppVersion).toBe('1.2.0');
  });

  it('orders groups most-recent first', () => {
    const events = [
      err('2026-03-01T00:00:00.000Z', 'a', 'Old bug'),
      err('2026-03-10T00:00:00.000Z', 'b', 'Fresh bug'),
      err('2026-03-05T00:00:00.000Z', 'c', 'Middle bug'),
    ];
    expect(groupErrors(events).map((g) => g.sampleMessage)).toEqual(['Fresh bug', 'Middle bug', 'Old bug']);
  });

  it('is order-independent for first/last-seen (events may arrive newest-first)', () => {
    const newestFirst = [
      err('2026-03-03T00:00:00.000Z', 'a', 'Boom 3'),
      err('2026-03-02T00:00:00.000Z', 'a', 'Boom 2'),
      err('2026-03-01T00:00:00.000Z', 'b', 'Boom 1'),
    ];
    const [g] = groupErrors(newestFirst);
    expect(g.count).toBe(3);
    expect(g.firstSeen).toBe('2026-03-01T00:00:00.000Z');
    expect(g.lastSeen).toBe('2026-03-03T00:00:00.000Z');
    expect(g.affectedUsers).toBe(2);
  });

  it('tolerates a missing/oddly-shaped detail', () => {
    const events: EventRecord[] = [
      { seq: 100, occurredAt: '2026-03-01T00:00:00.000Z', userId: 'a', userEmail: 'a@x.test', type: 'client.error' },
      { seq: 101, occurredAt: '2026-03-01T01:00:00.000Z', userId: 'b', userEmail: 'b@x.test', type: 'client.error', detail: 'raw string error' },
    ];
    const groups = groupErrors(events);
    // Empty-message group + the raw-string group.
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(2);
    const raw = groups.find((g) => g.sampleMessage === 'raw string error');
    expect(raw?.latestAppVersion).toBeUndefined();
  });

  it('returns nothing for no events', () => {
    expect(groupErrors([])).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  bundleFromEnvelope,
  parseSyncBundle,
  serializeSyncBundle,
} from './syncBundle';
import { makeCheckpoint, type Checkpoint } from './checkpoint';
import {
  createContest,
  serializeContest,
  withSpeechwire,
  type Contest,
} from './contest';

const NOW = '2026-07-07T12:00:00.000Z';

function contestWithCredentials(): Contest {
  const base = createContest({ id: 'contest-1', now: NOW });
  // Real, distinctive Speechwire credentials that must NEVER reach the wire.
  return withSpeechwire(base, { username: 'sw-user-SECRET', password: 'sw-pass-SECRET' }, NOW);
}

describe('serializeSyncBundle / parseSyncBundle', () => {
  it('round-trips a contest with its checkpoints', () => {
    const contest = createContest({ id: 'contest-1', now: NOW });
    const checkpoints: Checkpoint[] = [
      makeCheckpoint(contest, 'first', 'a note', NOW, 'cp-1'),
      makeCheckpoint(contest, 'second', '', NOW, 'cp-2'),
    ];

    const bundle = serializeSyncBundle(contest, checkpoints);
    const parsed = parseSyncBundle(bundle);

    expect(parsed.contest.id).toBe('contest-1');
    expect(parsed.checkpoints.map((c) => c.id)).toEqual(['cp-1', 'cp-2']);
    expect(parsed.checkpoints[0]).toMatchObject({ name: 'first', note: 'a note', contestId: 'contest-1' });
  });

  it('carries the contest envelope the server expects (schemaVersion + contest)', () => {
    const contest = createContest({ id: 'contest-1', now: NOW });
    const bundle = JSON.parse(serializeSyncBundle(contest, []));
    expect(typeof bundle.schemaVersion).toBe('number');
    expect(bundle.contest.id).toBe('contest-1');
    expect(Array.isArray(bundle.checkpoints)).toBe(true);
  });

  // The device-only guarantee, asserted at the wire level (issue #27 AC).
  it('NEVER puts Speechwire credentials on the wire', () => {
    const contest = contestWithCredentials();
    const checkpoints = [makeCheckpoint(contest, 'cp', '', NOW, 'cp-1')];

    const wire = serializeSyncBundle(contest, checkpoints);

    expect(wire).not.toContain('speechwire');
    expect(wire).not.toContain('sw-user-SECRET');
    expect(wire).not.toContain('sw-pass-SECRET');
  });

  it('rehydrates device-only credentials blank on parse', () => {
    const wire = serializeSyncBundle(contestWithCredentials(), []);
    const parsed = parseSyncBundle(wire);
    expect(parsed.contest.speechwire).toEqual({ username: '', password: '' });
  });

  it('bundleFromEnvelope reuses stored envelope bytes verbatim (no re-serialization)', () => {
    const contest = createContest({ id: 'contest-1', now: NOW });
    const envelope = serializeContest(contest);
    const bundle = JSON.parse(bundleFromEnvelope(envelope, []));
    expect(JSON.stringify(bundle.contest)).toBe(JSON.stringify(JSON.parse(envelope).contest));
  });

  it('tolerates a missing/garbage checkpoints field by treating it as empty', () => {
    const contest = createContest({ id: 'contest-1', now: NOW });
    const envelope = JSON.parse(serializeContest(contest));

    expect(parseSyncBundle(JSON.stringify(envelope)).checkpoints).toEqual([]);
    expect(parseSyncBundle(JSON.stringify({ ...envelope, checkpoints: 'nope' })).checkpoints).toEqual([]);
    expect(
      parseSyncBundle(JSON.stringify({ ...envelope, checkpoints: [{ bad: true }, null] })).checkpoints,
    ).toEqual([]);
  });

  it('rejects non-JSON and non-object bundles', () => {
    expect(() => parseSyncBundle('not json')).toThrow(/not valid JSON/);
    expect(() => parseSyncBundle('42')).toThrow(/not an object/);
  });
});

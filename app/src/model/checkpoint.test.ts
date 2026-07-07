import { describe, expect, it } from 'vitest';
import {
  beforeRestoreName,
  checkpointContest,
  makeCheckpoint,
  planRestore,
  type Checkpoint,
} from './checkpoint';
import {
  createContest,
  parseContest,
  serializeContest,
  withIdentity,
  withSpeechwire,
  type Contest,
} from './contest';
import { fixtureContest } from '../documents/__fixtures__/fixtureContest';

const NOW = '2026-07-07T12:00:00.000Z';
const LATER = '2026-07-08T09:30:00.000Z';

describe('makeCheckpoint', () => {
  it('captures the contest id, trimmed name/note, timestamp, and a serialized snapshot', () => {
    const contest = fixtureContest();
    const cp = makeCheckpoint(contest, '  before judges  ', '  note here  ', NOW, 'cp-1');

    expect(cp).toMatchObject({
      id: 'cp-1',
      contestId: contest.id,
      name: 'before judges',
      note: 'note here',
      createdAt: NOW,
    });
    // Payload is exactly what the model codec produces — no bespoke format.
    expect(cp.payload).toBe(serializeContest(contest));
  });

  it('defaults the note to blank and mints an id when none is given', () => {
    const cp = makeCheckpoint(fixtureContest(), 'snap', '', NOW);
    expect(cp.note).toBe('');
    expect(typeof cp.id).toBe('string');
    expect(cp.id.length).toBeGreaterThan(0);
  });
});

describe('checkpoint codec round-trip (AC: checkpoints round-trip through the model codec)', () => {
  it('contest → checkpoint → restore yields an equivalent record, minus device-only fields', () => {
    const original = withSpeechwire(fixtureContest(), { username: 'sw-user', password: 'secret' }, NOW);

    const restored = checkpointContest(makeCheckpoint(original, 'snap', '', NOW));

    // Device-only Speechwire is stripped by the codec and hydrated blank.
    expect(restored.speechwire).toEqual({ username: '', password: '' });
    // Everything else survives the round trip untouched.
    expect(restored).toEqual({ ...original, speechwire: { username: '', password: '' } });
  });

  it('the snapshot is immutable: editing the contest afterward does not change the checkpoint', () => {
    const contest = fixtureContest();
    const cp = makeCheckpoint(contest, 'snap', '', NOW);
    const edited = withIdentity(contest, { hostSchoolName: 'Somewhere Else HS' }, LATER);

    // The checkpoint still restores the ORIGINAL host school name.
    expect(checkpointContest(cp).identity.hostSchoolName).toBe(contest.identity.hostSchoolName);
    expect(checkpointContest(cp).identity.hostSchoolName).not.toBe(edited.identity.hostSchoolName);
  });
});

describe('planRestore (undoable restore ordering)', () => {
  function fixtureCheckpoint(contest: Contest, overrides: Partial<Checkpoint> = {}): Checkpoint {
    return { ...makeCheckpoint(contest, 'v1', '', NOW, 'target-cp'), ...overrides };
  }

  it('auto-checkpoints the CURRENT working copy under a "Before restore" name', () => {
    const snapshot = fixtureContest();
    const target = fixtureCheckpoint(snapshot);
    const current = withIdentity(snapshot, { hostSchoolName: 'Edited HS' }, LATER);

    const plan = planRestore(current, target, LATER, 'auto-cp');

    expect(plan.autoCheckpoint.id).toBe('auto-cp');
    expect(plan.autoCheckpoint.name).toBe('Before restore "v1"');
    expect(plan.autoCheckpoint.createdAt).toBe(LATER);
    // The auto-checkpoint snapshots the current (edited) state, so restore is undoable.
    expect(parseContest(plan.autoCheckpoint.payload).identity.hostSchoolName).toBe('Edited HS');
  });

  it('restores the snapshot as the working copy, same id, updatedAt bumped so autosave persists it', () => {
    const snapshot = withIdentity(fixtureContest(), { hostSchoolName: 'Original HS' }, NOW);
    const target = fixtureCheckpoint(snapshot);
    const current = withIdentity(snapshot, { hostSchoolName: 'Edited HS' }, LATER);

    const { restored } = planRestore(current, target, LATER);

    expect(restored.id).toBe(current.id); // overwrites, never duplicates
    expect(restored.identity.hostSchoolName).toBe('Original HS');
    expect(restored.updatedAt).toBe(LATER);
    expect(restored.updatedAt).not.toBe(restored.createdAt); // arms autosave
  });

  it('preserves the device Speechwire credentials across a restore', () => {
    const snapshot = fixtureContest();
    const target = fixtureCheckpoint(snapshot);
    const current = withSpeechwire(snapshot, { username: 'live-user', password: 'live-pw' }, LATER);

    const { restored } = planRestore(current, target, LATER);

    // The snapshot never held credentials; rolling back content keeps the device login.
    expect(restored.speechwire).toEqual({ username: 'live-user', password: 'live-pw' });
  });
});

describe('beforeRestoreName', () => {
  it('quotes the target checkpoint name', () => {
    expect(beforeRestoreName(makeCheckpoint(createContest({ now: NOW }), 'my snap', '', NOW))).toBe(
      'Before restore "my snap"',
    );
  });
});

/**
 * Contest delete tombstones (RFC #276, slice #280), through HTTP on pg-mem.
 *
 * The delete/edit rule table lives in `tombstoneScenarios.json` so the app's
 * in-memory fake server (slice #281) can assert the very same cases; here each
 * one runs against the real routes. The rest of this file covers what the
 * shared list cannot: input validation, owner isolation, the activity log, and
 * old clients that never send `deletedAt`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './harness';
import scenarioFile from './tombstoneScenarios.json';

interface Scenario {
  name: string;
  given: { contest: string | null; tombstone: string | null };
  when: { op: 'delete' | 'deleteLegacy' | 'put' | 'post'; at?: string };
  then: {
    status: number;
    body?: Record<string, string>;
    contest: string | null;
    tombstone: string | null;
  };
}

const scenarios = scenarioFile.scenarios as Scenario[];

const ID = 'c1';

const body = (id: string, updatedAt: string, name = 'A Contest') => ({
  id,
  name,
  updatedAt,
  payload: JSON.stringify({ schemaVersion: 3, contest: { id, identity: { hostSchoolName: 'Test' } } }),
});

const deleteAt = (h: TestApp, user: string, id: string, deletedAt: string) =>
  h.as(user).delete(`/api/contests/${id}`).query({ deletedAt });

/** The caller's list, reduced to { contest version, tombstone time } for one id. */
async function stateOf(h: TestApp, user: string, id: string) {
  const res = await h.as(user).get('/api/contests').expect(200);
  const contest = (res.body.contests as { id: string; updatedAt: string }[]).find((c) => c.id === id);
  const tombstone = (res.body.tombstones as { id: string; deletedAt: string }[]).find((t) => t.id === id);
  return { contest: contest?.updatedAt ?? null, tombstone: tombstone?.deletedAt ?? null };
}

let h: TestApp;
beforeEach(async () => {
  h = await buildTestApp();
});

describe('shared delete/edit scenarios against the real routes', () => {
  it('the list is not empty', () => {
    expect(scenarios.length).toBeGreaterThan(10);
  });

  for (const s of scenarios) {
    it(s.name, async () => {
      if (s.given.contest) {
        await h.as('alice').post('/api/contests').send(body(ID, s.given.contest)).expect(201);
      }
      if (s.given.tombstone) {
        await deleteAt(h, 'alice', ID, s.given.tombstone).expect(204);
      }
      expect(await stateOf(h, 'alice', ID)).toEqual(s.given);

      const at = s.when.at ?? '';
      const res = await (() => {
        switch (s.when.op) {
          case 'delete':
            return deleteAt(h, 'alice', ID, at);
          case 'deleteLegacy':
            return h.as('alice').delete(`/api/contests/${ID}`);
          case 'put':
            return h.as('alice').put(`/api/contests/${ID}`).send(body(ID, at));
          case 'post':
            return h.as('alice').post('/api/contests').send(body(ID, at));
        }
      })();

      expect(res.status).toBe(s.then.status);
      if (s.then.body) expect(res.body).toMatchObject(s.then.body);
      expect(await stateOf(h, 'alice', ID)).toEqual({ contest: s.then.contest, tombstone: s.then.tombstone });
    });
  }
});

describe('GET /api/contests', () => {
  it('lists tombstones beside contests', async () => {
    await h.as('alice').post('/api/contests').send(body('keep', '2026-09-01T08:00:00.000Z')).expect(201);
    await h.as('alice').post('/api/contests').send(body('gone', '2026-09-01T08:00:00.000Z')).expect(201);
    await deleteAt(h, 'alice', 'gone', '2026-09-01T09:00:00.000Z').expect(204);

    const res = await h.as('alice').get('/api/contests').expect(200);
    expect(res.body.contests.map((c: { id: string }) => c.id)).toEqual(['keep']);
    expect(res.body.tombstones).toEqual([{ id: 'gone', deletedAt: '2026-09-01T09:00:00.000Z' }]);
  });

  it('returns an empty tombstone list for a fresh account', async () => {
    const res = await h.as('alice').get('/api/contests').expect(200);
    expect(res.body).toEqual({ contests: [], tombstones: [] });
  });
});

describe('deletedAt validation', () => {
  for (const bad of ['yesterday', '2026-09-01', '2026-13-45T99:00:00Z', '1756713600000', '']) {
    it(`rejects deletedAt=${JSON.stringify(bad)} with 400 and changes nothing`, async () => {
      await h.as('alice').post('/api/contests').send(body(ID, '2026-09-01T08:00:00.000Z')).expect(201);
      await deleteAt(h, 'alice', ID, bad).expect(400);
      expect(await stateOf(h, 'alice', ID)).toEqual({ contest: '2026-09-01T08:00:00.000Z', tombstone: null });
    });
  }

  it('accepts an offset timestamp and stores it normalized to UTC', async () => {
    await deleteAt(h, 'alice', ID, '2026-09-01T04:00:00-05:00').expect(204);
    expect((await stateOf(h, 'alice', ID)).tombstone).toBe('2026-09-01T09:00:00.000Z');
  });

  it('compares instants, not strings, across offsets', async () => {
    // 10:00Z is newer than 04:00-05:00 (09:00Z) even though "04" < "10" sorts the other way.
    await h.as('alice').post('/api/contests').send(body(ID, '2026-09-01T10:00:00.000Z')).expect(201);
    const res = await deleteAt(h, 'alice', ID, '2026-09-01T04:00:00-05:00').expect(409);
    expect(res.body).toMatchObject({ updatedAt: '2026-09-01T10:00:00.000Z' });
  });
});

describe('owner isolation', () => {
  it("another owner's tombstones are never listed", async () => {
    await deleteAt(h, 'bob', 'b1', '2026-09-01T09:00:00.000Z').expect(204);
    const alice = await h.as('alice').get('/api/contests').expect(200);
    expect(alice.body.tombstones).toEqual([]);
    const bob = await h.as('bob').get('/api/contests').expect(200);
    expect(bob.body.tombstones).toEqual([{ id: 'b1', deletedAt: '2026-09-01T09:00:00.000Z' }]);
  });

  it("a timestamped delete of another owner's contest leaves that contest alone", async () => {
    await h.as('alice').post('/api/contests').send(body('a1', '2026-09-01T08:00:00.000Z')).expect(201);
    await deleteAt(h, 'bob', 'a1', '2026-09-01T09:00:00.000Z').expect(204);

    await h.as('alice').get('/api/contests/a1').expect(200);
    expect(await stateOf(h, 'alice', 'a1')).toEqual({ contest: '2026-09-01T08:00:00.000Z', tombstone: null });
  });

  it("another owner's tombstone does not block this owner's writes", async () => {
    await deleteAt(h, 'bob', 'a1', '2026-09-01T12:00:00.000Z').expect(204);
    await h.as('alice').post('/api/contests').send(body('a1', '2026-09-01T08:00:00.000Z')).expect(201);
    await h.as('alice').put('/api/contests/a1').send(body('a1', '2026-09-01T09:00:00.000Z')).expect(200);
    expect((await stateOf(h, 'bob', 'a1')).tombstone).toBe('2026-09-01T12:00:00.000Z');
  });

  it("a newer write by one owner does not clear another owner's tombstone", async () => {
    await deleteAt(h, 'bob', 'x', '2026-09-01T09:00:00.000Z').expect(204);
    await deleteAt(h, 'alice', 'x', '2026-09-01T09:00:00.000Z').expect(204);
    await h.as('alice').post('/api/contests').send(body('x', '2026-09-01T10:00:00.000Z')).expect(201);
    expect((await stateOf(h, 'alice', 'x')).tombstone).toBeNull();
    expect((await stateOf(h, 'bob', 'x')).tombstone).toBe('2026-09-01T09:00:00.000Z');
  });
});

describe('a newer write after a tombstone', () => {
  it('recreates the contest via PUT-404-POST, clears the tombstone, and later deletes still work', async () => {
    await h.as('alice').post('/api/contests').send(body(ID, '2026-09-01T08:00:00.000Z')).expect(201);
    await deleteAt(h, 'alice', ID, '2026-09-01T09:00:00.000Z').expect(204);

    // The client's save path: PUT, then POST on 404.
    await h.as('alice').put(`/api/contests/${ID}`).send(body(ID, '2026-09-01T10:00:00.000Z')).expect(404);
    await h.as('alice').post('/api/contests').send(body(ID, '2026-09-01T10:00:00.000Z')).expect(201);
    expect(await stateOf(h, 'alice', ID)).toEqual({ contest: '2026-09-01T10:00:00.000Z', tombstone: null });

    // A further edit, then a stale delete from a device that missed it.
    await h.as('alice').put(`/api/contests/${ID}`).send(body(ID, '2026-09-01T11:00:00.000Z')).expect(200);
    await deleteAt(h, 'alice', ID, '2026-09-01T09:30:00.000Z').expect(409);
    expect((await stateOf(h, 'alice', ID)).contest).toBe('2026-09-01T11:00:00.000Z');
  });
});

describe('activity log', () => {
  it('a timestamped delete records one contest.deleted carrying the name', async () => {
    await h.as('alice').post('/api/contests').send(body(ID, '2026-09-01T08:00:00.000Z', 'Spring Zone')).expect(201);
    await deleteAt(h, 'alice', ID, '2026-09-01T09:00:00.000Z').expect(204);

    const deleted = (await h.deps.eventLog.queryEvents()).filter((e) => e.type === 'contest.deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ userId: 'alice', contestId: ID, contestName: 'Spring Zone' });
  });

  it('a 409 records nothing', async () => {
    await h.as('alice').post('/api/contests').send(body(ID, '2026-09-01T10:00:00.000Z')).expect(201);
    await deleteAt(h, 'alice', ID, '2026-09-01T09:00:00.000Z').expect(409);
    const events = await h.deps.eventLog.queryEvents();
    expect(events.map((e) => e.type)).toEqual(['contest.created']);
  });

  it('a timestamped delete of an already-gone contest records nothing', async () => {
    await deleteAt(h, 'alice', ID, '2026-09-01T09:00:00.000Z').expect(204);
    expect(await h.deps.eventLog.queryEvents()).toHaveLength(0);
  });

  it('a 410 write records nothing', async () => {
    await deleteAt(h, 'alice', ID, '2026-09-01T09:00:00.000Z').expect(204);
    await h.as('alice').post('/api/contests').send(body(ID, '2026-09-01T08:00:00.000Z')).expect(410);
    expect(await h.deps.eventLog.queryEvents()).toHaveLength(0);
  });

  it('a log failure never fails a timestamped delete', async () => {
    const failing = await buildTestApp();
    await failing.as('alice').post('/api/contests').send(body(ID, '2026-09-01T08:00:00.000Z')).expect(201);
    failing.deps.eventLog.recordEvent = async () => {
      throw new Error('log down');
    };
    await deleteAt(failing, 'alice', ID, '2026-09-01T09:00:00.000Z').expect(204);
    expect((await stateOf(failing, 'alice', ID)).tombstone).toBe('2026-09-01T09:00:00.000Z');
  });
});

describe('old clients (no deletedAt)', () => {
  it('delete behaves as before: 204 for an owned row, 404 otherwise, no tombstone', async () => {
    await h.as('alice').post('/api/contests').send(body(ID, '2026-09-01T08:00:00.000Z')).expect(201);
    await h.as('bob').delete(`/api/contests/${ID}`).expect(404);
    await h.as('alice').delete(`/api/contests/${ID}`).expect(204);
    await h.as('alice').delete(`/api/contests/${ID}`).expect(404);
    expect(await stateOf(h, 'alice', ID)).toEqual({ contest: null, tombstone: null });
  });

  it('can recreate a contest it deleted the old way', async () => {
    await h.as('alice').post('/api/contests').send(body(ID, '2026-09-01T08:00:00.000Z')).expect(201);
    await h.as('alice').delete(`/api/contests/${ID}`).expect(204);
    await h.as('alice').post('/api/contests').send(body(ID, '2026-09-01T07:00:00.000Z')).expect(201);
  });
});

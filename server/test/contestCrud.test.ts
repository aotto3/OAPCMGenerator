/**
 * Auth-gated contest CRUD, integration-tested against a real (in-memory)
 * Postgres — the PRD's server-API test decision. The HTTP app under test is the
 * production app factory; only two seams are faked, and neither can be exercised
 * offline: the database is pg-mem, and the session is a fake resolver that reads
 * an `x-user-id` header in place of Better Auth's cookie lookup. Everything else
 * — routing, ownership scoping, payload validation, status codes — is real.
 *
 * These lock in: a user only ever sees their own contests; unauthenticated and
 * cross-account access are rejected; the opaque payload round-trips byte-for-
 * byte without interpretation; malformed and credential-bearing input is
 * refused.
 */
import { newDb } from 'pg-mem';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createContestRepo } from '../src/contestRepo';
import { createEventLog } from '../src/eventLog';
import { migrate, type Pool } from '../src/db';

/** Builds a fresh app backed by an isolated in-memory database per test. */
async function buildApp() {
  const mem = newDb();
  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool() as unknown as Pool;
  await migrate(pool);
  const app = createApp({
    repo: createContestRepo(pool),
    eventLog: createEventLog(pool),
    // Fake session: authenticated iff the request carries an x-user-id header.
    // The email is derived from the id so events have both without a real user.
    resolveUser: (req) => {
      const id = req.header('x-user-id');
      return id ? { id, email: `${id}@example.test` } : null;
    },
  });
  return app;
}

const envelope = (id: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ schemaVersion: 3, contest: { id, identity: { hostSchoolName: 'Test' }, ...extra } });

const body = (id: string, name = 'A Contest', extra?: Record<string, unknown>) => ({
  id,
  name,
  updatedAt: '2026-07-07T12:00:00.000Z',
  payload: envelope(id, extra),
});

let app: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  app = await buildApp();
});

const asUser = (agent: request.Test, userId: string) => agent.set('x-user-id', userId);

describe('authentication gate', () => {
  it('rejects an unauthenticated list with 401', async () => {
    await request(app).get('/api/contests').expect(401);
  });

  it('rejects an unauthenticated create with 401', async () => {
    await request(app).post('/api/contests').send(body('c1')).expect(401);
  });
});

describe('per-account isolation', () => {
  it('a user sees only their own contests', async () => {
    await asUser(request(app).post('/api/contests'), 'alice').send(body('a1', 'Alice One')).expect(201);
    await asUser(request(app).post('/api/contests'), 'bob').send(body('b1', 'Bob One')).expect(201);

    const aliceList = await asUser(request(app).get('/api/contests'), 'alice').expect(200);
    expect(aliceList.body.contests.map((c: { id: string }) => c.id)).toEqual(['a1']);

    const bobList = await asUser(request(app).get('/api/contests'), 'bob').expect(200);
    expect(bobList.body.contests.map((c: { id: string }) => c.id)).toEqual(['b1']);
  });

  it("hides another user's contest as 404 on read", async () => {
    await asUser(request(app).post('/api/contests'), 'alice').send(body('a1')).expect(201);
    await asUser(request(app).get('/api/contests/a1'), 'bob').expect(404);
  });

  it("refuses to update another user's contest (404, no write)", async () => {
    await asUser(request(app).post('/api/contests'), 'alice').send(body('a1', 'Original')).expect(201);
    await asUser(request(app).put('/api/contests/a1'), 'bob').send(body('a1', 'Hijacked')).expect(404);

    const stillOriginal = await asUser(request(app).get('/api/contests/a1'), 'alice').expect(200);
    expect(stillOriginal.body.name).toBe('Original');
  });

  it("refuses to delete another user's contest (404, no delete)", async () => {
    await asUser(request(app).post('/api/contests'), 'alice').send(body('a1')).expect(201);
    await asUser(request(app).delete('/api/contests/a1'), 'bob').expect(404);
    await asUser(request(app).get('/api/contests/a1'), 'alice').expect(200);
  });
});

describe('CRUD lifecycle', () => {
  it('creates, reads, updates, and deletes an owned contest', async () => {
    await asUser(request(app).post('/api/contests'), 'alice').send(body('a1', 'First')).expect(201);

    const read = await asUser(request(app).get('/api/contests/a1'), 'alice').expect(200);
    expect(read.body.name).toBe('First');

    await asUser(request(app).put('/api/contests/a1'), 'alice')
      .send({ ...body('a1', 'Renamed'), updatedAt: '2026-07-08T00:00:00.000Z' })
      .expect(200);
    const reread = await asUser(request(app).get('/api/contests/a1'), 'alice').expect(200);
    expect(reread.body.name).toBe('Renamed');
    expect(reread.body.updatedAt).toBe('2026-07-08T00:00:00.000Z');

    await asUser(request(app).delete('/api/contests/a1'), 'alice').expect(204);
    await asUser(request(app).get('/api/contests/a1'), 'alice').expect(404);
  });

  it('lists newest-edited first', async () => {
    await asUser(request(app).post('/api/contests'), 'alice')
      .send({ ...body('older', 'Older'), updatedAt: '2026-01-01T00:00:00.000Z' })
      .expect(201);
    await asUser(request(app).post('/api/contests'), 'alice')
      .send({ ...body('newer', 'Newer'), updatedAt: '2026-06-01T00:00:00.000Z' })
      .expect(201);
    const list = await asUser(request(app).get('/api/contests'), 'alice').expect(200);
    expect(list.body.contests.map((c: { id: string }) => c.id)).toEqual(['newer', 'older']);
  });

  it('rejects a duplicate id with 409', async () => {
    await asUser(request(app).post('/api/contests'), 'alice').send(body('a1')).expect(201);
    await asUser(request(app).post('/api/contests'), 'alice').send(body('a1')).expect(409);
  });

  it('returns 404 updating or deleting an unknown contest', async () => {
    await asUser(request(app).put('/api/contests/nope'), 'alice').send(body('nope')).expect(404);
    await asUser(request(app).delete('/api/contests/nope'), 'alice').expect(404);
  });
});

describe('opaque storage', () => {
  it('round-trips the payload byte-for-byte without interpreting it', async () => {
    // A payload whose "contest" is arbitrary nested data the server never reads.
    const payload = JSON.stringify({
      schemaVersion: 99,
      contest: { id: 'a1', weird: { nested: [1, { two: 2 }], emoji: '🎭' } },
    });
    await asUser(request(app).post('/api/contests'), 'alice')
      .send({ id: 'a1', name: 'Opaque', updatedAt: '2026-07-07T12:00:00.000Z', payload })
      .expect(201);
    const read = await asUser(request(app).get('/api/contests/a1'), 'alice').expect(200);
    expect(read.body.payload).toBe(payload);
  });

  it('rejects a malformed payload with 400', async () => {
    await asUser(request(app).post('/api/contests'), 'alice')
      .send({ id: 'a1', name: 'Bad', updatedAt: '2026-07-07T12:00:00.000Z', payload: 'not json' })
      .expect(400);
  });

  it('rejects a credential-bearing payload with 400', async () => {
    await asUser(request(app).post('/api/contests'), 'alice')
      .send(body('a1', 'Creds', { speechwire: { username: 'u', password: 'p' } }))
      .expect(400);
  });

  it('rejects a payload whose contest id disagrees with the resource id (400)', async () => {
    await asUser(request(app).post('/api/contests'), 'alice')
      .send({ id: 'a1', name: 'Mismatch', updatedAt: '2026-07-07T12:00:00.000Z', payload: envelope('DIFFERENT') })
      .expect(400);
  });

  it('rejects a create missing required metadata with 400', async () => {
    await asUser(request(app).post('/api/contests'), 'alice')
      .send({ id: 'a1', payload: envelope('a1') })
      .expect(400);
  });
});

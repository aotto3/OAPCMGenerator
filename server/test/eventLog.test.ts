/**
 * The activity log, integration-tested the same way as contest CRUD: the real
 * app factory and real routes, driven over HTTP, backed by an in-memory
 * Postgres (pg-mem) and a fake session resolver that reads x-user-id. The event
 * log under test is the production `createEventLog` running against that same
 * pg-mem — the only fake here is auth.
 *
 * These lock in: each write route (create / save / delete) appends exactly one
 * attributable event; `queryEvents` pages newest-first and filters by user;
 * delete events keep the contest name after the row is gone; and a failing log
 * never fails or delays the user's contest request.
 */
import { newDb } from 'pg-mem';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createContestRepo } from '../src/contestRepo';
import { createEventLog, type EventInput, type EventLog } from '../src/eventLog';
import { createInMemoryUserDirectory } from '../src/userDirectory';
import { migrate, type Pool } from '../src/db';

/**
 * Builds an app over a fresh in-memory DB, returning the live event log too so
 * a test can query what the routes recorded. An override log lets one test
 * inject a throwing implementation while keeping every other seam real.
 */
async function buildApp(overrideLog?: EventLog) {
  const mem = newDb();
  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool() as unknown as Pool;
  await migrate(pool);
  const eventLog = overrideLog ?? createEventLog(pool);
  const app = createApp({
    repo: createContestRepo(pool),
    eventLog,
    userDirectory: createInMemoryUserDirectory([]),
    adminEmails: new Set(),
    resolveUser: (req) => {
      const id = req.header('x-user-id');
      return id ? { id, email: `${id}@example.test` } : null;
    },
  });
  return { app, eventLog, pool };
}

const envelope = (id: string): string =>
  JSON.stringify({ schemaVersion: 3, contest: { id, identity: { hostSchoolName: 'Test' } } });

const body = (id: string, name = 'A Contest') => ({
  id,
  name,
  updatedAt: '2026-07-07T12:00:00.000Z',
  payload: envelope(id),
});

const asUser = (agent: request.Test, userId: string) => agent.set('x-user-id', userId);

let ctx: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  ctx = await buildApp();
});

describe('event recording per route', () => {
  it('create records one contest.created with the user id, email, contest id and name', async () => {
    await asUser(request(ctx.app).post('/api/contests'), 'alice').send(body('c1', 'Spring OAP')).expect(201);

    const events = await ctx.eventLog.queryEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'contest.created',
      userId: 'alice',
      userEmail: 'alice@example.test',
      contestId: 'c1',
      contestName: 'Spring OAP',
    });
    // A timestamp is stamped on every event.
    expect(events[0].occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('save (PUT) records one contest.updated with the new name', async () => {
    await asUser(request(ctx.app).post('/api/contests'), 'alice').send(body('c1', 'Original')).expect(201);
    await asUser(request(ctx.app).put('/api/contests/c1'), 'alice').send(body('c1', 'Renamed')).expect(200);

    const events = await ctx.eventLog.queryEvents();
    expect(events.map((e) => e.type)).toEqual(['contest.updated', 'contest.created']);
    expect(events[0]).toMatchObject({ type: 'contest.updated', contestId: 'c1', contestName: 'Renamed' });
  });

  it('delete records one contest.deleted that retains the name after the row is gone', async () => {
    await asUser(request(ctx.app).post('/api/contests'), 'alice').send(body('c1', 'Doomed')).expect(201);
    await asUser(request(ctx.app).delete('/api/contests/c1'), 'alice').expect(204);

    // The contest row is gone...
    await asUser(request(ctx.app).get('/api/contests/c1'), 'alice').expect(404);
    // ...but the event still names it.
    const events = await ctx.eventLog.queryEvents();
    expect(events[0]).toMatchObject({
      type: 'contest.deleted',
      contestId: 'c1',
      contestName: 'Doomed',
    });
  });

  it('does not record an event for a rejected (404) delete', async () => {
    await asUser(request(ctx.app).delete('/api/contests/nope'), 'alice').expect(404);
    expect(await ctx.eventLog.queryEvents()).toHaveLength(0);
  });
});

describe('queryEvents', () => {
  it('returns newest-first', async () => {
    for (const [id, name] of [['c1', 'First'], ['c2', 'Second'], ['c3', 'Third']] as const) {
      await asUser(request(ctx.app).post('/api/contests'), 'alice').send(body(id, name)).expect(201);
    }
    const events = await ctx.eventLog.queryEvents();
    expect(events.map((e) => e.contestName)).toEqual(['Third', 'Second', 'First']);
  });

  it('pages with limit and offset', async () => {
    for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) {
      await asUser(request(ctx.app).post('/api/contests'), 'alice').send(body(id, id)).expect(201);
    }
    const page1 = await ctx.eventLog.queryEvents({ limit: 2, offset: 0 });
    const page2 = await ctx.eventLog.queryEvents({ limit: 2, offset: 2 });
    const page3 = await ctx.eventLog.queryEvents({ limit: 2, offset: 4 });
    expect(page1.map((e) => e.contestName)).toEqual(['c5', 'c4']);
    expect(page2.map((e) => e.contestName)).toEqual(['c3', 'c2']);
    expect(page3.map((e) => e.contestName)).toEqual(['c1']);
  });

  it('filters by user', async () => {
    await asUser(request(ctx.app).post('/api/contests'), 'alice').send(body('a1', 'Alice One')).expect(201);
    await asUser(request(ctx.app).post('/api/contests'), 'bob').send(body('b1', 'Bob One')).expect(201);
    await asUser(request(ctx.app).post('/api/contests'), 'alice').send(body('a2', 'Alice Two')).expect(201);

    const aliceEvents = await ctx.eventLog.queryEvents({ userId: 'alice' });
    expect(aliceEvents.map((e) => e.contestName)).toEqual(['Alice Two', 'Alice One']);
    expect(aliceEvents.every((e) => e.userId === 'alice')).toBe(true);

    const bobEvents = await ctx.eventLog.queryEvents({ userId: 'bob' });
    expect(bobEvents.map((e) => e.contestName)).toEqual(['Bob One']);
  });

  it('round-trips an optional JSON detail', async () => {
    const detail = { source: 'test', nested: [1, { two: 2 }] };
    const input: EventInput = {
      occurredAt: '2026-07-09T00:00:00.000Z',
      userId: 'alice',
      userEmail: 'alice@example.test',
      type: 'contest.created',
      contestId: 'c1',
      contestName: 'With Detail',
      detail,
    };
    await ctx.eventLog.recordEvent(input);
    const [event] = await ctx.eventLog.queryEvents();
    expect(event.detail).toEqual(detail);
  });
});

describe('log-failure tolerance', () => {
  it('a throwing event log does not fail the contest request', async () => {
    const throwing: EventLog = {
      recordEvent: async () => {
        throw new Error('event log is down');
      },
      queryEvents: async () => [],
      countEvents: async () => 0,
      listEvents: async () => [],
    };
    const failing = await buildApp(throwing);

    // The write still succeeds even though recording the event blew up.
    await asUser(request(failing.app).post('/api/contests'), 'alice').send(body('c1', 'Resilient')).expect(201);
    // ...and the contest was really stored.
    const read = await asUser(request(failing.app).get('/api/contests/c1'), 'alice').expect(200);
    expect(read.body.name).toBe('Resilient');
  });
});

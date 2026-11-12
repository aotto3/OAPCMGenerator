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
import { beforeEach, describe, expect, it } from 'vitest';
import type { EventInput, EventLog } from '../src/eventLog';
import { buildTestApp, type TestApp } from './harness';

const envelope = (id: string): string =>
  JSON.stringify({ schemaVersion: 3, contest: { id, identity: { hostSchoolName: 'Test' } } });

const body = (id: string, name = 'A Contest') => ({
  id,
  name,
  updatedAt: '2026-07-07T12:00:00.000Z',
  payload: envelope(id),
});

let ctx: TestApp;
beforeEach(async () => {
  ctx = await buildTestApp();
});

describe('event recording per route', () => {
  it('create records one contest.created with the user id, email, contest id and name', async () => {
    await ctx.as('alice').post('/api/contests').send(body('c1', 'Spring OAP')).expect(201);

    const events = await ctx.deps.eventLog.queryEvents();
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
    await ctx.as('alice').post('/api/contests').send(body('c1', 'Original')).expect(201);
    await ctx.as('alice').put('/api/contests/c1').send(body('c1', 'Renamed')).expect(200);

    const events = await ctx.deps.eventLog.queryEvents();
    expect(events.map((e) => e.type)).toEqual(['contest.updated', 'contest.created']);
    expect(events[0]).toMatchObject({ type: 'contest.updated', contestId: 'c1', contestName: 'Renamed' });
  });

  it('delete records one contest.deleted that retains the name after the row is gone', async () => {
    await ctx.as('alice').post('/api/contests').send(body('c1', 'Doomed')).expect(201);
    await ctx.as('alice').delete('/api/contests/c1').expect(204);

    // The contest row is gone...
    await ctx.as('alice').get('/api/contests/c1').expect(404);
    // ...but the event still names it.
    const events = await ctx.deps.eventLog.queryEvents();
    expect(events[0]).toMatchObject({
      type: 'contest.deleted',
      contestId: 'c1',
      contestName: 'Doomed',
    });
  });

  it('does not record an event for a rejected (404) delete', async () => {
    await ctx.as('alice').delete('/api/contests/nope').expect(404);
    expect(await ctx.deps.eventLog.queryEvents()).toHaveLength(0);
  });
});

describe('queryEvents', () => {
  it('returns newest-first', async () => {
    for (const [id, name] of [['c1', 'First'], ['c2', 'Second'], ['c3', 'Third']] as const) {
      await ctx.as('alice').post('/api/contests').send(body(id, name)).expect(201);
    }
    const events = await ctx.deps.eventLog.queryEvents();
    expect(events.map((e) => e.contestName)).toEqual(['Third', 'Second', 'First']);
  });

  it('pages with limit and offset', async () => {
    for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) {
      await ctx.as('alice').post('/api/contests').send(body(id, id)).expect(201);
    }
    const page1 = await ctx.deps.eventLog.queryEvents({ limit: 2, offset: 0 });
    const page2 = await ctx.deps.eventLog.queryEvents({ limit: 2, offset: 2 });
    const page3 = await ctx.deps.eventLog.queryEvents({ limit: 2, offset: 4 });
    expect(page1.map((e) => e.contestName)).toEqual(['c5', 'c4']);
    expect(page2.map((e) => e.contestName)).toEqual(['c3', 'c2']);
    expect(page3.map((e) => e.contestName)).toEqual(['c1']);
  });

  it('filters by user', async () => {
    await ctx.as('alice').post('/api/contests').send(body('a1', 'Alice One')).expect(201);
    await ctx.as('bob').post('/api/contests').send(body('b1', 'Bob One')).expect(201);
    await ctx.as('alice').post('/api/contests').send(body('a2', 'Alice Two')).expect(201);

    const aliceEvents = await ctx.deps.eventLog.queryEvents({ userId: 'alice' });
    expect(aliceEvents.map((e) => e.contestName)).toEqual(['Alice Two', 'Alice One']);
    expect(aliceEvents.every((e) => e.userId === 'alice')).toBe(true);

    const bobEvents = await ctx.deps.eventLog.queryEvents({ userId: 'bob' });
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
    await ctx.deps.eventLog.recordEvent(input);
    const [event] = await ctx.deps.eventLog.queryEvents();
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
    const failing = await buildTestApp({ eventLog: throwing });

    // The write still succeeds even though recording the event blew up.
    await failing.as('alice').post('/api/contests').send(body('c1', 'Resilient')).expect(201);
    // ...and the contest was really stored.
    const read = await failing.as('alice').get('/api/contests/c1').expect(200);
    expect(read.body.name).toBe('Resilient');
  });
});

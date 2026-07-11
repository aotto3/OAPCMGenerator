/**
 * The telemetry endpoint, integration-tested like the rest of the server: the
 * real app factory and real route over HTTP, backed by pg-mem for the event log
 * and a fake session resolver. These lock in the guardrails that keep the log
 * trustworthy — an allowlisted type is accepted and recorded with the caller's
 * id + email; an unknown type, an unauthenticated call, and an oversized detail
 * blob are each refused — and that a client-reported detail round-trips.
 */
import { newDb } from 'pg-mem';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createContestRepo } from '../src/contestRepo';
import { createEventLog } from '../src/eventLog';
import { createInMemoryUserDirectory } from '../src/userDirectory';
import { MAX_DETAIL_BYTES } from '../src/telemetryRoutes';
import { migrate, type Pool } from '../src/db';

async function buildApp() {
  const mem = newDb();
  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool() as unknown as Pool;
  await migrate(pool);
  const eventLog = createEventLog(pool);
  const app = createApp({
    repo: createContestRepo(pool),
    eventLog,
    userDirectory: createInMemoryUserDirectory([]),
    authAdmin: { sendSignInLink: async () => {} },
    adminEmails: new Set(),
    resolveUser: (req) => {
      const id = req.header('x-user-id');
      return id ? { id, email: `${id}@example.test` } : null;
    },
  });
  return { app, eventLog };
}

const asUser = (agent: request.Test, userId: string) => agent.set('x-user-id', userId);

let ctx: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  ctx = await buildApp();
});

describe('telemetry ingest', () => {
  it('accepts each allowlisted type and records it attributed to the caller', async () => {
    for (const type of ['documents.generated', 'contest.exported', 'contest.imported', 'client.error']) {
      await asUser(request(ctx.app).post('/api/telemetry'), 'alice').send({ type }).expect(204);
    }
    const events = await ctx.eventLog.queryEvents();
    expect(events.map((e) => e.type)).toEqual([
      'client.error',
      'contest.imported',
      'contest.exported',
      'documents.generated',
    ]);
    expect(events.every((e) => e.userId === 'alice' && e.userEmail === 'alice@example.test')).toBe(true);
  });

  it('records the contest id and name when supplied (documents generated)', async () => {
    await asUser(request(ctx.app).post('/api/telemetry'), 'alice')
      .send({ type: 'documents.generated', contestId: 'c1', contestName: 'Spring OAP' })
      .expect(204);
    const [event] = await ctx.eventLog.queryEvents();
    expect(event).toMatchObject({
      type: 'documents.generated',
      contestId: 'c1',
      contestName: 'Spring OAP',
    });
  });

  it('round-trips a client-error detail blob', async () => {
    const detail = { message: 'TypeError: boom', appVersion: '0.1.0' };
    await asUser(request(ctx.app).post('/api/telemetry'), 'alice')
      .send({ type: 'client.error', detail })
      .expect(204);
    const [event] = await ctx.eventLog.queryEvents();
    expect(event.detail).toEqual(detail);
  });

  it('rejects an unknown event type with 400 and records nothing', async () => {
    await asUser(request(ctx.app).post('/api/telemetry'), 'alice')
      .send({ type: 'contest.deleted' }) // a real server event, but not client-reportable
      .expect(400);
    await asUser(request(ctx.app).post('/api/telemetry'), 'alice')
      .send({ type: 'made.up' })
      .expect(400);
    expect(await ctx.eventLog.queryEvents()).toHaveLength(0);
  });

  it('rejects an unauthenticated call with 401', async () => {
    await request(ctx.app).post('/api/telemetry').send({ type: 'documents.generated' }).expect(401);
    expect(await ctx.eventLog.queryEvents()).toHaveLength(0);
  });

  it('rejects an oversized detail payload with 400', async () => {
    const detail = { message: 'x'.repeat(MAX_DETAIL_BYTES + 1) };
    await asUser(request(ctx.app).post('/api/telemetry'), 'alice')
      .send({ type: 'client.error', detail })
      .expect(400);
    expect(await ctx.eventLog.queryEvents()).toHaveLength(0);
  });
});

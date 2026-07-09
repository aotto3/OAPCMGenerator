/**
 * The admin API, integration-tested like the rest of the server: the real app
 * factory and real admin routes driven over HTTP, backed by an in-memory
 * Postgres (pg-mem) for contests + the event log and an in-memory user
 * directory in place of Better Auth's tables (which do not exist offline). The
 * only fake is auth — a resolver that reads x-user-id and derives the session
 * email, so the admin allowlist can be exercised.
 *
 * These lock in: the gate (admin sees data; non-admin and unauthenticated get a
 * flat 404 on every route, so the surface never leaks); stats reflect real
 * counts; the users table joins the directory with per-user contest counts; the
 * activity feed pages newest-first and filters by user; and the drill-down
 * returns a user's contest metadata and personal feed — never payloads.
 */
import { newDb } from 'pg-mem';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createContestRepo } from '../src/contestRepo';
import { createEventLog } from '../src/eventLog';
import { createInMemoryUserDirectory, type UserRecord } from '../src/userDirectory';
import { migrate, type Pool } from '../src/db';

const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const DAY = 24 * 60 * 60 * 1000;

// Three accounts: an admin plus two users, one seen recently and one long ago.
const USERS: UserRecord[] = [
  { id: 'admin', email: 'admin@example.test', createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: iso(0) },
  { id: 'alice', email: 'alice@example.test', createdAt: '2026-02-01T00:00:00.000Z', lastSeenAt: iso(2 * DAY) },
  { id: 'bob', email: 'bob@example.test', createdAt: '2026-03-01T00:00:00.000Z', lastSeenAt: iso(30 * DAY) },
];

async function buildApp(admins: ReadonlySet<string> = new Set(['admin@example.test'])) {
  const mem = newDb();
  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool() as unknown as Pool;
  await migrate(pool);
  const app = createApp({
    repo: createContestRepo(pool),
    eventLog: createEventLog(pool),
    userDirectory: createInMemoryUserDirectory(USERS),
    adminEmails: admins,
    // Fake session: authenticated iff x-user-id is present; email is derived to
    // match the directory's `${id}@example.test` scheme so the allowlist works.
    resolveUser: (req) => {
      const id = req.header('x-user-id');
      return id ? { id, email: `${id}@example.test` } : null;
    },
  });
  return { app, pool };
}

const asUser = (agent: request.Test, userId: string) => agent.set('x-user-id', userId);

const envelope = (id: string): string =>
  JSON.stringify({ schemaVersion: 3, contest: { id, identity: { hostSchoolName: 'Test' } } });
const contestBody = (id: string, name = id) => ({
  id,
  name,
  updatedAt: '2026-07-07T12:00:00.000Z',
  payload: envelope(id),
});

type TestApp = Awaited<ReturnType<typeof buildApp>>['app'];

/** Seeds contests (each POST also records one contest.created event). */
async function seed(a: TestApp) {
  await asUser(request(a).post('/api/contests'), 'alice').send(contestBody('a1', 'Alice One')).expect(201);
  await asUser(request(a).post('/api/contests'), 'alice').send(contestBody('a2', 'Alice Two')).expect(201);
  await asUser(request(a).post('/api/contests'), 'alice').send(contestBody('a3', 'Alice Three')).expect(201);
  await asUser(request(a).post('/api/contests'), 'bob').send(contestBody('b1', 'Bob One')).expect(201);
  await asUser(request(a).post('/api/contests'), 'bob').send(contestBody('b2', 'Bob Two')).expect(201);
}

let app: TestApp;
beforeEach(async () => {
  ({ app } = await buildApp());
});

describe('admin gate', () => {
  const routes = ['/api/admin/me', '/api/admin/stats', '/api/admin/users', '/api/admin/events'];

  it('answers 404 on every admin route for an unauthenticated caller', async () => {
    for (const route of routes) {
      await request(app).get(route).expect(404);
    }
  });

  it('answers 404 on every admin route for a signed-in non-admin', async () => {
    for (const route of routes) {
      await asUser(request(app).get(route), 'alice').expect(404);
    }
    // Drill-down routes are dark too.
    await asUser(request(app).get('/api/admin/users/bob/contests'), 'alice').expect(404);
    await asUser(request(app).get('/api/admin/users/bob/events'), 'alice').expect(404);
  });

  it('lets an allowlisted admin through the probe', async () => {
    const res = await asUser(request(app).get('/api/admin/me'), 'admin').expect(200);
    expect(res.body).toEqual({ admin: true });
  });

  it('is dark to everyone when the allowlist is empty', async () => {
    const { app: noAdmins } = await buildApp(new Set());
    await asUser(request(noAdmins).get('/api/admin/me'), 'admin').expect(404);
  });
});

describe('stats', () => {
  it('reflects real user, contest, active-this-week, and documents-generated counts', async () => {
    await seed(app);
    const res = await asUser(request(app).get('/api/admin/stats'), 'admin').expect(200);
    expect(res.body).toEqual({
      totalUsers: 3,
      activeThisWeek: 2, // admin (now) + alice (2d); bob (30d) is stale
      totalContests: 5,
      documentsGenerated: 0, // no telemetry events yet (arrives with slice #58)
    });
  });
});

describe('users table', () => {
  it('joins the directory with each user contest count, newest sign-up first', async () => {
    await seed(app);
    const res = await asUser(request(app).get('/api/admin/users'), 'admin').expect(200);
    const users = res.body.users as Array<{ id: string; email: string; contestCount: number }>;
    // Directory order is newest-created first: bob (Mar), alice (Feb), admin (Jan).
    expect(users.map((u) => u.id)).toEqual(['bob', 'alice', 'admin']);
    const counts = Object.fromEntries(users.map((u) => [u.id, u.contestCount]));
    expect(counts).toEqual({ alice: 3, bob: 2, admin: 0 });
    expect(users.find((u) => u.id === 'alice')?.email).toBe('alice@example.test');
  });
});

describe('activity feed', () => {
  it('returns events newest-first with a total', async () => {
    await seed(app);
    const res = await asUser(request(app).get('/api/admin/events'), 'admin').expect(200);
    expect(res.body.total).toBe(5);
    const names = (res.body.events as Array<{ contestName: string }>).map((e) => e.contestName);
    // Newest first: last seeded (Bob Two) leads, first seeded (Alice One) trails.
    expect(names).toEqual(['Bob Two', 'Bob One', 'Alice Three', 'Alice Two', 'Alice One']);
    expect((res.body.events as Array<{ userEmail: string }>)[0].userEmail).toBe('bob@example.test');
  });

  it('paginates with limit and offset', async () => {
    await seed(app);
    const page1 = await asUser(request(app).get('/api/admin/events?limit=2&offset=0'), 'admin').expect(200);
    const page2 = await asUser(request(app).get('/api/admin/events?limit=2&offset=2'), 'admin').expect(200);
    expect((page1.body.events as Array<{ contestName: string }>).map((e) => e.contestName)).toEqual([
      'Bob Two',
      'Bob One',
    ]);
    expect((page2.body.events as Array<{ contestName: string }>).map((e) => e.contestName)).toEqual([
      'Alice Three',
      'Alice Two',
    ]);
    expect(page1.body.total).toBe(5);
  });

  it('filters by user', async () => {
    await seed(app);
    const res = await asUser(request(app).get('/api/admin/events?userId=alice'), 'admin').expect(200);
    expect(res.body.total).toBe(3);
    const events = res.body.events as Array<{ userId: string; contestName: string }>;
    expect(events.every((e) => e.userId === 'alice')).toBe(true);
    expect(events.map((e) => e.contestName)).toEqual(['Alice Three', 'Alice Two', 'Alice One']);
  });
});

describe('per-user drill-down', () => {
  it("returns a user's contest metadata (no payloads)", async () => {
    await seed(app);
    const res = await asUser(request(app).get('/api/admin/users/alice/contests'), 'admin').expect(200);
    const contests = res.body.contests as Array<Record<string, unknown>>;
    expect(contests.map((c) => c.name).sort()).toEqual(['Alice One', 'Alice Three', 'Alice Two']);
    // Metadata only — the opaque payload is never surfaced.
    expect(contests.every((c) => !('payload' in c))).toBe(true);
  });

  it("returns a user's personal activity feed", async () => {
    await seed(app);
    const res = await asUser(request(app).get('/api/admin/users/bob/events'), 'admin').expect(200);
    expect(res.body.total).toBe(2);
    const events = res.body.events as Array<{ userId: string; contestName: string }>;
    expect(events.every((e) => e.userId === 'bob')).toBe(true);
    expect(events.map((e) => e.contestName)).toEqual(['Bob Two', 'Bob One']);
  });
});

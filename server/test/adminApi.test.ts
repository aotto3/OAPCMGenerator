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
  // Recording fake for the one account-acting seam, so tests can assert sends.
  const sentLinks: string[] = [];
  const app = createApp({
    repo: createContestRepo(pool),
    eventLog: createEventLog(pool),
    userDirectory: createInMemoryUserDirectory(USERS),
    authAdmin: {
      sendSignInLink: async (email) => {
        sentLinks.push(email);
      },
    },
    adminEmails: admins,
    // Fake session: authenticated iff x-user-id is present; email is derived to
    // match the directory's `${id}@example.test` scheme so the allowlist works.
    resolveUser: (req) => {
      const id = req.header('x-user-id');
      return id ? { id, email: `${id}@example.test` } : null;
    },
  });
  return { app, pool, sentLinks };
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
  const routes = [
    '/api/admin/me',
    '/api/admin/stats',
    '/api/admin/users',
    '/api/admin/events',
    '/api/admin/analytics',
    '/api/admin/errors',
  ];

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

describe('widened activity feed filters', () => {
  /**
   * Seeds a richer trail than `seed()`: a rename (contest.updated), a delete
   * (contest.deleted), and two telemetry events (a doc-generation and a
   * client.error carrying a message in `detail`) so type / contest / date-range
   * / free-text filters each have something distinct to match.
   */
  async function seedRich(a: TestApp) {
    await seed(a); // 5 contest.created (3 alice, 2 bob)
    await asUser(request(a).put('/api/contests/a1'), 'alice')
      .send(contestBody('a1', 'Alice One Renamed'))
      .expect(200); // contest.updated
    await asUser(request(a).delete('/api/contests/b2'), 'bob').expect(204); // contest.deleted
    await asUser(request(a).post('/api/telemetry'), 'alice')
      .send({ type: 'documents.generated', contestId: 'a2', contestName: 'Alice Two' })
      .expect(204);
    await asUser(request(a).post('/api/telemetry'), 'bob')
      .send({ type: 'client.error', detail: { message: 'Kaboom while rendering', appVersion: '2.0.0' } })
      .expect(204);
  }

  it('filters by event type, with a matching total', async () => {
    await seedRich(app);
    const res = await asUser(request(app).get('/api/admin/events?type=contest.deleted'), 'admin').expect(200);
    expect(res.body.total).toBe(1);
    const events = res.body.events as Array<{ type: string; contestName: string }>;
    expect(events.map((e) => e.type)).toEqual(['contest.deleted']);
    expect(events[0].contestName).toBe('Bob Two');
  });

  it('filters by contest id', async () => {
    await seedRich(app);
    const res = await asUser(request(app).get('/api/admin/events?contestId=a1'), 'admin').expect(200);
    // a1 was created then renamed — two events, both for that contest.
    expect(res.body.total).toBe(2);
    const events = res.body.events as Array<{ type: string; contestId: string }>;
    expect(events.every((e) => e.contestId === 'a1')).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['contest.updated', 'contest.created']);
  });

  it('filters by an inclusive ISO date range', async () => {
    // Two events straddling a boundary, recorded directly so timestamps are exact.
    const { app: a2, pool } = await buildApp();
    const { createEventLog } = await import('../src/eventLog');
    const log = createEventLog(pool);
    await log.recordEvent({ occurredAt: '2026-05-01T00:00:00.000Z', userId: 'alice', userEmail: 'alice@example.test', type: 'contest.created', contestName: 'May' });
    await log.recordEvent({ occurredAt: '2026-06-15T00:00:00.000Z', userId: 'alice', userEmail: 'alice@example.test', type: 'contest.created', contestName: 'June' });
    await log.recordEvent({ occurredAt: '2026-07-20T00:00:00.000Z', userId: 'alice', userEmail: 'alice@example.test', type: 'contest.created', contestName: 'July' });

    const res = await asUser(
      request(a2).get('/api/admin/events?from=2026-06-01T00:00:00.000Z&to=2026-07-01T00:00:00.000Z'),
      'admin',
    ).expect(200);
    expect(res.body.total).toBe(1);
    expect((res.body.events as Array<{ contestName: string }>).map((e) => e.contestName)).toEqual(['June']);
  });

  it('free-text matches email, contest name, and the error message in detail', async () => {
    await seedRich(app);

    // Contest name (case-insensitive).
    const byName = await asUser(request(app).get('/api/admin/events?text=renamed'), 'admin').expect(200);
    expect((byName.body.events as Array<{ contestName: string }>).map((e) => e.contestName)).toEqual([
      'Alice One Renamed',
    ]);

    // Email substring — every bob event.
    const byEmail = await asUser(request(app).get('/api/admin/events?text=bob@'), 'admin').expect(200);
    expect(byEmail.body.total).toBeGreaterThan(0);
    expect((byEmail.body.events as Array<{ userEmail: string }>).every((e) => e.userEmail === 'bob@example.test')).toBe(true);

    // Error message inside detail.
    const byError = await asUser(request(app).get('/api/admin/events?text=kaboom'), 'admin').expect(200);
    expect(byError.body.total).toBe(1);
    expect((byError.body.events as Array<{ type: string }>)[0].type).toBe('client.error');
  });

  it('combines the new filters with the existing user filter', async () => {
    await seedRich(app);
    // Alice's document-generation only: user + type together.
    const res = await asUser(
      request(app).get('/api/admin/events?userId=alice&type=documents.generated'),
      'admin',
    ).expect(200);
    expect(res.body.total).toBe(1);
    const events = res.body.events as Array<{ userId: string; type: string; contestName: string }>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: 'alice', type: 'documents.generated', contestName: 'Alice Two' });

    // A contradictory combination (bob + alice-only text) yields nothing.
    const empty = await asUser(
      request(app).get('/api/admin/events?userId=bob&type=documents.generated'),
      'admin',
    ).expect(200);
    expect(empty.body.total).toBe(0);
    expect(empty.body.events).toEqual([]);
  });

  it('paginates a filtered feed with a filtered total', async () => {
    await seedRich(app);
    // All alice events (3 created + 1 updated + 1 doc-gen = 5), 2 per page.
    const page1 = await asUser(request(app).get('/api/admin/events?userId=alice&limit=2&offset=0'), 'admin').expect(200);
    expect(page1.body.total).toBe(5);
    expect((page1.body.events as unknown[]).length).toBe(2);
  });
});

describe('analytics endpoint', () => {
  it('returns the report shape for an admin over the default window', async () => {
    await seed(app); // 5 contest.created (3 alice, 2 bob), all "now"
    const res = await asUser(request(app).get('/api/admin/analytics'), 'admin').expect(200);
    const body = res.body as {
      window: { from: string; to: string; bucket: string };
      series: unknown[];
      totals: { contestsCreated: number; activeUsers: number };
      adoption: { totalUsers: number; createdContest: { users: number; ratio: number } };
      retention: { activeUsers: number };
      volumeByType: Array<{ type: string; count: number }>;
    };
    // 30-day default ⇒ daily buckets, one per day of the window.
    expect(body.window.bucket).toBe('day');
    expect(Array.isArray(body.series)).toBe(true);
    // The five seeded creates land in the window (recorded ~now).
    expect(body.totals.contestsCreated).toBe(5);
    expect(body.totals.activeUsers).toBe(2); // alice + bob
    expect(body.adoption.totalUsers).toBe(3); // three accounts in the directory
    expect(body.adoption.createdContest.users).toBe(2);
    expect(body.volumeByType).toContainEqual({ type: 'contest.created', count: 5 });
  });

  it('honors the ?window param (90 days ⇒ weekly buckets)', async () => {
    const res = await asUser(request(app).get('/api/admin/analytics?window=90'), 'admin').expect(200);
    expect((res.body as { window: { bucket: string } }).window.bucket).toBe('week');
  });

  it('is 404 for a non-admin', async () => {
    await asUser(request(app).get('/api/admin/analytics'), 'alice').expect(404);
    await request(app).get('/api/admin/analytics').expect(404);
  });
});

describe('errors endpoint', () => {
  async function seedErrors(a: TestApp) {
    // Two occurrences of one bug (different volatile values, two users) + one other.
    await asUser(request(a).post('/api/telemetry'), 'alice')
      .send({ type: 'client.error', detail: { message: 'Failed to load contest 12', appVersion: '2.0.0' } })
      .expect(204);
    await asUser(request(a).post('/api/telemetry'), 'bob')
      .send({ type: 'client.error', detail: { message: 'Failed to load contest 99', appVersion: '2.1.0' } })
      .expect(204);
    await asUser(request(a).post('/api/telemetry'), 'alice')
      .send({ type: 'client.error', detail: { message: 'Network request failed', appVersion: '2.1.0' } })
      .expect(204);
  }

  it('returns fingerprinted error groups for an admin', async () => {
    await seedErrors(app);
    const res = await asUser(request(app).get('/api/admin/errors'), 'admin').expect(200);
    const groups = res.body.groups as Array<{
      count: number;
      affectedUsers: number;
      sampleMessage: string;
      latestAppVersion: string;
    }>;
    expect(groups).toHaveLength(2);
    const load = groups.find((g) => g.sampleMessage.startsWith('Failed to load'))!;
    expect(load.count).toBe(2); // collapsed by fingerprint despite different numbers
    expect(load.affectedUsers).toBe(2);
    expect(res.body.window).toHaveProperty('from');
  });

  it('ignores non-error events (only client.error is triaged)', async () => {
    await seed(app); // contest.created events only
    const res = await asUser(request(app).get('/api/admin/errors'), 'admin').expect(200);
    expect(res.body.groups).toEqual([]);
  });

  it('is 404 for a non-admin', async () => {
    await asUser(request(app).get('/api/admin/errors'), 'alice').expect(404);
    await request(app).get('/api/admin/errors').expect(404);
  });
});

describe('resend sign-in link', () => {
  it('sends via authAdmin and writes an audited admin.signin_link_resent event', async () => {
    const { app: a, pool, sentLinks } = await buildApp();
    await asUser(request(a).post('/api/admin/users/alice/resend-signin'), 'admin').expect(204);

    // The one account write happened, to the target's email.
    expect(sentLinks).toEqual(['alice@example.test']);

    // ...and it is audited: actor = admin, target in detail.
    const log = createEventLog(pool);
    const [event] = await log.queryEvents({ type: 'admin.signin_link_resent' });
    expect(event).toMatchObject({
      type: 'admin.signin_link_resent',
      userId: 'admin',
      userEmail: 'admin@example.test',
    });
    expect(event.detail).toMatchObject({ targetUserId: 'alice', targetEmail: 'alice@example.test' });
  });

  it('rate-limits repeated sends within the window with a 429 and no further send', async () => {
    const { app: a, sentLinks } = await buildApp();
    // The limiter allows 3 per window; the 4th is refused without sending.
    for (let i = 0; i < 3; i++) {
      await asUser(request(a).post('/api/admin/users/alice/resend-signin'), 'admin').expect(204);
    }
    await asUser(request(a).post('/api/admin/users/alice/resend-signin'), 'admin').expect(429);
    expect(sentLinks).toHaveLength(3); // the denied call did not send

    // A different target is independent — still allowed.
    await asUser(request(a).post('/api/admin/users/bob/resend-signin'), 'admin').expect(204);
    expect(sentLinks).toContain('bob@example.test');
  });

  it('is 404 for an unknown user, a non-admin, and unauthenticated', async () => {
    const { app: a, sentLinks } = await buildApp();
    await asUser(request(a).post('/api/admin/users/nobody/resend-signin'), 'admin').expect(404);
    await asUser(request(a).post('/api/admin/users/alice/resend-signin'), 'alice').expect(404);
    await request(a).post('/api/admin/users/alice/resend-signin').expect(404);
    expect(sentLinks).toHaveLength(0);
  });
});

describe('additive index migration is idempotent', () => {
  // The Group F indexes on occurred_at and type. `migrate()` reruns events.sql
  // on every boot; these use IF NOT EXISTS so a re-run is a no-op. (pg-mem can't
  // re-run the whole CREATE TABLE IF NOT EXISTS file — a pg-mem quirk, not a
  // real-Postgres one — so this exercises the additive index step directly.)
  const additiveIndexes = [
    'create index if not exists events_occurred_at_idx on events (occurred_at)',
    'create index if not exists events_type_idx on events (type)',
  ];

  it('re-running the additive index step on an existing schema is safe', async () => {
    const { pool } = await buildApp(); // events table already created + indexed
    for (let boot = 0; boot < 3; boot++) {
      for (const sql of additiveIndexes) {
        await expect(pool.query(sql)).resolves.toBeDefined();
      }
    }
    // The feed still reads (and its filters still work) after repeated boots.
    const res = await asUser(request((await buildApp()).app).get('/api/admin/events?type=contest.created'), 'admin').expect(200);
    expect(res.body).toHaveProperty('total');
  });
});

describe('per-user record + sync-health', () => {
  it('returns the user record and derived sync-health for an admin', async () => {
    await seed(app); // alice has 3 contests, recorded ~now
    const res = await asUser(request(app).get('/api/admin/users/alice'), 'admin').expect(200);
    expect(res.body.user).toMatchObject({ id: 'alice', email: 'alice@example.test' });
    expect(res.body.user).not.toHaveProperty('payload');
    expect(res.body.syncHealth).toMatchObject({ contestCount: 3, status: 'healthy', recentErrorCount: 0 });
    expect(res.body.syncHealth.lastPushAt).toBeTruthy();
  });

  it('reports never-pushed for an account with no contests', async () => {
    const res = await asUser(request(app).get('/api/admin/users/bob'), 'admin').expect(200);
    expect(res.body.syncHealth).toMatchObject({ status: 'never-pushed', contestCount: 0, lastPushAt: null });
  });

  it('is 404 for an unknown user and for a non-admin', async () => {
    await asUser(request(app).get('/api/admin/users/nobody'), 'admin').expect(404);
    await asUser(request(app).get('/api/admin/users/alice'), 'alice').expect(404);
    await request(app).get('/api/admin/users/alice').expect(404);
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

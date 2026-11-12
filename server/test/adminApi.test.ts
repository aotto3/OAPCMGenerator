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
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryUserDirectory, type UserRecord } from '../src/userDirectory';
import { buildTestApp, TEST_START, type TestApp } from './harness';
import type { AppDeps } from '../src/app';

const DAY = 24 * 60 * 60 * 1000;
/** A fixed time `msAgo` before the harness clock start (the routes' "now"). */
const iso = (msAgo = 0) => new Date(new Date(TEST_START).getTime() - msAgo).toISOString();

// Three accounts: an admin plus two users, one seen recently and one long ago.
const USERS: UserRecord[] = [
  { id: 'admin', email: 'admin@example.test', createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: iso(0) },
  { id: 'alice', email: 'alice@example.test', createdAt: '2026-02-01T00:00:00.000Z', lastSeenAt: iso(2 * DAY) },
  { id: 'bob', email: 'bob@example.test', createdAt: '2026-03-01T00:00:00.000Z', lastSeenAt: iso(30 * DAY) },
];

/** The harness with the three accounts and `admin@example.test` allowlisted. */
const buildApp = (overrides: Partial<AppDeps> = {}) =>
  buildTestApp({
    userDirectory: createInMemoryUserDirectory(USERS),
    adminEmails: new Set(['admin@example.test']),
    ...overrides,
  });

const envelope = (id: string): string =>
  JSON.stringify({ schemaVersion: 3, contest: { id, identity: { hostSchoolName: 'Test' } } });
const contestBody = (id: string, name = id) => ({
  id,
  name,
  // Pushed at the harness clock's now, so sync-health reads the account as healthy.
  updatedAt: iso(),
  payload: envelope(id),
});

/** Seeds contests (each POST also records one contest.created event). */
async function seed(a: TestApp) {
  await a.as('alice').post('/api/contests').send(contestBody('a1', 'Alice One')).expect(201);
  await a.as('alice').post('/api/contests').send(contestBody('a2', 'Alice Two')).expect(201);
  await a.as('alice').post('/api/contests').send(contestBody('a3', 'Alice Three')).expect(201);
  await a.as('bob').post('/api/contests').send(contestBody('b1', 'Bob One')).expect(201);
  await a.as('bob').post('/api/contests').send(contestBody('b2', 'Bob Two')).expect(201);
}

let h: TestApp;
beforeEach(async () => {
  h = await buildApp();
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
      await request(h.app).get(route).expect(404);
    }
  });

  it('answers 404 on every admin route for a signed-in non-admin', async () => {
    for (const route of routes) {
      await h.as('alice').get(route).expect(404);
    }
    // Drill-down routes are dark too.
    await h.as('alice').get('/api/admin/users/bob/contests').expect(404);
    await h.as('alice').get('/api/admin/users/bob/events').expect(404);
  });

  it('lets an allowlisted admin through the probe', async () => {
    const res = await h.as('admin').get('/api/admin/me').expect(200);
    expect(res.body).toEqual({ admin: true });
  });

  it('is dark to everyone when the allowlist is empty', async () => {
    const noAdmins = await buildApp({ adminEmails: new Set() });
    await noAdmins.as('admin').get('/api/admin/me').expect(404);
  });
});

describe('stats', () => {
  it('reflects real user, contest, active-this-week, and documents-generated counts', async () => {
    await seed(h);
    const res = await h.as('admin').get('/api/admin/stats').expect(200);
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
    await seed(h);
    const res = await h.as('admin').get('/api/admin/users').expect(200);
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
    await seed(h);
    const res = await h.as('admin').get('/api/admin/events').expect(200);
    expect(res.body.total).toBe(5);
    const names = (res.body.events as Array<{ contestName: string }>).map((e) => e.contestName);
    // Newest first: last seeded (Bob Two) leads, first seeded (Alice One) trails.
    expect(names).toEqual(['Bob Two', 'Bob One', 'Alice Three', 'Alice Two', 'Alice One']);
    expect((res.body.events as Array<{ userEmail: string }>)[0].userEmail).toBe('bob@example.test');
  });

  it('paginates with limit and offset', async () => {
    await seed(h);
    const page1 = await h.as('admin').get('/api/admin/events?limit=2&offset=0').expect(200);
    const page2 = await h.as('admin').get('/api/admin/events?limit=2&offset=2').expect(200);
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
    await seed(h);
    const res = await h.as('admin').get('/api/admin/events?userId=alice').expect(200);
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
    await a.as('alice').put('/api/contests/a1')
      .send(contestBody('a1', 'Alice One Renamed'))
      .expect(200); // contest.updated
    await a.as('bob').delete('/api/contests/b2').expect(204); // contest.deleted
    await a.as('alice').post('/api/telemetry')
      .send({ type: 'documents.generated', contestId: 'a2', contestName: 'Alice Two' })
      .expect(204);
    await a.as('bob').post('/api/telemetry')
      .send({ type: 'client.error', detail: { message: 'Kaboom while rendering', appVersion: '2.0.0' } })
      .expect(204);
  }

  it('filters by event type, with a matching total', async () => {
    await seedRich(h);
    const res = await h.as('admin').get('/api/admin/events?type=contest.deleted').expect(200);
    expect(res.body.total).toBe(1);
    const events = res.body.events as Array<{ type: string; contestName: string }>;
    expect(events.map((e) => e.type)).toEqual(['contest.deleted']);
    expect(events[0].contestName).toBe('Bob Two');
  });

  it('filters by contest id', async () => {
    await seedRich(h);
    const res = await h.as('admin').get('/api/admin/events?contestId=a1').expect(200);
    // a1 was created then renamed — two events, both for that contest.
    expect(res.body.total).toBe(2);
    const events = res.body.events as Array<{ type: string; contestId: string }>;
    expect(events.every((e) => e.contestId === 'a1')).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['contest.updated', 'contest.created']);
  });

  it('filters by an inclusive ISO date range', async () => {
    // Two events straddling a boundary, recorded directly so timestamps are exact.
    const a2 = await buildApp();
    const log = a2.deps.eventLog;
    await log.recordEvent({ occurredAt: '2026-05-01T00:00:00.000Z', userId: 'alice', userEmail: 'alice@example.test', type: 'contest.created', contestName: 'May' });
    await log.recordEvent({ occurredAt: '2026-06-15T00:00:00.000Z', userId: 'alice', userEmail: 'alice@example.test', type: 'contest.created', contestName: 'June' });
    await log.recordEvent({ occurredAt: '2026-07-20T00:00:00.000Z', userId: 'alice', userEmail: 'alice@example.test', type: 'contest.created', contestName: 'July' });

    const res = await a2.as('admin').get('/api/admin/events?from=2026-06-01T00:00:00.000Z&to=2026-07-01T00:00:00.000Z').expect(200);
    expect(res.body.total).toBe(1);
    expect((res.body.events as Array<{ contestName: string }>).map((e) => e.contestName)).toEqual(['June']);
  });

  it('free-text matches email, contest name, and the error message in detail', async () => {
    await seedRich(h);

    // Contest name (case-insensitive).
    const byName = await h.as('admin').get('/api/admin/events?text=renamed').expect(200);
    expect((byName.body.events as Array<{ contestName: string }>).map((e) => e.contestName)).toEqual([
      'Alice One Renamed',
    ]);

    // Email substring — every bob event.
    const byEmail = await h.as('admin').get('/api/admin/events?text=bob@').expect(200);
    expect(byEmail.body.total).toBeGreaterThan(0);
    expect((byEmail.body.events as Array<{ userEmail: string }>).every((e) => e.userEmail === 'bob@example.test')).toBe(true);

    // Error message inside detail.
    const byError = await h.as('admin').get('/api/admin/events?text=kaboom').expect(200);
    expect(byError.body.total).toBe(1);
    expect((byError.body.events as Array<{ type: string }>)[0].type).toBe('client.error');
  });

  it('combines the new filters with the existing user filter', async () => {
    await seedRich(h);
    // Alice's document-generation only: user + type together.
    const res = await h.as('admin').get('/api/admin/events?userId=alice&type=documents.generated').expect(200);
    expect(res.body.total).toBe(1);
    const events = res.body.events as Array<{ userId: string; type: string; contestName: string }>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: 'alice', type: 'documents.generated', contestName: 'Alice Two' });

    // A contradictory combination (bob + alice-only text) yields nothing.
    const empty = await h.as('admin').get('/api/admin/events?userId=bob&type=documents.generated').expect(200);
    expect(empty.body.total).toBe(0);
    expect(empty.body.events).toEqual([]);
  });

  it('paginates a filtered feed with a filtered total', async () => {
    await seedRich(h);
    // All alice events (3 created + 1 updated + 1 doc-gen = 5), 2 per page.
    const page1 = await h.as('admin').get('/api/admin/events?userId=alice&limit=2&offset=0').expect(200);
    expect(page1.body.total).toBe(5);
    expect((page1.body.events as unknown[]).length).toBe(2);
  });
});

describe('analytics endpoint', () => {
  it('returns the report shape for an admin over the default window', async () => {
    await seed(h); // 5 contest.created (3 alice, 2 bob), all "now"
    // The admin reads a minute later; the window's end is exclusive, so events
    // stamped at the very instant of the read would fall outside it.
    h.clock.advance(60 * 1000);
    const res = await h.as('admin').get('/api/admin/analytics').expect(200);
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
    const res = await h.as('admin').get('/api/admin/analytics?window=90').expect(200);
    expect((res.body as { window: { bucket: string } }).window.bucket).toBe('week');
  });

  it('is 404 for a non-admin', async () => {
    await h.as('alice').get('/api/admin/analytics').expect(404);
    await request(h.app).get('/api/admin/analytics').expect(404);
  });
});

describe('errors endpoint', () => {
  async function seedErrors(a: TestApp) {
    // Two occurrences of one bug (different volatile values, two users) + one other.
    await a.as('alice').post('/api/telemetry')
      .send({ type: 'client.error', detail: { message: 'Failed to load contest 12', appVersion: '2.0.0' } })
      .expect(204);
    await a.as('bob').post('/api/telemetry')
      .send({ type: 'client.error', detail: { message: 'Failed to load contest 99', appVersion: '2.1.0' } })
      .expect(204);
    await a.as('alice').post('/api/telemetry')
      .send({ type: 'client.error', detail: { message: 'Network request failed', appVersion: '2.1.0' } })
      .expect(204);
  }

  it('returns fingerprinted error groups for an admin', async () => {
    await seedErrors(h);
    const res = await h.as('admin').get('/api/admin/errors').expect(200);
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
    await seed(h); // contest.created events only
    const res = await h.as('admin').get('/api/admin/errors').expect(200);
    expect(res.body.groups).toEqual([]);
  });

  it('is 404 for a non-admin', async () => {
    await h.as('alice').get('/api/admin/errors').expect(404);
    await request(h.app).get('/api/admin/errors').expect(404);
  });
});

describe('resend sign-in link', () => {
  it('sends via authAdmin and writes an audited admin.signin_link_resent event', async () => {
    const a = await buildApp();
    await a.as('admin').post('/api/admin/users/alice/resend-signin').expect(204);

    // The one account write happened, to the target's email.
    expect(a.signInLinks).toEqual(['alice@example.test']);

    // ...and it is audited: actor = admin, target in detail.
    const [event] = await a.deps.eventLog.queryEvents({ type: 'admin.signin_link_resent' });
    expect(event).toMatchObject({
      type: 'admin.signin_link_resent',
      userId: 'admin',
      userEmail: 'admin@example.test',
    });
    expect(event.detail).toMatchObject({ targetUserId: 'alice', targetEmail: 'alice@example.test' });
  });

  it('rate-limits repeated sends within the window with a 429 and no further send', async () => {
    const a = await buildApp();
    // The limiter allows 3 per window; the 4th is refused without sending.
    for (let i = 0; i < 3; i++) {
      await a.as('admin').post('/api/admin/users/alice/resend-signin').expect(204);
    }
    await a.as('admin').post('/api/admin/users/alice/resend-signin').expect(429);
    expect(a.signInLinks).toHaveLength(3); // the denied call did not send

    // A different target is independent — still allowed.
    await a.as('admin').post('/api/admin/users/bob/resend-signin').expect(204);
    expect(a.signInLinks).toContain('bob@example.test');
  });

  it('is 404 for an unknown user, a non-admin, and unauthenticated', async () => {
    const a = await buildApp();
    await a.as('admin').post('/api/admin/users/nobody/resend-signin').expect(404);
    await a.as('alice').post('/api/admin/users/alice/resend-signin').expect(404);
    await request(a.app).post('/api/admin/users/alice/resend-signin').expect(404);
    expect(a.signInLinks).toHaveLength(0);
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
    const res = await (await buildApp()).as('admin').get('/api/admin/events?type=contest.created').expect(200);
    expect(res.body).toHaveProperty('total');
  });
});

describe('per-user record + sync-health', () => {
  it('returns the user record and derived sync-health for an admin', async () => {
    await seed(h); // alice has 3 contests, recorded ~now
    const res = await h.as('admin').get('/api/admin/users/alice').expect(200);
    expect(res.body.user).toMatchObject({ id: 'alice', email: 'alice@example.test' });
    expect(res.body.user).not.toHaveProperty('payload');
    expect(res.body.syncHealth).toMatchObject({ contestCount: 3, status: 'healthy', recentErrorCount: 0 });
    expect(res.body.syncHealth.lastPushAt).toBeTruthy();
  });

  it('reports never-pushed for an account with no contests', async () => {
    const res = await h.as('admin').get('/api/admin/users/bob').expect(200);
    expect(res.body.syncHealth).toMatchObject({ status: 'never-pushed', contestCount: 0, lastPushAt: null });
  });

  it('is 404 for an unknown user and for a non-admin', async () => {
    await h.as('admin').get('/api/admin/users/nobody').expect(404);
    await h.as('alice').get('/api/admin/users/alice').expect(404);
    await request(h.app).get('/api/admin/users/alice').expect(404);
  });
});

describe('per-user drill-down', () => {
  it("returns a user's contest metadata (no payloads)", async () => {
    await seed(h);
    const res = await h.as('admin').get('/api/admin/users/alice/contests').expect(200);
    const contests = res.body.contests as Array<Record<string, unknown>>;
    expect(contests.map((c) => c.name).sort()).toEqual(['Alice One', 'Alice Three', 'Alice Two']);
    // Metadata only — the opaque payload is never surfaced.
    expect(contests.every((c) => !('payload' in c))).toBe(true);
  });

  it("returns a user's personal activity feed", async () => {
    await seed(h);
    const res = await h.as('admin').get('/api/admin/users/bob/events').expect(200);
    expect(res.body.total).toBe(2);
    const events = res.body.events as Array<{ userId: string; contestName: string }>;
    expect(events.every((e) => e.userId === 'bob')).toBe(true);
    expect(events.map((e) => e.contestName)).toEqual(['Bob Two', 'Bob One']);
  });
});

/**
 * Judge questionnaire routes (PRD #252, slice #254), integration-tested on the
 * production app factory with pg-mem and a fake session (x-user-id header), like
 * the contest CRUD suite. Rate limiters are injected with tight limits and a
 * manual clock so the limits are observable without waiting.
 *
 * These lock in: the link token is per account and resettable; the roster is
 * validated and owner-scoped; the public lookup returns a judge's contests only
 * on an email match and is indistinguishable (404) for an unknown token, an
 * unknown email, a filled honeypot, or a malformed body; limits answer 429.
 */
import { newDb } from 'pg-mem';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createContestRepo } from '../src/contestRepo';
import { createEventLog } from '../src/eventLog';
import { createQuestionnaireRepo } from '../src/questionnaireRepo';
import { createRateLimiter } from '../src/rateLimiter';
import { createInMemoryUserDirectory } from '../src/userDirectory';
import { migrate, type Pool } from '../src/db';

let clock = 0;

async function buildApp(limits = { perIp: 1000, perEmail: 1000 }) {
  const mem = newDb();
  const pool = new (mem.adapters.createPg().Pool)() as unknown as Pool;
  await migrate(pool);
  return createApp({
    repo: createContestRepo(pool),
    questionnaireRepo: createQuestionnaireRepo(pool),
    questionnaireLimiters: {
      perIp: createRateLimiter({ limit: limits.perIp, windowMs: 1000, now: () => clock }),
      perEmail: createRateLimiter({ limit: limits.perEmail, windowMs: 1000, now: () => clock }),
    },
    eventLog: createEventLog(pool),
    userDirectory: createInMemoryUserDirectory([]),
    authAdmin: { sendSignInLink: async () => {} },
    adminEmails: new Set(),
    resolveUser: (req) => {
      const id = req.header('x-user-id');
      return id ? { id, email: `${id}@example.test` } : null;
    },
  });
}

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
beforeEach(async () => {
  clock = 0;
  app = await buildApp();
});

const ZONE1 = {
  id: 'z1',
  title: '2027 — 5A Zone 1 OAP',
  level: 'Zone',
  date: '2027-03-04',
  host: 'Friendswood HS',
  cmEmail: 'cm@example.org',
};
const ZONE2 = { ...ZONE1, id: 'z2', title: '2027 — 5A Zone 2 OAP', date: '2027-03-05' };
const DISTRICT = { ...ZONE1, id: 'd', title: '2027 — 5A District 20 OAP', level: 'District', date: '2027-03-25' };

const ROSTER = {
  contests: [ZONE1, ZONE2, DISTRICT],
  judges: [
    { email: 'jane@x.org', name: 'Jane Judge', contestIds: ['z1', 'z2'] },
    { email: 'sam@x.org', name: 'Sam Lee', contestIds: ['d'] },
  ],
};

async function linkToken(a: App, user: string): Promise<string> {
  const res = await request(a).get('/api/questionnaire/link').set('x-user-id', user).expect(200);
  return res.body.token as string;
}

function publish(a: App, user: string, roster: unknown = ROSTER) {
  return request(a).put('/api/questionnaire/roster').set('x-user-id', user).send({ roster });
}

function lookup(a: App, body: Record<string, unknown>) {
  return request(a).post('/api/questionnaire/public/lookup').send(body);
}

describe('owner routes', () => {
  it('require a session', async () => {
    await request(app).get('/api/questionnaire/link').expect(401);
    await request(app).post('/api/questionnaire/link/reset').expect(401);
    await request(app).put('/api/questionnaire/roster').send({ roster: ROSTER }).expect(401);
  });

  it('give each account one standing token that stays the same', async () => {
    const first = await linkToken(app, 'alice');
    expect(first).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(await linkToken(app, 'alice')).toBe(first);
    expect(await linkToken(app, 'bob')).not.toBe(first);
  });

  it('reset issues a new token and the old link stops finding judges', async () => {
    const old = await linkToken(app, 'alice');
    await publish(app, 'alice').expect(204);
    const reset = await request(app).post('/api/questionnaire/link/reset').set('x-user-id', 'alice').expect(200);
    expect(reset.body.token).not.toBe(old);
    expect(await linkToken(app, 'alice')).toBe(reset.body.token);
    await lookup(app, { token: old, email: 'jane@x.org' }).expect(404);
    await lookup(app, { token: reset.body.token, email: 'jane@x.org' }).expect(200);
  });

  it('refuses a malformed roster', async () => {
    await publish(app, 'alice', { contests: 'nope', judges: [] }).expect(400);
    await publish(app, 'alice', { ...ROSTER, judges: [{ email: 'a@x.org', name: 'A', contestIds: ['missing'] }] }).expect(
      400,
    );
    await publish(app, 'alice', { contests: [{ ...ZONE1, title: 'x'.repeat(400) }], judges: [] }).expect(400);
  });
});

describe('public lookup', () => {
  it("returns the judge's name and only their contests, with CM emails", async () => {
    const token = await linkToken(app, 'alice');
    await publish(app, 'alice').expect(204);
    const res = await lookup(app, { token, email: 'jane@x.org', website: '' }).expect(200);
    expect(res.body).toEqual({ judgeName: 'Jane Judge', contests: [ZONE1, ZONE2], lastSubmission: null });
  });

  it('matches the email regardless of case and spacing', async () => {
    const token = await linkToken(app, 'alice');
    await publish(app, 'alice').expect(204);
    const res = await lookup(app, { token, email: '  SAM@X.org ' }).expect(200);
    expect(res.body.contests).toEqual([DISTRICT]);
  });

  it('answers the same 404 for unknown email, unknown token, honeypot, and junk', async () => {
    const token = await linkToken(app, 'alice');
    await publish(app, 'alice').expect(204);
    const responses = await Promise.all([
      lookup(app, { token, email: 'nobody@x.org' }),
      lookup(app, { token: 'not-a-real-token', email: 'jane@x.org' }),
      lookup(app, { token, email: 'jane@x.org', website: 'http://spam.example' }),
      lookup(app, { token, email: 42 }),
      lookup(app, {}),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'not_found' });
    }
  });

  it("never crosses accounts: one account's token cannot find another's judges", async () => {
    const aliceToken = await linkToken(app, 'alice');
    await publish(app, 'bob').expect(204);
    await lookup(app, { token: aliceToken, email: 'jane@x.org' }).expect(404);
  });

  it('finds nothing before the account has published a roster', async () => {
    const token = await linkToken(app, 'alice');
    await lookup(app, { token, email: 'jane@x.org' }).expect(404);
  });

  it('reflects the latest published roster', async () => {
    const token = await linkToken(app, 'alice');
    await publish(app, 'alice').expect(204);
    await publish(app, 'alice', { contests: [DISTRICT], judges: [{ email: 'sam@x.org', name: 'Sam', contestIds: ['d'] }] });
    await lookup(app, { token, email: 'jane@x.org' }).expect(404);
  });

  it('rate-limits repeated guesses for one email, then recovers after the window', async () => {
    app = await buildApp({ perIp: 1000, perEmail: 2 });
    const token = await linkToken(app, 'alice');
    await publish(app, 'alice').expect(204);
    await lookup(app, { token, email: 'jane@x.org' }).expect(200);
    await lookup(app, { token, email: 'JANE@x.org' }).expect(200);
    await lookup(app, { token, email: 'jane@x.org' }).expect(429);
    await lookup(app, { token, email: 'sam@x.org' }).expect(200);
    clock = 5000;
    await lookup(app, { token, email: 'jane@x.org' }).expect(200);
  });

  it('rate-limits a client making many lookups', async () => {
    app = await buildApp({ perIp: 2, perEmail: 1000 });
    const token = await linkToken(app, 'alice');
    await lookup(app, { token, email: 'a@x.org' }).expect(404);
    await lookup(app, { token, email: 'b@x.org' }).expect(404);
    await lookup(app, { token, email: 'c@x.org' }).expect(429);
  });
});

const ANSWERS = {
  cellPhone: '512-555-0100',
  mailingAddress: '1 Main St',
  dietary: 'vegetarian',
  needsPower: true,
  bio: 'A bio',
  notes: 'Arriving late',
  contests: {
    z1: { hotelBefore: true, hotelAfter: true, requestingFlight: false },
    z2: { hotelBefore: true, hotelAfter: false, requestingFlight: false },
  },
};

function submit(a: App, body: Record<string, unknown>) {
  return request(a).post('/api/questionnaire/public/submit').send(body);
}

async function ready(a: App = app): Promise<string> {
  const token = await linkToken(a, 'alice');
  await publish(a, 'alice').expect(204);
  return token;
}

describe('public submit', () => {
  it('stores the answers, returns them on the next lookup, and lists them for the owner', async () => {
    const token = await ready();
    const res = await submit(app, { token, email: 'JANE@x.org', website: '', answers: ANSWERS }).expect(200);
    expect(typeof res.body.submittedAt).toBe('string');

    const again = await lookup(app, { token, email: 'jane@x.org' }).expect(200);
    expect(again.body.lastSubmission).toEqual(ANSWERS);

    const list = await request(app).get('/api/questionnaire/submissions').set('x-user-id', 'alice').expect(200);
    expect(list.body.submissions).toEqual([{ email: 'jane@x.org', submittedAt: res.body.submittedAt, answers: ANSWERS }]);
  });

  it('a resubmit replaces the earlier answers', async () => {
    const token = await ready();
    await submit(app, { token, email: 'jane@x.org', answers: ANSWERS }).expect(200);
    await submit(app, { token, email: 'jane@x.org', answers: { ...ANSWERS, dietary: 'vegan' } }).expect(200);
    const list = await request(app).get('/api/questionnaire/submissions').set('x-user-id', 'alice').expect(200);
    expect(list.body.submissions).toHaveLength(1);
    expect(list.body.submissions[0].answers.dietary).toBe('vegan');
  });

  it("refuses answers for a contest the judge isn't on, or malformed answers", async () => {
    const token = await ready();
    const notTheirs = { ...ANSWERS, contests: { d: { hotelBefore: false, hotelAfter: false, requestingFlight: false } } };
    await submit(app, { token, email: 'jane@x.org', answers: notTheirs }).expect(400);
    await submit(app, { token, email: 'jane@x.org', answers: { ...ANSWERS, needsPower: 'yes' } }).expect(400);
    await submit(app, { token, email: 'jane@x.org', answers: { ...ANSWERS, bio: 'x'.repeat(5000) } }).expect(400);
    await submit(app, { token, email: 'jane@x.org' }).expect(400);
  });

  it('drops unknown fields', async () => {
    const token = await ready();
    await submit(app, { token, email: 'jane@x.org', answers: { ...ANSWERS, name: 'Hacker' } }).expect(200);
    const again = await lookup(app, { token, email: 'jane@x.org' }).expect(200);
    expect(again.body.lastSubmission).not.toHaveProperty('name');
  });

  it('answers 404 for an unknown email or token, the same as lookup', async () => {
    const token = await ready();
    await submit(app, { token, email: 'nobody@x.org', answers: ANSWERS }).expect(404);
    await submit(app, { token: 'nope', email: 'jane@x.org', answers: ANSWERS }).expect(404);
  });

  it('tells a honeypot bot it succeeded but stores nothing', async () => {
    const token = await ready();
    await submit(app, { token, email: 'jane@x.org', website: 'http://spam', answers: ANSWERS }).expect(200);
    const list = await request(app).get('/api/questionnaire/submissions').set('x-user-id', 'alice').expect(200);
    expect(list.body.submissions).toEqual([]);
  });

  it('shares the per-email rate limit with lookups', async () => {
    app = await buildApp({ perIp: 1000, perEmail: 2 });
    const token = await ready(app);
    await lookup(app, { token, email: 'jane@x.org' }).expect(200);
    await submit(app, { token, email: 'jane@x.org', answers: ANSWERS }).expect(200);
    await submit(app, { token, email: 'jane@x.org', answers: ANSWERS }).expect(429);
  });

  it("keeps submissions per account and requires a session to list them", async () => {
    const token = await ready();
    await submit(app, { token, email: 'jane@x.org', answers: ANSWERS }).expect(200);
    await request(app).get('/api/questionnaire/submissions').expect(401);
    const bob = await request(app).get('/api/questionnaire/submissions').set('x-user-id', 'bob').expect(200);
    expect(bob.body.submissions).toEqual([]);
  });
});

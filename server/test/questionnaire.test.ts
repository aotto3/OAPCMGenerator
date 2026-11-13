/**
 * Judge questionnaire routes over HTTP (PRD #252; reduced to HTTP concerns in
 * RFC #270 slice #273). Built on the production app factory via the test
 * harness: pg-mem, a fake session (x-user-id header), tight rate limits on the
 * test clock.
 *
 * What lives here: session gates, the mapping of service results to statuses
 * and bodies, rate limits, the honeypot, and the 500 guard. The questionnaire
 * rules themselves (roster limits, matching, answers, notices) are covered at
 * the service boundary in questionnaireService.test.ts.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_ROSTER_FIELD_LENGTH } from '../src/judgeRoster';
import { MAX_ROSTER_BYTES } from '../src/questionnaireStore';
import { buildTestApp, TEST_START, type TestApp } from './harness';

const build = (limits = { perIp: 1000, perEmail: 1000 }) => buildTestApp({}, { limits });

let h: TestApp;
beforeEach(async () => {
  h = await build();
});

const ZONE1 = {
  id: 'z1',
  title: '2027 - 5A Zone 1 OAP',
  level: 'Zone',
  date: '2027-03-04',
  host: 'Friendswood HS',
  cmEmail: 'cm@example.org',
};
const ROSTER = { contests: [ZONE1], judges: [{ email: 'jane@x.org', name: 'Jane Judge', contestIds: ['z1'] }] };

const ANSWERS = {
  cellPhone: '512-555-0100',
  mailingAddress: '1 Main St',
  dietary: '',
  bio: '',
  notes: '',
  contests: { z1: { hotelBefore: true, hotelAfter: false, requestingFlight: false, needsPower: true } },
};

async function linkToken(a: TestApp, user: string): Promise<string> {
  const res = await a.as(user).get('/api/questionnaire/link').expect(200);
  return res.body.token as string;
}

const publish = (a: TestApp, user: string, roster: unknown = ROSTER) =>
  a.as(user).put('/api/questionnaire/roster').send({ roster });
const lookup = (a: TestApp, body: Record<string, unknown>) =>
  request(a.app).post('/api/questionnaire/public/lookup').send(body);
const submit = (a: TestApp, body: Record<string, unknown>) =>
  request(a.app).post('/api/questionnaire/public/submit').send(body);

async function ready(a: TestApp = h): Promise<string> {
  const token = await linkToken(a, 'alice');
  await publish(a, 'alice').expect(204);
  return token;
}

describe('owner routes', () => {
  it('require a session', async () => {
    await request(h.app).get('/api/questionnaire/link').expect(401, { error: 'Authentication required' });
    await request(h.app).post('/api/questionnaire/link/reset').expect(401);
    await request(h.app).put('/api/questionnaire/roster').send({ roster: ROSTER }).expect(401);
    await request(h.app).get('/api/questionnaire/submissions').expect(401);
  });

  it('answer the link and a reset as { token }', async () => {
    const first = await h.as('alice').get('/api/questionnaire/link').expect(200);
    expect(Object.keys(first.body)).toEqual(['token']);
    expect(first.body.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const reset = await h.as('alice').post('/api/questionnaire/link/reset').expect(200);
    expect(Object.keys(reset.body)).toEqual(['token']);
    expect(reset.body.token).not.toBe(first.body.token);
  });

  it('answer the public link check as { active }, false once reset or malformed', async () => {
    const old = await ready();
    const check = (body: unknown) => request(h.app).post('/api/questionnaire/public/link').send(body as object);
    await check({ token: old }).expect(200, { active: true });
    await h.as('alice').post('/api/questionnaire/link/reset').expect(200);
    await check({ token: old }).expect(200, { active: false });
    await check({ token: 42 }).expect(200, { active: false });
    await check({ token: 'x'.repeat(65) }).expect(200, { active: false });
  });

  it('map roster results to 204, Invalid roster and Roster too large', async () => {
    await publish(h, 'alice').expect(204, '');
    await publish(h, 'alice', { contests: 'nope', judges: [] }).expect(400, { error: 'Invalid roster' });
    await h.as('alice').put('/api/questionnaire/roster').send({}).expect(400, { error: 'Invalid roster' });
    const name = 'n'.repeat(MAX_ROSTER_FIELD_LENGTH);
    const judges = Array.from({ length: Math.ceil(MAX_ROSTER_BYTES / name.length) + 1 }, (_, i) => ({
      email: `j${i}@x.org`,
      name,
      contestIds: ['z1'],
    }));
    await publish(h, 'alice', { contests: [ZONE1], judges }).expect(400, { error: 'Roster too large' });
  });

  it('list submissions as { submissions: [{ email, submittedAt, answers }] }', async () => {
    const token = await ready();
    await submit(h, { token, email: 'jane@x.org', answers: ANSWERS }).expect(200);
    const list = await h.as('alice').get('/api/questionnaire/submissions').expect(200);
    expect(list.body).toEqual({ submissions: [{ email: 'jane@x.org', submittedAt: TEST_START, answers: ANSWERS }] });
    expect(Object.keys(list.body.submissions[0])).toEqual(['email', 'submittedAt', 'answers']);
  });
});

describe('public lookup', () => {
  it('answers a match as { judgeName, contests, lastSubmission, contactOnFile }', async () => {
    const token = await ready();
    const res = await lookup(h, { token, email: 'jane@x.org', website: '' }).expect(200);
    expect(res.body).toEqual({
      judgeName: 'Jane Judge',
      contests: [ZONE1],
      lastSubmission: null,
      contactOnFile: { cellPhone: false, mailingAddress: false },
    });
    expect(Object.keys(res.body)).toEqual(['judgeName', 'contests', 'lastSubmission', 'contactOnFile']);
  });

  it('answers the same 404 for unknown email, unknown token, honeypot, and junk', async () => {
    const token = await ready();
    const responses = await Promise.all([
      lookup(h, { token, email: 'nobody@x.org' }),
      lookup(h, { token: 'not-a-real-token', email: 'jane@x.org' }),
      lookup(h, { token, email: 'jane@x.org', website: 'http://spam.example' }),
      lookup(h, { token, email: 42 }),
      lookup(h, { token, email: '   ' }),
      lookup(h, { token: 'x'.repeat(65), email: 'jane@x.org' }),
      lookup(h, {}),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'not_found' });
    }
  });

  it('rate-limits repeated guesses for one email, then recovers after the window', async () => {
    h = await build({ perIp: 1000, perEmail: 2 });
    const token = await ready(h);
    await lookup(h, { token, email: 'jane@x.org' }).expect(200);
    await lookup(h, { token, email: 'JANE@x.org' }).expect(200);
    await lookup(h, { token, email: 'jane@x.org' }).expect(429, { error: 'rate_limited' });
    await lookup(h, { token, email: 'sam@x.org' }).expect(404);
    h.clock.advance(5000);
    await lookup(h, { token, email: 'jane@x.org' }).expect(200);
  });

  it('rate-limits a client making many lookups', async () => {
    h = await build({ perIp: 2, perEmail: 1000 });
    const token = await linkToken(h, 'alice');
    await lookup(h, { token, email: 'a@x.org' }).expect(404);
    await lookup(h, { token, email: 'b@x.org' }).expect(404);
    await lookup(h, { token, email: 'c@x.org' }).expect(429, { error: 'rate_limited' });
  });
});

describe('public submit', () => {
  it('answers { submittedAt } from the clock and notifies the CM', async () => {
    const token = await ready();
    h.clock.advance(1000);
    const res = await submit(h, { token, email: 'JANE@x.org', website: '', answers: ANSWERS }).expect(200);
    expect(res.body).toEqual({ submittedAt: '2026-09-01T12:00:01.000Z' });
    expect(h.sentMail.map((m) => m.to)).toEqual(['cm@example.org']);
  });

  it('maps invalid answers to 400 invalid_answers and an unknown judge to 404', async () => {
    const token = await ready();
    await submit(h, { token, email: 'jane@x.org', answers: { ...ANSWERS, needsPower: 'x' } }).expect(400, {
      error: 'invalid_answers',
    });
    await submit(h, { token, email: 'jane@x.org' }).expect(400, { error: 'invalid_answers' });
    await submit(h, { token, email: 'nobody@x.org', answers: ANSWERS }).expect(404, { error: 'not_found' });
    await submit(h, { token: 'nope', email: 'jane@x.org', answers: ANSWERS }).expect(404, { error: 'not_found' });
    expect(h.sentMail).toEqual([]);
  });

  it('tells a honeypot bot it succeeded but stores and sends nothing', async () => {
    const token = await ready();
    const res = await submit(h, { token, email: 'jane@x.org', website: 'http://spam', answers: ANSWERS }).expect(200);
    expect(res.body).toEqual({ submittedAt: TEST_START });
    const list = await h.as('alice').get('/api/questionnaire/submissions').expect(200);
    expect(list.body.submissions).toEqual([]);
    expect(h.sentMail).toEqual([]);
  });

  it('shares the per-email rate limit with lookups', async () => {
    h = await build({ perIp: 1000, perEmail: 2 });
    const token = await ready(h);
    await lookup(h, { token, email: 'jane@x.org' }).expect(200);
    await submit(h, { token, email: 'jane@x.org', answers: ANSWERS }).expect(200);
    await submit(h, { token, email: 'jane@x.org', answers: ANSWERS }).expect(429, { error: 'rate_limited' });
  });

  it('still answers 200 when the notice fails to send', async () => {
    const token = await ready();
    h.mailFails = true;
    await submit(h, { token, email: 'jane@x.org', answers: ANSWERS }).expect(200);
  });
});

describe('unexpected errors', () => {
  it('become a 500 on owner and public routes', async () => {
    const broken = async (): Promise<never> => {
      throw new Error('db down');
    };
    const b = await buildTestApp({
      questionnaireStore: {
        getToken: broken,
        setToken: broken,
        ownerForToken: broken,
        putRoster: broken,
        getRoster: broken,
        putSubmission: broken,
        getSubmission: broken,
        listSubmissions: broken,
      },
    });
    const err = { error: 'Internal server error' };
    await b.as('alice').get('/api/questionnaire/link').expect(500, err);
    await b.as('alice').put('/api/questionnaire/roster').send({ roster: ROSTER }).expect(500, err);
    await request(b.app).post('/api/questionnaire/public/lookup').send({ token: 't', email: 'a@x.org' }).expect(500, err);
  });
});

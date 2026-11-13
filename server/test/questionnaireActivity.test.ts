/**
 * Questionnaire activity events (#261). The public questionnaire routes append
 * to the activity log under the CM whose link was used: judge found, submitted,
 * email not on roster, rate limited (once per key per window) and honeypot.
 * Unknown tokens and the page-load link check log nothing, and a log failure
 * never changes the response. Asserted through the event log the admin feed
 * reads, over HTTP on the production app factory.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EventLog } from '../src/eventLog';
import { createEventLog } from '../src/eventLog';
import { createInMemoryUserDirectory } from '../src/userDirectory';
import { buildTestApp, TEST_START, type TestApp } from './harness';

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

const IP = '203.0.113.7';
const USERS = [{ id: 'alice', email: 'alice@cm.test', createdAt: TEST_START, lastSeenAt: TEST_START }];

const build = (limits = { perIp: 1000, perEmail: 1000 }) =>
  buildTestApp({ userDirectory: createInMemoryUserDirectory(USERS) }, { limits });

const post = (a: TestApp, path: string, body: Record<string, unknown>) =>
  request(a.app).post(`/api/questionnaire/public/${path}`).set('X-Forwarded-For', IP).send(body);

async function ready(a: TestApp): Promise<string> {
  const { body } = await a.as('alice').get('/api/questionnaire/link').expect(200);
  await a.as('alice').put('/api/questionnaire/roster').send({ roster: ROSTER }).expect(204);
  return body.token as string;
}

/** The questionnaire events, oldest first, without the surrogate key. */
async function events(a: TestApp) {
  const rows = await a.deps.eventLog.queryEvents({ limit: 500 });
  return rows
    .filter((e) => e.type.startsWith('questionnaire.'))
    .reverse()
    .map(({ userId, userEmail, type, detail }) => ({ userId, userEmail, type, detail }));
}

let h: TestApp;
beforeEach(async () => {
  h = await build();
});

describe('questionnaire activity events', () => {
  it('log a found judge and a submit under the link owner, without the IP', async () => {
    const token = await ready(h);
    await post(h, 'lookup', { token, email: ' JANE@x.org ' }).expect(200);
    await post(h, 'submit', { token, email: 'jane@x.org', answers: ANSWERS }).expect(200);
    expect(await events(h)).toEqual([
      {
        userId: 'alice',
        userEmail: 'alice@cm.test',
        type: 'questionnaire.judge_found',
        detail: { email: 'jane@x.org', judgeName: 'Jane Judge' },
      },
      { userId: 'alice', userEmail: 'alice@cm.test', type: 'questionnaire.submitted', detail: { email: 'jane@x.org' } },
    ]);
  });

  it('log an email that is not on the roster, with the IP, on lookup and submit', async () => {
    const token = await ready(h);
    await post(h, 'lookup', { token, email: 'guess@x.org' }).expect(404);
    await post(h, 'submit', { token, email: 'guess@x.org', answers: ANSWERS }).expect(404);
    expect((await events(h)).map((e) => [e.type, e.detail])).toEqual([
      ['questionnaire.not_on_roster', { action: 'lookup', email: 'guess@x.org', ip: IP }],
      ['questionnaire.not_on_roster', { action: 'submit', email: 'guess@x.org', ip: IP }],
    ]);
  });

  it('log a honeypot hit with the IP; the bot still gets its usual answer', async () => {
    const token = await ready(h);
    await post(h, 'lookup', { token, email: 'jane@x.org', website: 'spam' }).expect(404);
    expect((await events(h)).map((e) => [e.type, e.detail])).toEqual([
      ['questionnaire.honeypot', { email: 'jane@x.org', ip: IP }],
    ]);
  });

  it('log a per-IP rate-limit trip once per window, not per rejected request', async () => {
    h = await build({ perIp: 1, perEmail: 1000 });
    const token = await ready(h);
    await post(h, 'lookup', { token, email: 'jane@x.org' }).expect(200);
    await post(h, 'lookup', { token, email: 'jane@x.org' }).expect(429);
    await post(h, 'lookup', { token, email: 'jane@x.org' }).expect(429);
    await post(h, 'link', { token }).expect(429);
    const trips = (await events(h)).filter((e) => e.type === 'questionnaire.rate_limited');
    expect(trips.map((e) => e.detail)).toEqual([{ limit: 'ip', email: 'jane@x.org', ip: IP }]);

    // The next window logs the next trip.
    h.clock.advance(10 * 60 * 1000 + 1);
    await post(h, 'lookup', { token, email: 'jane@x.org' }).expect(200);
    await post(h, 'lookup', { token, email: 'jane@x.org' }).expect(429);
    expect((await events(h)).filter((e) => e.type === 'questionnaire.rate_limited')).toHaveLength(2);
  });

  it('log a per-email rate-limit trip once per window', async () => {
    h = await build({ perIp: 1000, perEmail: 1 });
    const token = await ready(h);
    await post(h, 'lookup', { token, email: 'jane@x.org' }).expect(200);
    await post(h, 'lookup', { token, email: 'jane@x.org' }).expect(429);
    await post(h, 'submit', { token, email: 'jane@x.org', answers: ANSWERS }).expect(429);
    const trips = (await events(h)).filter((e) => e.type === 'questionnaire.rate_limited');
    expect(trips.map((e) => e.detail)).toEqual([{ limit: 'email', email: 'jane@x.org', ip: IP }]);
  });

  it('log nothing for an unknown token or the page-load link check', async () => {
    const token = await ready(h);
    await post(h, 'link', { token }).expect(200, { active: true });
    await post(h, 'lookup', { token: 'never-issued', email: 'jane@x.org' }).expect(404);
    await post(h, 'lookup', { token: 'never-issued', email: 'jane@x.org', website: 'spam' }).expect(404);
    await post(h, 'lookup', { token: 42, email: 'jane@x.org' }).expect(404);
    expect(await events(h)).toEqual([]);
  });

  it('file the event with a blank email when the owner is not in the directory', async () => {
    const b = await buildTestApp({}, { limits: { perIp: 1000, perEmail: 1000 } });
    const token = await ready(b);
    await post(b, 'lookup', { token, email: 'jane@x.org' }).expect(200);
    expect((await events(b)).map((e) => [e.userId, e.userEmail])).toEqual([['alice', '']]);
  });

  it('never let a log failure change the response', async () => {
    const real = createEventLog(h.pool);
    const failing: EventLog = {
      ...real,
      recordEvent: async () => {
        throw new Error('log down');
      },
    };
    const b = await buildTestApp(
      { eventLog: failing, userDirectory: createInMemoryUserDirectory(USERS) },
      { limits: { perIp: 1000, perEmail: 1000 } },
    );
    const token = await ready(b);
    await post(b, 'lookup', { token, email: 'jane@x.org' }).expect(200);
    await post(b, 'lookup', { token, email: 'guess@x.org' }).expect(404, { error: 'not_found' });
    await post(b, 'submit', { token, email: 'jane@x.org', answers: ANSWERS }).expect(200);
  });
});

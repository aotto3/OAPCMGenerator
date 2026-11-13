/**
 * The questionnaire service (RFC #270, slice #273) at its own boundary: pg-mem
 * behind the real store, a recording fake mailer, a fixed clock that only the
 * test moves, and a counting token generator. HTTP concerns (sessions, status
 * codes, rate limits, honeypot) are covered by questionnaire.test.ts.
 */
import { newDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, type Pool } from '../src/db';
import {
  MAX_ROSTER_CONTESTS,
  MAX_ROSTER_FIELD_LENGTH,
  MAX_ROSTER_JUDGES,
} from '../src/judgeRoster';
import type { OutgoingMail } from '../src/mailer';
import { createQuestionnaireService, type QuestionnaireService } from '../src/questionnaire';
import { createQuestionnaireStore, MAX_ROSTER_BYTES } from '../src/questionnaireStore';

const T0 = '2026-09-01T12:00:00.000Z';

const ZONE1 = {
  id: 'z1',
  title: '2027 - 5A Zone 1 OAP',
  level: 'Zone',
  date: '2027-03-04',
  host: 'Friendswood HS',
  cmEmail: 'cm@example.org',
};
const ZONE2 = { ...ZONE1, id: 'z2', title: '2027 - 5A Zone 2 OAP', date: '2027-03-05', cmEmail: 'cm2@example.org' };
const DISTRICT = { ...ZONE1, id: 'd', title: '2027 - 5A District 20 OAP', level: 'District', date: '2027-03-25' };

const ROSTER = {
  contests: [ZONE1, ZONE2, DISTRICT],
  judges: [
    { email: 'Jane@X.org', name: 'Jane Judge', contestIds: ['z1', 'z2'] },
    { email: 'sam@x.org', name: 'Sam Lee', contestIds: ['d'] },
  ],
};

const ANSWERS = {
  cellPhone: '512-555-0100',
  mailingAddress: '1 Main St',
  dietary: 'vegetarian',
  bio: 'A bio',
  notes: 'Arriving late',
  contests: {
    z1: { hotelBefore: true, hotelAfter: true, requestingFlight: false, needsPower: true },
    z2: { hotelBefore: true, hotelAfter: false, requestingFlight: false, needsPower: false },
  },
};

interface Rig {
  service: QuestionnaireService;
  sent: OutgoingMail[];
  setNow(at: string): void;
  ownerEmails: Map<string, string>;
  failMail: boolean;
  failOwnerEmail: boolean;
}

async function rig(): Promise<Rig> {
  const pool = new (newDb().adapters.createPg().Pool)() as unknown as Pool;
  await migrate(pool);
  let now = new Date(T0);
  let n = 0;
  const r: Rig = {
    sent: [],
    setNow: (at) => {
      now = new Date(at);
    },
    ownerEmails: new Map([['alice', 'alice@owner.test']]),
    failMail: false,
    failOwnerEmail: false,
    service: undefined as unknown as QuestionnaireService,
  };
  r.service = createQuestionnaireService({
    store: createQuestionnaireStore(pool),
    mailer: {
      send: async (mail) => {
        if (r.failMail) throw new Error('down');
        r.sent.push(mail);
      },
    },
    ownerEmail: async (id) => {
      if (r.failOwnerEmail) throw new Error('directory down');
      return r.ownerEmails.get(id) ?? null;
    },
    now: () => now,
    newToken: () => `token-${++n}`,
  });
  return r;
}

let r: Rig;
beforeEach(async () => {
  r = await rig();
});

async function ready(roster: unknown = ROSTER): Promise<string> {
  const { token } = await r.service.linkFor('alice');
  expect(await r.service.publishRoster('alice', roster)).toEqual({ ok: true });
  return token;
}

describe('link tokens', () => {
  it('issues one standing token per account and keeps it', async () => {
    const first = await r.service.linkFor('alice');
    expect(first).toEqual({ token: 'token-1' });
    expect(await r.service.linkFor('alice')).toEqual(first);
    expect(await r.service.linkFor('bob')).toEqual({ token: 'token-2' });
  });

  it('reset replaces the token and the old one stops matching', async () => {
    const old = await ready();
    const fresh = await r.service.resetLink('alice');
    expect(fresh.token).not.toBe(old);
    expect(await r.service.linkFor('alice')).toEqual(fresh);
    expect(await r.service.lookup(old, 'jane@x.org')).toBeNull();
    expect(await r.service.lookup(fresh.token, 'jane@x.org')).not.toBeNull();
  });

  it('reports a link active until it is reset, and an unknown one as inactive', async () => {
    const old = await ready();
    expect(await r.service.linkActive(old)).toBe(true);
    const fresh = await r.service.resetLink('alice');
    expect(await r.service.linkActive(old)).toBe(false);
    expect(await r.service.linkActive(fresh.token)).toBe(true);
    expect(await r.service.linkActive('never-issued')).toBe(false);
  });

  it('the default generator makes long url-safe random tokens', async () => {
    const pool = new (newDb().adapters.createPg().Pool)() as unknown as Pool;
    await migrate(pool);
    const s = createQuestionnaireService({
      store: createQuestionnaireStore(pool),
      mailer: { send: async () => {} },
      ownerEmail: async () => null,
      now: () => new Date(T0),
    });
    const a = await s.linkFor('a');
    const b = await s.linkFor('b');
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(a.token).not.toBe(b.token);
  });
});

describe('publishRoster', () => {
  const contest = (i: number) => ({ ...ZONE1, id: `c${i}` });
  const judge = (i: number, patch = {}) => ({ email: `j${i}@x.org`, name: 'J', contestIds: ['c0'], ...patch });

  it('accepts a valid roster and normalizes judge emails', async () => {
    const token = await ready();
    const found = await r.service.lookup(token, 'jane@x.org');
    expect(found).toEqual({ judgeName: 'Jane Judge', contests: [ZONE1, ZONE2], lastSubmission: null, contactOnFile: { cellPhone: false, mailingAddress: false } });
  });

  it('refuses malformed rosters', async () => {
    const invalid = { error: 'invalid' };
    expect(await r.service.publishRoster('alice', undefined)).toEqual(invalid);
    expect(await r.service.publishRoster('alice', { contests: 'nope', judges: [] })).toEqual(invalid);
    expect(
      await r.service.publishRoster('alice', {
        ...ROSTER,
        judges: [{ email: 'a@x.org', name: 'A', contestIds: ['missing'] }],
      }),
    ).toEqual(invalid);
    expect(
      await r.service.publishRoster('alice', { contests: [ZONE1, ZONE1], judges: [] }),
    ).toEqual(invalid);
    expect(
      await r.service.publishRoster('alice', {
        contests: [ZONE1],
        judges: [judge(1, { contestIds: ['z1'] }), judge(1, { email: 'J1@x.org', contestIds: ['z1'] })],
      }),
    ).toEqual(invalid);
  });

  it(`allows ${MAX_ROSTER_CONTESTS} contests and refuses one more`, async () => {
    const contests = Array.from({ length: MAX_ROSTER_CONTESTS }, (_, i) => contest(i));
    expect(await r.service.publishRoster('alice', { contests, judges: [] })).toEqual({ ok: true });
    expect(
      await r.service.publishRoster('alice', { contests: [...contests, contest(MAX_ROSTER_CONTESTS)], judges: [] }),
    ).toEqual({ error: 'invalid' });
  });

  it(`allows ${MAX_ROSTER_JUDGES} judges and refuses one more`, async () => {
    const judges = Array.from({ length: MAX_ROSTER_JUDGES }, (_, i) => judge(i));
    expect(await r.service.publishRoster('alice', { contests: [contest(0)], judges })).toEqual({ ok: true });
    expect(
      await r.service.publishRoster('alice', { contests: [contest(0)], judges: [...judges, judge(MAX_ROSTER_JUDGES)] }),
    ).toEqual({ error: 'invalid' });
  });

  it(`allows fields of ${MAX_ROSTER_FIELD_LENGTH} characters and refuses longer`, async () => {
    const at = 'x'.repeat(MAX_ROSTER_FIELD_LENGTH);
    const over = at + 'x';
    expect(
      await r.service.publishRoster('alice', { contests: [{ ...contest(0), title: at }], judges: [judge(1, { name: at })] }),
    ).toEqual({ ok: true });
    expect(
      await r.service.publishRoster('alice', { contests: [{ ...contest(0), title: over }], judges: [] }),
    ).toEqual({ error: 'invalid' });
    expect(
      await r.service.publishRoster('alice', { contests: [contest(0)], judges: [judge(1, { name: over })] }),
    ).toEqual({ error: 'invalid' });
  });

  it(`refuses a valid roster whose encoding is over ${MAX_ROSTER_BYTES} bytes, keeping the previous one`, async () => {
    const token = await ready();
    const name = 'n'.repeat(MAX_ROSTER_FIELD_LENGTH);
    const count = Math.ceil(MAX_ROSTER_BYTES / MAX_ROSTER_FIELD_LENGTH) + 1;
    const big = { contests: [contest(0)], judges: Array.from({ length: count }, (_, i) => judge(i, { name })) };
    expect(count).toBeLessThanOrEqual(MAX_ROSTER_JUDGES);
    expect(await r.service.publishRoster('alice', big)).toEqual({ error: 'too_large' });
    expect(await r.service.lookup(token, 'jane@x.org')).not.toBeNull();
  });

  it('replaces the previous roster', async () => {
    const token = await ready();
    await r.service.publishRoster('alice', {
      contests: [DISTRICT],
      judges: [{ email: 'sam@x.org', name: 'Sam', contestIds: ['d'] }],
    });
    expect(await r.service.lookup(token, 'jane@x.org')).toBeNull();
    expect((await r.service.lookup(token, 'sam@x.org'))?.judgeName).toBe('Sam');
  });
});

describe('lookup', () => {
  it('matches the email regardless of case and spacing, returning only that judge\'s contests', async () => {
    const token = await ready();
    expect(await r.service.lookup(token, '  SAM@X.org ')).toEqual({
      judgeName: 'Sam Lee',
      contests: [DISTRICT],
      lastSubmission: null,
      contactOnFile: { cellPhone: false, mailingAddress: false },
    });
  });

  it('returns null alike for an unknown token, no roster, an unknown or blank email', async () => {
    const { token } = await r.service.linkFor('alice');
    expect(await r.service.lookup(token, 'jane@x.org')).toBeNull(); // no roster yet
    await r.service.publishRoster('alice', ROSTER);
    expect(await r.service.lookup('not-a-token', 'jane@x.org')).toBeNull();
    expect(await r.service.lookup(token, 'nobody@x.org')).toBeNull();
    expect(await r.service.lookup(token, '   ')).toBeNull();
  });

  it("never crosses accounts", async () => {
    const { token } = await r.service.linkFor('alice');
    await r.service.publishRoster('bob', ROSTER);
    expect(await r.service.lookup(token, 'jane@x.org')).toBeNull();
  });
});

describe('submit', () => {
  it('stores the answers, stamped by the injected clock, and returns them on lookup and to the owner', async () => {
    const token = await ready();
    r.setNow('2026-10-05T08:30:00.000Z');
    expect(await r.service.submit(token, 'JANE@x.org', ANSWERS)).toEqual({ submittedAt: '2026-10-05T08:30:00.000Z' });
    expect((await r.service.lookup(token, 'jane@x.org'))?.lastSubmission).toEqual({
      ...ANSWERS,
      cellPhone: '',
      mailingAddress: '',
    });
    expect(await r.service.submissionsFor('alice')).toEqual([
      { email: 'jane@x.org', submittedAt: '2026-10-05T08:30:00.000Z', answers: ANSWERS },
    ]);
    expect(await r.service.submissionsFor('bob')).toEqual([]);
  });

  it('a resubmit replaces the earlier answers and its timestamp', async () => {
    const token = await ready();
    await r.service.submit(token, 'jane@x.org', ANSWERS);
    r.setNow('2026-09-02T00:00:00.000Z');
    await r.service.submit(token, 'jane@x.org', { ...ANSWERS, dietary: 'vegan' });
    const list = await r.service.submissionsFor('alice');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ submittedAt: '2026-09-02T00:00:00.000Z', answers: { dietary: 'vegan' } });
  });

  it('never shows saved phone or address back, only that they are on file (#261)', async () => {
    const token = await ready();
    await r.service.submit(token, 'jane@x.org', { ...ANSWERS, mailingAddress: '' });
    const found = await r.service.lookup(token, 'jane@x.org');
    expect(found?.lastSubmission).toMatchObject({ cellPhone: '', mailingAddress: '', dietary: ANSWERS.dietary });
    expect(found?.contactOnFile).toEqual({ cellPhone: true, mailingAddress: false });
  });

  it('a blank phone or address on resubmit keeps the saved one; a typed one replaces it', async () => {
    const token = await ready();
    await r.service.submit(token, 'jane@x.org', ANSWERS);
    r.sent.length = 0;
    await r.service.submit(token, 'jane@x.org', { ...ANSWERS, cellPhone: '  ', mailingAddress: '2 Elm St' });
    const [stored] = await r.service.submissionsFor('alice');
    expect(stored.answers).toMatchObject({ cellPhone: ANSWERS.cellPhone, mailingAddress: '2 Elm St' });
    // The CM notice carries the kept phone, not the blank.
    expect(r.sent[0].text).toContain(ANSWERS.cellPhone);
  });

  it('a first submit with blank contact stores blanks', async () => {
    const token = await ready();
    await r.service.submit(token, 'jane@x.org', { ...ANSWERS, cellPhone: '', mailingAddress: '' });
    const [stored] = await r.service.submissionsFor('alice');
    expect(stored.answers).toMatchObject({ cellPhone: '', mailingAddress: '' });
  });

  it('lists submissions oldest first', async () => {
    const token = await ready();
    r.setNow('2026-09-03T00:00:00.000Z');
    await r.service.submit(token, 'sam@x.org', { ...ANSWERS, contests: {} });
    r.setNow('2026-09-02T00:00:00.000Z');
    await r.service.submit(token, 'jane@x.org', ANSWERS);
    expect((await r.service.submissionsFor('alice')).map((s) => s.email)).toEqual(['jane@x.org', 'sam@x.org']);
  });

  it('answers not_found for an unknown token or email, before checking the answers', async () => {
    const token = await ready();
    expect(await r.service.submit(token, 'nobody@x.org', ANSWERS)).toEqual({ error: 'not_found' });
    expect(await r.service.submit('nope', 'jane@x.org', 'junk')).toEqual({ error: 'not_found' });
  });

  it("refuses malformed answers or answers for a contest the judge isn't on, storing nothing", async () => {
    const token = await ready();
    const bad = [
      undefined,
      { ...ANSWERS, contests: { d: { hotelBefore: false, hotelAfter: false, requestingFlight: false } } },
      { ...ANSWERS, needsPower: 'yes' },
      { ...ANSWERS, bio: 'x'.repeat(5000) },
    ];
    for (const answers of bad) {
      expect(await r.service.submit(token, 'jane@x.org', answers)).toEqual({ error: 'invalid_answers' });
    }
    expect(await r.service.submissionsFor('alice')).toEqual([]);
    expect(r.sent).toEqual([]);
  });

  it('spreads a legacy top-level power answer and drops unknown fields', async () => {
    const token = await ready();
    await r.service.submit(token, 'jane@x.org', {
      ...ANSWERS,
      needsPower: true,
      name: 'Hacker',
      contests: {
        z1: { hotelBefore: false, hotelAfter: false, requestingFlight: false },
        z2: { hotelBefore: false, hotelAfter: false, requestingFlight: false, needsPower: false },
      },
    });
    const last = (await r.service.lookup(token, 'jane@x.org'))?.lastSubmission;
    expect(last?.contests.z1.needsPower).toBe(true);
    expect(last?.contests.z2.needsPower).toBe(false);
    expect(last).not.toHaveProperty('needsPower');
    expect(last).not.toHaveProperty('name');
  });
});

describe('CM notification', () => {
  it('emails each distinct CM their contests, replying to the judge', async () => {
    const token = await ready();
    await r.service.submit(token, 'jane@x.org', ANSWERS);
    expect(r.sent.map((m) => m.to)).toEqual(['cm@example.org', 'cm2@example.org']);
    expect(r.sent[0]).toMatchObject({ replyTo: 'jane@x.org', subject: 'Judge questionnaire: Jane Judge' });
    expect(r.sent[0].text).toContain('2027 - 5A Zone 1 OAP');
    expect(r.sent[0].text).not.toContain('2027 - 5A Zone 2 OAP');
    expect(r.sent[0].text).toContain('submitted the adjudicator questionnaire');
  });

  it('marks a resubmission as an update', async () => {
    const token = await ready({ ...ROSTER, contests: [ZONE1, { ...ZONE2, cmEmail: ZONE1.cmEmail }, DISTRICT] });
    await r.service.submit(token, 'jane@x.org', ANSWERS);
    await r.service.submit(token, 'jane@x.org', ANSWERS);
    expect(r.sent.map((m) => m.subject)).toEqual([
      'Judge questionnaire: Jane Judge',
      'Judge questionnaire (updated): Jane Judge',
    ]);
    expect(r.sent[1].text).toContain('updated their adjudicator questionnaire');
  });

  it("falls back to the account's sign-in email when no answered contest has a CM email", async () => {
    const token = await ready({ ...ROSTER, contests: ROSTER.contests.map((c) => ({ ...c, cmEmail: '' })) });
    await r.service.submit(token, 'jane@x.org', ANSWERS);
    expect(r.sent.map((m) => m.to)).toEqual(['alice@owner.test']);
  });

  it('sends nothing when there is no CM email and no owner email, or the directory fails', async () => {
    const noCm = { ...ROSTER, contests: ROSTER.contests.map((c) => ({ ...c, cmEmail: '' })) };
    const token = await ready(noCm);
    r.ownerEmails.clear();
    expect(await r.service.submit(token, 'jane@x.org', ANSWERS)).toHaveProperty('submittedAt');
    r.failOwnerEmail = true;
    expect(await r.service.submit(token, 'jane@x.org', ANSWERS)).toHaveProperty('submittedAt');
    expect(r.sent).toEqual([]);
  });

  it('still stores the submission when sending fails', async () => {
    const token = await ready();
    r.failMail = true;
    expect(await r.service.submit(token, 'jane@x.org', ANSWERS)).toEqual({ submittedAt: T0 });
    expect(await r.service.submissionsFor('alice')).toHaveLength(1);
  });
});

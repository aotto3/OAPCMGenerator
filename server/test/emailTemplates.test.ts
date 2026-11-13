/**
 * Custom email templates (PRD #320, slice #321): list and create over HTTP on
 * the production app factory. Covers sign-in, owner scoping, the shared rules
 * (limits, unique names, the per-account cap), and the name-only activity
 * events, including that a logging failure never fails a save.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createEventLog, type EventLog } from '../src/eventLog';
import { TEMPLATE_LIMITS, templateProblem } from '../src/emailTemplateRules';
import { buildTestApp, type TestApp } from './harness';

const T = { name: 'Hotel info', subject: '{{contestName}} hotels', body: 'Dear judges,\n\nYour hotel is near {{venueName}}.' };

let h: TestApp;
beforeEach(async () => {
  h = await buildTestApp();
});

const create = (user: string, body: unknown) => h.as(user).post('/api/templates').send(body as object);

describe('sign-in', () => {
  it('listing and creating need a session', async () => {
    await request(h.app).get('/api/templates').expect(401);
    await request(h.app).post('/api/templates').send(T).expect(401);
  });
});

describe('create and list', () => {
  it('a new account has no templates', async () => {
    const { body } = await h.as('alice').get('/api/templates').expect(200);
    expect(body).toEqual({ templates: [] });
  });

  it('creates a template and lists it back, name trimmed, subject and body as typed', async () => {
    const { body } = await create('alice', { ...T, name: '  Hotel info  ', subject: ' Hi ' }).expect(201);
    expect(body.template).toMatchObject({ name: 'Hotel info', subject: ' Hi ', body: T.body });
    expect(body.template.createdAt).toBe(h.clock.now.toISOString());
    expect(body.template.updatedAt).toBe(h.clock.now.toISOString());
    const list = await h.as('alice').get('/api/templates').expect(200);
    expect(list.body.templates).toEqual([body.template]);
  });

  it('lists oldest first', async () => {
    await create('alice', { ...T, name: 'First' }).expect(201);
    h.clock.advance(1000);
    await create('alice', { ...T, name: 'Second' }).expect(201);
    const { body } = await h.as('alice').get('/api/templates').expect(200);
    expect(body.templates.map((t: { name: string }) => t.name)).toEqual(['First', 'Second']);
  });

  it('one account never sees another account’s templates', async () => {
    await create('alice', T).expect(201);
    const { body } = await h.as('bob').get('/api/templates').expect(200);
    expect(body.templates).toEqual([]);
  });

  it('two accounts may use the same name', async () => {
    await create('alice', T).expect(201);
    await create('bob', T).expect(201);
  });
});

describe('rules', () => {
  it('refuses a malformed body', async () => {
    for (const bad of [{}, { name: 'x', subject: 'y' }, { name: 1, subject: '', body: '' }]) {
      const { body } = await create('alice', bad).expect(400);
      expect(body).toEqual({ error: 'invalid_body' });
    }
  });

  it('refuses a blank name', async () => {
    const { body } = await create('alice', { ...T, name: '   ' }).expect(400);
    expect(body).toEqual({ error: 'name_required' });
  });

  it('enforces each length limit at its boundary', async () => {
    await create('alice', { ...T, name: 'n'.repeat(TEMPLATE_LIMITS.name) }).expect(201);
    await create('alice', { ...T, name: 'S', subject: 's'.repeat(TEMPLATE_LIMITS.subject) }).expect(201);
    await create('alice', { ...T, name: 'B', body: 'b'.repeat(TEMPLATE_LIMITS.body) }).expect(201);
    expect((await create('alice', { ...T, name: 'x'.repeat(TEMPLATE_LIMITS.name + 1) }).expect(400)).body.error).toBe(
      'name_too_long',
    );
    expect(
      (await create('alice', { ...T, name: 'S2', subject: 's'.repeat(TEMPLATE_LIMITS.subject + 1) }).expect(400)).body
        .error,
    ).toBe('subject_too_long');
    expect(
      (await create('alice', { ...T, name: 'B2', body: 'b'.repeat(TEMPLATE_LIMITS.body + 1) }).expect(400)).body.error,
    ).toBe('body_too_long');
  });

  it('refuses a name already used in the account, ignoring case and spaces', async () => {
    await create('alice', T).expect(201);
    const { body } = await create('alice', { ...T, name: ' HOTEL INFO ' }).expect(400);
    expect(body).toEqual({ error: 'duplicate_name' });
  });

  it('caps an account at the template limit', async () => {
    for (let i = 0; i < TEMPLATE_LIMITS.perAccount; i++) {
      await create('alice', { ...T, name: `T${i}` }).expect(201);
    }
    const { body } = await create('alice', { ...T, name: 'One too many' }).expect(400);
    expect(body).toEqual({ error: 'too_many' });
    // Another account is unaffected.
    await create('bob', T).expect(201);
  });

  it('a refused create stores nothing', async () => {
    await create('alice', { ...T, name: '' }).expect(400);
    const { body } = await h.as('alice').get('/api/templates').expect(200);
    expect(body.templates).toEqual([]);
  });
});

describe('the rules module', () => {
  it('reports the first problem in a fixed order', () => {
    const long = { name: '', subject: 's'.repeat(TEMPLATE_LIMITS.subject + 1), body: '' };
    expect(templateProblem(long, [], 0)).toBe('name_required');
    expect(templateProblem({ ...T, name: 'a' }, ['A'], TEMPLATE_LIMITS.perAccount)).toBe('duplicate_name');
    expect(templateProblem(T, [], TEMPLATE_LIMITS.perAccount - 1)).toBeNull();
  });
});

describe('activity', () => {
  it('records template.created with the name only', async () => {
    await create('alice', T).expect(201);
    const rows = await h.deps.eventLog.queryEvents({ type: 'template.created' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 'alice', userEmail: 'alice@example.test', detail: { templateName: 'Hotel info' } });
    expect(JSON.stringify(rows[0])).not.toContain('hotel is near');
  });

  it('a refused create records nothing', async () => {
    await create('alice', { ...T, name: '' }).expect(400);
    expect(await h.deps.eventLog.queryEvents({ type: 'template.created' })).toEqual([]);
  });

  it('a logging failure never fails the save', async () => {
    const real = createEventLog(h.pool);
    const failing: EventLog = {
      ...real,
      recordEvent: async () => {
        throw new Error('log is down');
      },
    };
    const a = await buildTestApp({ eventLog: failing });
    await a.as('alice').post('/api/templates').send(T).expect(201);
    const { body } = await a.as('alice').get('/api/templates').expect(200);
    expect(body.templates).toHaveLength(1);
  });
});

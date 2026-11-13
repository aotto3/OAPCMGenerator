/**
 * Custom email templates (PRD #320, slices #321 and #322): list, create, edit
 * and delete over HTTP on the production app factory. Covers sign-in, owner scoping, the shared rules
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

describe('edit', () => {
  const put = (user: string, id: string, body: unknown) => h.as(user).put(`/api/templates/${id}`).send(body as object);

  it('needs a session', async () => {
    await request(h.app).put('/api/templates/x').send(T).expect(401);
    await request(h.app).delete('/api/templates/x').expect(401);
  });

  it('replaces name, subject and body, keeping id and createdAt', async () => {
    const { body: made } = await create('alice', T).expect(201);
    h.clock.advance(60_000);
    const edit = { name: ' Hotel details ', subject: 'New subject', body: 'New body' };
    const { body } = await put('alice', made.template.id, edit).expect(200);
    expect(body.template).toEqual({
      id: made.template.id,
      name: 'Hotel details',
      subject: 'New subject',
      body: 'New body',
      createdAt: made.template.createdAt,
      updatedAt: h.clock.now.toISOString(),
      shared: false,
      sharedAt: null,
    });
    const list = await h.as('alice').get('/api/templates').expect(200);
    expect(list.body.templates).toEqual([body.template]);
  });

  it('the last save wins', async () => {
    const { body: made } = await create('alice', T).expect(201);
    await put('alice', made.template.id, { ...T, body: 'from the laptop' }).expect(200);
    await put('alice', made.template.id, { ...T, body: 'from the phone' }).expect(200);
    const { body } = await h.as('alice').get('/api/templates').expect(200);
    expect(body.templates[0].body).toBe('from the phone');
  });

  it('keeping its own name, or changing only its case, is allowed', async () => {
    const { body: made } = await create('alice', T).expect(201);
    await put('alice', made.template.id, T).expect(200);
    await put('alice', made.template.id, { ...T, name: 'HOTEL INFO' }).expect(200);
  });

  it('renaming to another template’s name is refused and changes nothing', async () => {
    const { body: a } = await create('alice', T).expect(201);
    h.clock.advance(1000);
    await create('alice', { ...T, name: 'Thanks' }).expect(201);
    const { body } = await put('alice', a.template.id, { ...T, name: ' thanks ' }).expect(400);
    expect(body).toEqual({ error: 'duplicate_name' });
    const list = await h.as('alice').get('/api/templates').expect(200);
    expect(list.body.templates.map((t: { name: string }) => t.name)).toEqual(['Hotel info', 'Thanks']);
  });

  it('the same limits apply, and a full account can still edit', async () => {
    let first = '';
    for (let i = 0; i < TEMPLATE_LIMITS.perAccount; i++) {
      const { body } = await create('alice', { ...T, name: `T${i}` }).expect(201);
      if (i === 0) first = body.template.id;
    }
    await put('alice', first, { ...T, name: 'Renamed' }).expect(200);
    expect((await put('alice', first, { ...T, body: 'b'.repeat(TEMPLATE_LIMITS.body + 1) }).expect(400)).body).toEqual({
      error: 'body_too_long',
    });
    expect((await put('alice', first, { name: 'x' }).expect(400)).body).toEqual({ error: 'invalid_body' });
  });

  it('another account’s template, or an unknown id, is not found', async () => {
    const { body: made } = await create('alice', T).expect(201);
    await put('bob', made.template.id, { ...T, body: 'hijacked' }).expect(404);
    await put('alice', 'no-such-id', T).expect(404);
    const { body } = await h.as('alice').get('/api/templates').expect(200);
    expect(body.templates[0].body).toBe(T.body);
  });
});

describe('delete', () => {
  it('deletes the template', async () => {
    const { body: made } = await create('alice', T).expect(201);
    await h.as('alice').delete(`/api/templates/${made.template.id}`).expect(204);
    const { body } = await h.as('alice').get('/api/templates').expect(200);
    expect(body.templates).toEqual([]);
  });

  it('frees its name and its place under the cap', async () => {
    const { body: made } = await create('alice', T).expect(201);
    await h.as('alice').delete(`/api/templates/${made.template.id}`).expect(204);
    await create('alice', T).expect(201);
  });

  it('another account’s template, or an unknown id, is not found and kept', async () => {
    const { body: made } = await create('alice', T).expect(201);
    await h.as('bob').delete(`/api/templates/${made.template.id}`).expect(404);
    await h.as('alice').delete('/api/templates/no-such-id').expect(404);
    const { body } = await h.as('alice').get('/api/templates').expect(200);
    expect(body.templates).toHaveLength(1);
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

  it('records template.updated and template.deleted with the name only', async () => {
    const { body: made } = await create('alice', T).expect(201);
    await h.as('alice').put(`/api/templates/${made.template.id}`).send({ ...T, name: 'Renamed' }).expect(200);
    await h.as('alice').delete(`/api/templates/${made.template.id}`).expect(204);
    const [updated] = await h.deps.eventLog.queryEvents({ type: 'template.updated' });
    const [deleted] = await h.deps.eventLog.queryEvents({ type: 'template.deleted' });
    expect(updated).toMatchObject({ userId: 'alice', detail: { templateName: 'Renamed' } });
    expect(deleted).toMatchObject({ userId: 'alice', detail: { templateName: 'Renamed' } });
    expect(JSON.stringify([updated, deleted])).not.toContain('hotel is near');
  });

  it('a refused edit or delete records nothing', async () => {
    await h.as('alice').put('/api/templates/nope').send(T).expect(404);
    await h.as('alice').delete('/api/templates/nope').expect(404);
    expect(await h.deps.eventLog.queryEvents({ type: 'template.updated' })).toEqual([]);
    expect(await h.deps.eventLog.queryEvents({ type: 'template.deleted' })).toEqual([]);
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

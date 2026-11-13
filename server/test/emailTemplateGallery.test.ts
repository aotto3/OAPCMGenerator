/**
 * Sharing and the template gallery (PRD #320, slice #325) over HTTP on the
 * production app factory. The gallery is the server's first cross-account
 * read, so most of these check what it must NOT do: show a private template,
 * show an owner id or email, let one account share or unshare another's
 * template, or copy a template that is not shared.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { TEMPLATE_LIMITS } from '../src/emailTemplateRules';
import { buildTestApp, type TestApp } from './harness';

const T = { name: 'Hotel info', subject: '{{contestName}} hotels', body: 'Your hotel is near {{venueName}}.' };

let h: TestApp;
beforeEach(async () => {
  h = await buildTestApp();
});

async function make(user: string, over: Partial<typeof T> = {}): Promise<string> {
  const { body } = await h.as(user).post('/api/templates').send({ ...T, ...over }).expect(201);
  return body.template.id as string;
}
const share = (user: string, id: string, authorName: unknown = 'Dana Whitfield') =>
  h.as(user).post(`/api/templates/${id}/share`).send({ authorName });
const gallery = async (user: string) => (await h.as(user).get('/api/templates/gallery').expect(200)).body.templates;

describe('sign-in', () => {
  it('every sharing and gallery route needs a session', async () => {
    await request(h.app).get('/api/templates/gallery').expect(401);
    await request(h.app).post('/api/templates/x/share').send({ authorName: 'A' }).expect(401);
    await request(h.app).delete('/api/templates/x/share').expect(401);
    await request(h.app).post('/api/templates/gallery/x/add').send({}).expect(401);
  });
});

describe('sharing', () => {
  it('templates start private and stay out of the gallery', async () => {
    await make('alice');
    const { body } = await h.as('alice').get('/api/templates').expect(200);
    expect(body.templates[0]).toMatchObject({ shared: false, sharedAt: null });
    expect(await gallery('bob')).toEqual([]);
  });

  it('a shared template appears in every CM’s gallery with only the card fields', async () => {
    const id = await make('alice');
    const { body } = await share('alice', id, '  Dana Whitfield ').expect(200);
    expect(body.template).toMatchObject({ id, shared: true, sharedAt: h.clock.now.toISOString() });
    const cards = await gallery('bob');
    expect(cards).toEqual([
      {
        id,
        name: 'Hotel info',
        subject: T.subject,
        body: T.body,
        authorName: 'Dana Whitfield',
        sharedAt: h.clock.now.toISOString(),
        mine: false,
      },
    ]);
    const raw = JSON.stringify(cards);
    expect(raw).not.toContain('alice');
    expect(raw).not.toContain('example.test');
  });

  it('marks the viewer’s own shared templates as mine', async () => {
    const id = await make('alice');
    await share('alice', id).expect(200);
    expect((await gallery('alice'))[0]).toMatchObject({ id, mine: true });
    expect((await gallery('bob'))[0]).toMatchObject({ id, mine: false });
  });

  it('a blank, missing or too-long author name is refused', async () => {
    const id = await make('alice');
    for (const bad of ['', '   ', undefined, 7, 'x'.repeat(TEMPLATE_LIMITS.authorName + 1)]) {
      const res = await h.as('alice').post(`/api/templates/${id}/share`).send({ authorName: bad }).expect(400);
      expect(res.body).toEqual({ error: 'author_name_required' });
    }
    expect(await gallery('bob')).toEqual([]);
  });

  it('only the owner can share or unshare', async () => {
    const id = await make('alice');
    await share('bob', id).expect(404);
    expect(await gallery('bob')).toEqual([]);
    await share('alice', id).expect(200);
    await h.as('bob').delete(`/api/templates/${id}/share`).expect(404);
    expect(await gallery('bob')).toHaveLength(1);
  });

  it('unsharing removes it from the gallery and keeps the template', async () => {
    const id = await make('alice');
    await share('alice', id).expect(200);
    const { body } = await h.as('alice').delete(`/api/templates/${id}/share`).expect(200);
    expect(body.template).toMatchObject({ shared: false, sharedAt: null });
    expect(await gallery('bob')).toEqual([]);
    expect((await h.as('alice').get('/api/templates').expect(200)).body.templates).toHaveLength(1);
  });

  it('re-sharing refreshes the author name and keeps the original share date', async () => {
    const id = await make('alice');
    await share('alice', id, 'Dana').expect(200);
    const first = h.clock.now.toISOString();
    h.clock.advance(60_000);
    await share('alice', id, 'Dana Whitfield').expect(200);
    expect((await gallery('bob'))[0]).toMatchObject({ authorName: 'Dana Whitfield', sharedAt: first });
  });

  it('saving a shared template updates the gallery card and, when given, the author name', async () => {
    const id = await make('alice');
    await share('alice', id, 'Dana').expect(200);
    await h.as('alice').put(`/api/templates/${id}`).send({ ...T, body: 'Updated' }).expect(200);
    expect((await gallery('bob'))[0]).toMatchObject({ body: 'Updated', authorName: 'Dana' });
    await h
      .as('alice')
      .put(`/api/templates/${id}`)
      .send({ ...T, body: 'Again', authorName: 'Dana W.' })
      .expect(200);
    expect((await gallery('bob'))[0]).toMatchObject({ body: 'Again', authorName: 'Dana W.' });
    const { body } = await h.as('alice').get('/api/templates').expect(200);
    expect(body.templates[0]).toMatchObject({ shared: true });
  });

  it('an author name sent with a save does not share a private template', async () => {
    const id = await make('alice');
    await h.as('alice').put(`/api/templates/${id}`).send({ ...T, authorName: 'Dana' }).expect(200);
    expect(await gallery('bob')).toEqual([]);
  });

  it('deleting a shared template removes it from the gallery', async () => {
    const id = await make('alice');
    await share('alice', id).expect(200);
    await h.as('alice').delete(`/api/templates/${id}`).expect(204);
    expect(await gallery('bob')).toEqual([]);
  });

  it('lists the newest share first', async () => {
    const a = await make('alice', { name: 'Older' });
    const b = await make('carol', { name: 'Newer' });
    await share('alice', a).expect(200);
    h.clock.advance(1000);
    await share('carol', b).expect(200);
    expect((await gallery('bob')).map((t: { name: string }) => t.name)).toEqual(['Newer', 'Older']);
  });
});

describe('add from gallery', () => {
  const add = (user: string, id: string, body: object = {}) =>
    h.as(user).post(`/api/templates/gallery/${id}/add`).send(body);

  it('copies a shared template into the adder’s account as a private template', async () => {
    const id = await make('alice');
    await share('alice', id).expect(200);
    h.clock.advance(1000);
    const { body } = await add('bob', id).expect(201);
    expect(body.template).toMatchObject({
      name: T.name,
      subject: T.subject,
      body: T.body,
      shared: false,
      sharedAt: null,
      createdAt: h.clock.now.toISOString(),
    });
    expect(body.template.id).not.toBe(id);
    const mine = (await h.as('bob').get('/api/templates').expect(200)).body.templates;
    expect(mine).toEqual([body.template]);
  });

  it('the copy is independent: later edits, unsharing or deletion of the original do not touch it', async () => {
    const id = await make('alice');
    await share('alice', id).expect(200);
    const { body } = await add('bob', id).expect(201);
    await h.as('alice').put(`/api/templates/${id}`).send({ ...T, body: 'Changed' }).expect(200);
    await h.as('alice').delete(`/api/templates/${id}/share`).expect(200);
    await h.as('alice').delete(`/api/templates/${id}`).expect(204);
    const mine = (await h.as('bob').get('/api/templates').expect(200)).body.templates;
    expect(mine).toEqual([body.template]);
  });

  it('the adder can edit and delete their copy, and the original is untouched', async () => {
    const id = await make('alice');
    await share('alice', id).expect(200);
    const { body } = await add('bob', id).expect(201);
    await h.as('bob').put(`/api/templates/${body.template.id}`).send({ ...T, body: 'Bob’s' }).expect(200);
    await h.as('bob').delete(`/api/templates/${body.template.id}`).expect(204);
    expect((await gallery('carol'))[0]).toMatchObject({ id, body: T.body });
  });

  it('a private, unshared or missing template cannot be copied', async () => {
    const id = await make('alice');
    await add('bob', id).expect(404);
    await share('alice', id).expect(200);
    await h.as('alice').delete(`/api/templates/${id}/share`).expect(200);
    await add('bob', id).expect(404);
    await add('bob', 'no-such-id').expect(404);
    expect((await h.as('bob').get('/api/templates').expect(200)).body.templates).toEqual([]);
  });

  it('a name clash is refused; a new name gets it in', async () => {
    const id = await make('alice');
    await share('alice', id).expect(200);
    await make('bob');
    expect((await add('bob', id).expect(400)).body).toEqual({ error: 'duplicate_name' });
    const { body } = await add('bob', id, { name: 'Hotel info (Dana)' }).expect(201);
    expect(body.template.name).toBe('Hotel info (Dana)');
    expect((await add('bob', id, { name: 7 }).expect(400)).body).toEqual({ error: 'invalid_body' });
  });

  it('the per-account cap applies', async () => {
    const id = await make('alice');
    await share('alice', id).expect(200);
    for (let i = 0; i < TEMPLATE_LIMITS.perAccount; i++) await make('bob', { name: `T${i}` });
    expect((await add('bob', id).expect(400)).body).toEqual({ error: 'too_many' });
  });
});

describe('activity', () => {
  it('records shared, unshared and added-from-gallery by name only', async () => {
    const id = await make('alice');
    await share('alice', id).expect(200);
    await h.as('bob').post(`/api/templates/gallery/${id}/add`).send({ name: 'Copied' }).expect(201);
    await h.as('alice').delete(`/api/templates/${id}/share`).expect(200);
    const of = async (type: string) => (await h.deps.eventLog.queryEvents({ type })).map((e) => [e.userId, e.detail]);
    expect(await of('template.shared')).toEqual([['alice', { templateName: 'Hotel info' }]]);
    expect(await of('template.unshared')).toEqual([['alice', { templateName: 'Hotel info' }]]);
    expect(await of('template.added_from_gallery')).toEqual([['bob', { templateName: 'Copied' }]]);
    const all = JSON.stringify(await h.deps.eventLog.queryEvents({ limit: 100 }));
    expect(all).not.toContain('hotel is near');
  });

  it('a refused share records nothing', async () => {
    const id = await make('alice');
    await share('alice', id, '').expect(400);
    await share('bob', id).expect(404);
    expect(await h.deps.eventLog.queryEvents({ type: 'template.shared' })).toEqual([]);
  });
});

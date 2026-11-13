/**
 * Gallery moderation (PRD #320, slice #326): the admin lists every shared email
 * template and can take one out of the gallery. Non-admins get the admin API's
 * flat 404 (never 401/403). Removal only unshares: the author keeps the
 * template, and it can be shared again. Audited by template name only.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryUserDirectory } from '../src/userDirectory';
import { buildTestApp, TEST_START, type TestApp } from './harness';

const T = { name: 'Hotel info', subject: 'Hotels', body: 'Your hotel is near {{venueName}}.' };

let h: TestApp;
beforeEach(async () => {
  // The fake session's email is `${id}@example.test`, so the admin signs in as 'admin'.
  h = await buildTestApp({
    adminEmails: new Set(['admin@example.test']),
    userDirectory: createInMemoryUserDirectory([
      { id: 'alice', email: 'alice@cm.test', createdAt: TEST_START },
    ]),
  });
});

async function sharedByAlice(name = T.name): Promise<string> {
  const { body } = await h.as('alice').post('/api/templates').send({ ...T, name }).expect(201);
  await h.as('alice').post(`/api/templates/${body.template.id}/share`).send({ authorName: 'Dana' }).expect(200);
  return body.template.id as string;
}

describe('the gate', () => {
  it('non-admins and signed-out callers get 404', async () => {
    const id = await sharedByAlice();
    await request(h.app).get('/api/admin/shared-templates').expect(404);
    await h.as('alice').get('/api/admin/shared-templates').expect(404);
    await h.as('alice').delete(`/api/admin/shared-templates/${id}`).expect(404);
    await request(h.app).delete(`/api/admin/shared-templates/${id}`).expect(404);
    expect((await h.as('bob').get('/api/templates/gallery').expect(200)).body.templates).toHaveLength(1);
  });
});

describe('listing', () => {
  it('lists every shared template with its author and owner, and no private ones', async () => {
    const id = await sharedByAlice();
    await h.as('alice').post('/api/templates').send({ ...T, name: 'Private' }).expect(201);
    const { body } = await h.as('admin').get('/api/admin/shared-templates').expect(200);
    expect(body.templates).toEqual([
      {
        id,
        name: T.name,
        subject: T.subject,
        body: T.body,
        authorName: 'Dana',
        sharedAt: TEST_START,
        ownerId: 'alice',
        ownerEmail: 'alice@cm.test',
      },
    ]);
  });

  it('an owner missing from the directory shows a null email', async () => {
    const { body: made } = await h.as('carol').post('/api/templates').send(T).expect(201);
    await h.as('carol').post(`/api/templates/${made.template.id}/share`).send({ authorName: 'C' }).expect(200);
    const { body } = await h.as('admin').get('/api/admin/shared-templates').expect(200);
    expect(body.templates[0]).toMatchObject({ ownerId: 'carol', ownerEmail: null });
  });
});

describe('removing from the gallery', () => {
  it('unshares it and leaves the author’s template intact', async () => {
    const id = await sharedByAlice();
    await h.as('admin').delete(`/api/admin/shared-templates/${id}`).expect(204);
    expect((await h.as('bob').get('/api/templates/gallery').expect(200)).body.templates).toEqual([]);
    const mine = (await h.as('alice').get('/api/templates').expect(200)).body.templates;
    expect(mine).toEqual([expect.objectContaining({ id, name: T.name, body: T.body, shared: false, sharedAt: null })]);
    expect((await h.as('admin').get('/api/admin/shared-templates').expect(200)).body.templates).toEqual([]);
  });

  it('copies already added stay with whoever added them', async () => {
    const id = await sharedByAlice();
    await h.as('bob').post(`/api/templates/gallery/${id}/add`).send({}).expect(201);
    await h.as('admin').delete(`/api/admin/shared-templates/${id}`).expect(204);
    expect((await h.as('bob').get('/api/templates').expect(200)).body.templates).toHaveLength(1);
  });

  it('a private, already-removed or unknown template is 404', async () => {
    const { body: made } = await h.as('alice').post('/api/templates').send({ ...T, name: 'Private' }).expect(201);
    await h.as('admin').delete(`/api/admin/shared-templates/${made.template.id}`).expect(404);
    const id = await sharedByAlice();
    await h.as('admin').delete(`/api/admin/shared-templates/${id}`).expect(204);
    await h.as('admin').delete(`/api/admin/shared-templates/${id}`).expect(404);
    await h.as('admin').delete('/api/admin/shared-templates/no-such-id').expect(404);
  });

  it('the author can share it again afterward', async () => {
    const id = await sharedByAlice();
    await h.as('admin').delete(`/api/admin/shared-templates/${id}`).expect(204);
    await h.as('alice').post(`/api/templates/${id}/share`).send({ authorName: 'Dana' }).expect(200);
    expect((await h.as('bob').get('/api/templates/gallery').expect(200)).body.templates).toHaveLength(1);
  });

  it('is audited under the admin by template name and owner id, never the text', async () => {
    const id = await sharedByAlice();
    await h.as('admin').delete(`/api/admin/shared-templates/${id}`).expect(204);
    const rows = await h.deps.eventLog.queryEvents({ type: 'admin.template_removed_from_gallery' });
    expect(rows.map((e) => [e.userId, e.detail])).toEqual([
      ['admin', { templateName: T.name, targetUserId: 'alice' }],
    ]);
    expect(JSON.stringify(rows)).not.toContain('hotel is near');
  });
});

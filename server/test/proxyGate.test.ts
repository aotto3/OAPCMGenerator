/**
 * The proxy-secret gate and the admin request-IP probe (#261).
 *
 * With `proxySecret` set, every /api/* request must carry the secret the
 * frontend proxy stamps, or it gets the same flat 404 as a missing route; the
 * health check stays open. Unset, the gate is off (dev, tests, mid-rollout).
 * The probe reports what the API sees of the forwarded chain, to admins only.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { PROXY_SECRET_HEADER } from '../src/app';
import { buildTestApp, USER_HEADER } from './harness';

const SECRET = 's3cret-value-for-tests';

describe('proxy secret gate', () => {
  it('404s /api requests without the right secret and lets matching ones through', async () => {
    const h = await buildTestApp({ proxySecret: SECRET });
    const notFound = { error: 'Not found' };
    await request(h.app).get('/api/contests').set(USER_HEADER, 'alice').expect(404, notFound);
    await request(h.app)
      .get('/api/contests')
      .set(USER_HEADER, 'alice')
      .set(PROXY_SECRET_HEADER, 'wrong')
      .expect(404, notFound);
    await request(h.app)
      .get('/api/contests')
      .set(USER_HEADER, 'alice')
      .set(PROXY_SECRET_HEADER, `${SECRET}x`)
      .expect(404, notFound);
    await request(h.app)
      .post('/api/questionnaire/public/link')
      .send({ token: 't' })
      .expect(404, notFound);
    await request(h.app).get('/api/contests').set(USER_HEADER, 'alice').set(PROXY_SECRET_HEADER, SECRET).expect(200);
  });

  it('leaves the health check open', async () => {
    const h = await buildTestApp({ proxySecret: SECRET });
    await request(h.app).get('/health').expect(200, { status: 'ok' });
  });

  it('is off when no secret is configured', async () => {
    const h = await buildTestApp();
    await h.as('alice').get('/api/contests').expect(200);
  });
});

describe('admin request-ip probe', () => {
  it('reports the derived and forwarded addresses to an admin', async () => {
    const h = await buildTestApp({ adminEmails: new Set(['admin@example.test']) });
    const res = await h
      .as('admin')
      .get('/api/admin/request-ip')
      .set('X-Forwarded-For', '198.51.100.1, 203.0.113.9')
      .set('X-Real-IP', '198.51.100.1')
      .expect(200);
    expect(res.body).toMatchObject({
      ip: '203.0.113.9',
      forwardedFor: '198.51.100.1, 203.0.113.9',
      realIp: '198.51.100.1',
    });
    expect(Array.isArray(res.body.ips)).toBe(true);
    expect(typeof res.body.remoteAddress).toBe('string');
  });

  it('is dark to everyone else', async () => {
    const h = await buildTestApp({ adminEmails: new Set(['admin@example.test']) });
    await h.as('alice').get('/api/admin/request-ip').expect(404, { error: 'Not found' });
    await request(h.app).get('/api/admin/request-ip').expect(404, { error: 'Not found' });
  });
});

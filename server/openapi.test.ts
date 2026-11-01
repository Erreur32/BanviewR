import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DOCS_PREFIX } from './openapi.ts';
import { buildTestApp, pw } from './test-utils.ts';

const ORIGIN = { host: 'bvr.test', origin: 'http://bvr.test' };
const ADMIN = { username: 'admin', password: pw('openapi-admin') };

let app: FastifyInstance;
let cookie: string;

beforeEach(async () => {
  app = await buildTestApp();
  const res = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: ORIGIN, payload: ADMIN });
  cookie = `bvr_session=${res.cookies.find((c) => c.name === 'bvr_session')?.value}`;
});
afterEach(() => app.close());

describe('OpenAPI', () => {
  it('needs authentication', async () => {
    const res = await app.inject({ method: 'GET', url: `${DOCS_PREFIX}/json` });
    expect(res.json().result).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('describes routes with their schemas and access', async () => {
    const res = await app.inject({ method: 'GET', url: `${DOCS_PREFIX}/json`, headers: { cookie } });
    const doc = res.json();
    expect(doc.openapi).toMatch(/^3\./);

    const listUsers = doc.paths['/api/users'].get;
    expect(listUsers['x-access']).toBe('admin');
    expect(listUsers.tags).toEqual(['users']);
    expect(listUsers.security).toEqual([{ bearerAuth: [] }, { sessionCookie: [] }]);
    expect(listUsers.responses['200'].content['application/json'].schema.properties.success).toBeDefined();

    expect(doc.paths['/api/tokens'].post.security).toEqual([{ sessionCookie: [] }]);
    expect(doc.paths['/api/health'].get.security).toEqual([]);
    expect(doc.paths['/api/users/{id}'].patch.requestBody).toBeDefined();
    // The docs routes themselves stay out of the spec
    expect(Object.keys(doc.paths).some((p) => p.startsWith(DOCS_PREFIX))).toBe(false);
  });

  it('serves the UI to signed-in users', async () => {
    const res = await app.inject({ method: 'GET', url: `${DOCS_PREFIX}/`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
  });
});

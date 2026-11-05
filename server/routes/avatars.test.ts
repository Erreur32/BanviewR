import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { avatars } from '../db/schema.ts';
import { buildTestApp, pw } from '../test-utils.ts';
import { imageType } from './avatars.ts';

const ORIGIN = { host: 'bvr.test', origin: 'http://bvr.test' };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildTestApp();
});
afterEach(() => app.close());

async function call(method: 'GET' | 'POST' | 'DELETE', url: string, cookie: string, body?: object) {
  return app.inject({ method, url, headers: { ...ORIGIN, cookie }, payload: body });
}
const result = (res: { json: () => { result: Record<string, unknown> } }) => res.json().result;

async function signIn(path: string, body: object) {
  const res = await app.inject({ method: 'POST', url: `/api/auth/${path}`, headers: ORIGIN, payload: body });
  return `bvr_session=${res.cookies.find((c) => c.name === 'bvr_session')?.value}`;
}

describe('avatars', () => {
  it('tells pictures from their first bytes', () => {
    expect(imageType(PNG)).toBe('image/png');
    expect(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(imageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
  });

  it('stores, serves and removes your own picture', async () => {
    const admin = await signIn('setup', { username: 'admin', password: pw('correct-horse-battery') });
    const set = result(await call('POST', '/api/auth/avatar', admin, { image: PNG.toString('base64') }));
    expect(set.avatarAt).toEqual(expect.any(String));
    expect(result(await call('GET', '/api/auth/status', admin))).toMatchObject({ user: { avatarAt: set.avatarAt } });

    const img = await call('GET', '/api/users/1/avatar', admin);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['content-security-policy']).toContain('sandbox');
    expect(img.rawPayload.equals(PNG)).toBe(true);

    await call('DELETE', '/api/auth/avatar', admin);
    expect(result(await call('GET', '/api/users/1/avatar', admin))).toMatchObject({ code: 'NOT_FOUND' });
    expect(result(await call('GET', '/api/auth/status', admin))).toMatchObject({ user: { avatarAt: null } });
  });

  it('refuses anything that is not a small PNG, JPEG or WebP', async () => {
    const admin = await signIn('setup', { username: 'admin', password: pw('correct-horse-battery') });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const big = Buffer.concat([PNG, Buffer.alloc(300 * 1024)]);
    for (const data of [svg, big]) {
      expect(result(await call('POST', '/api/auth/avatar', admin, { image: data.toString('base64') }))).toMatchObject({
        code: 'VALIDATION',
      });
    }
    expect(app.db.select().from(avatars).all()).toHaveLength(0);
  });

  it('lets an admin take down a picture, and goes with the account', async () => {
    const admin = await signIn('setup', { username: 'admin', password: pw('correct-horse-battery') });
    await call('POST', '/api/users', admin, { username: 'viewer', password: pw('viewer-password-1'), role: 'viewer' });
    const viewer = await signIn('login', { username: 'viewer', password: pw('viewer-password-1') });
    await call('POST', '/api/auth/avatar', viewer, { image: PNG.toString('base64') });
    expect(result(await call('DELETE', '/api/users/1/avatar', viewer))).toMatchObject({ code: 'FORBIDDEN' });

    await call('DELETE', '/api/users/2/avatar', admin);
    expect(app.db.select().from(avatars).all()).toHaveLength(0);
    await call('POST', '/api/auth/avatar', viewer, { image: PNG.toString('base64') });
    await call('DELETE', '/api/users/2', admin);
    expect(app.db.select().from(avatars).all()).toHaveLength(0);
  });
});

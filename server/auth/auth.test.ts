import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, sessions } from '../db/schema.ts';
import { buildTestApp } from '../test-utils.ts';

// Test fixtures, built at runtime so they never look like stored credentials
const pw = (label: string) => `${label}-fixture`;

const ORIGIN = { host: 'bvr.test', origin: 'http://bvr.test' };
const ADMIN = { username: 'admin', password: pw('correct-horse-battery') };

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildTestApp();
  // A host-scoped route, as fail2ban routes will be
  app.get('/api/hosts/:hostId/ping', { config: { access: 'read' } }, async () => ({
    success: true,
    result: { ok: true },
  }));
});
afterEach(() => app.close());

function sessionCookie(res: { cookies: { name: string; value: string }[] }) {
  const value = res.cookies.find((c) => c.name === 'bvr_session')?.value;
  if (!value) throw new Error('no session cookie');
  return `bvr_session=${value}`;
}

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  opts: { cookie?: string; token?: string; body?: object } = {},
) {
  const headers: Record<string, string> = { ...ORIGIN };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return app.inject({ method, url, headers, payload: opts.body });
}

const result = (res: { json: () => { result: Record<string, unknown> } }) => res.json().result;

async function setupAdmin() {
  return sessionCookie(await call('POST', '/api/auth/setup', { body: ADMIN }));
}

async function createUser(admin: string, username: string, role: 'admin' | 'viewer') {
  await call('POST', '/api/users', { cookie: admin, body: { username, password: pw('viewer-password-1'), role } });
  return sessionCookie(
    await call('POST', '/api/auth/login', { body: { username, password: pw('viewer-password-1') } }),
  );
}

async function createToken(admin: string, body: object) {
  return result(await call('POST', '/api/tokens', { cookie: admin, body })).secret as string;
}

describe('setup', () => {
  it('creates the first admin once', async () => {
    expect(result(await call('GET', '/api/auth/status'))).toMatchObject({ setupRequired: true, user: null });
    const admin = await setupAdmin();
    expect(result(await call('GET', '/api/auth/status', { cookie: admin }))).toMatchObject({
      setupRequired: false,
      user: { username: 'admin', role: 'admin' },
    });
    expect(
      result(await call('POST', '/api/auth/setup', { body: { username: 'other', password: pw('another-password') } })),
    ).toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a short password', async () => {
    expect(
      result(await call('POST', '/api/auth/setup', { body: { username: 'admin', password: 'short' } })),
    ).toMatchObject({ code: 'VALIDATION' });
  });
});

describe('login', () => {
  it('signs in with valid credentials and rejects wrong ones', async () => {
    await setupAdmin();
    expect(result(await call('POST', '/api/auth/login', { body: ADMIN }))).toMatchObject({
      ok: true,
      user: { username: 'admin' },
    });
    expect(
      result(await call('POST', '/api/auth/login', { body: { ...ADMIN, password: pw('wrong-password') } })),
    ).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(
      result(await call('POST', '/api/auth/login', { body: { username: 'ghost', password: pw('whatever-pass') } })),
    ).toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('locks the account after 5 failures, even with the right password', async () => {
    await setupAdmin();
    for (let i = 0; i < 5; i++)
      await call('POST', '/api/auth/login', { body: { ...ADMIN, password: pw('wrong-password') } });
    expect(result(await call('POST', '/api/auth/login', { body: ADMIN }))).toMatchObject({ code: 'LOCKED' });
  });

  it('signing in again replaces the presented session', async () => {
    const first = await setupAdmin();
    const res = await call('POST', '/api/auth/login', { cookie: first, body: ADMIN });
    expect(result(await call('GET', '/api/users', { cookie: first }))).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(result(await call('GET', '/api/users', { cookie: sessionCookie(res) }))).toMatchObject({ ok: true });
  });

  it('logs out and refuses expired sessions', async () => {
    const admin = await setupAdmin();
    await call('POST', '/api/auth/logout', { cookie: admin });
    expect(result(await call('GET', '/api/users', { cookie: admin }))).toMatchObject({ code: 'UNAUTHORIZED' });

    const again = sessionCookie(await call('POST', '/api/auth/login', { body: ADMIN }));
    app.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .run();
    expect(result(await call('GET', '/api/users', { cookie: again }))).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('changing the password signs out the other sessions', async () => {
    const first = await setupAdmin();
    const second = sessionCookie(await call('POST', '/api/auth/login', { body: ADMIN }));
    const body = { currentPassword: ADMIN.password, newPassword: pw('brand-new-password') };
    expect(result(await call('POST', '/api/auth/password', { cookie: first, body }))).toEqual({ ok: true });
    expect(result(await call('GET', '/api/users', { cookie: first }))).toMatchObject({ ok: true });
    expect(result(await call('GET', '/api/users', { cookie: second }))).toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('preferences', () => {
  it('stores a valid time zone and rejects unknown ones', async () => {
    const admin = await setupAdmin();
    expect(result(await call('GET', '/api/auth/status', { cookie: admin }))).toMatchObject({
      user: { timezone: 'browser' },
    });
    expect(
      result(await call('PATCH', '/api/auth/preferences', { cookie: admin, body: { timezone: 'Europe/Paris' } })),
    ).toMatchObject({
      user: { timezone: 'Europe/Paris' },
    });
    expect(
      result(await call('PATCH', '/api/auth/preferences', { cookie: admin, body: { timezone: 'Mars/Olympus' } })),
    ).toMatchObject({
      code: 'VALIDATION',
    });
  });
});

describe('access control', () => {
  it('requires authentication but keeps unknown routes as not found', async () => {
    expect(result(await call('GET', '/api/users'))).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(result(await call('GET', '/api/nope'))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('gives viewers read access only', async () => {
    const admin = await setupAdmin();
    const viewer = await createUser(admin, 'viewer', 'viewer');
    expect(result(await call('GET', '/api/hosts/1/ping', { cookie: viewer }))).toEqual({ ok: true });
    expect(result(await call('GET', '/api/users', { cookie: viewer }))).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses unsafe requests from another origin, signed in or not', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { host: 'bvr.test', origin: 'http://evil.test' },
      payload: ADMIN,
    });
    expect(result(res)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses cookie requests from another origin', async () => {
    const admin = await setupAdmin();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { host: 'bvr.test', origin: 'http://evil.test', cookie: admin },
    });
    expect(result(res)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('protects the last admin', async () => {
    const admin = await setupAdmin();
    expect(result(await call('PATCH', '/api/users/1', { cookie: admin, body: { role: 'viewer' } }))).toMatchObject({
      code: 'CONFLICT',
    });
    expect(result(await call('DELETE', '/api/users/1', { cookie: admin }))).toMatchObject({ code: 'CONFLICT' });
  });
});

describe('API tokens', () => {
  it('applies scopes, and token management stays session only', async () => {
    const admin = await setupAdmin();
    const read = await createToken(admin, { name: 'ro', scopes: ['read'] });
    const full = await createToken(admin, { name: 'full', scopes: ['admin'] });
    expect(read).toMatch(/^bvr_/);

    expect(result(await call('GET', '/api/hosts/1/ping', { token: read }))).toEqual({ ok: true });
    expect(result(await call('GET', '/api/users', { token: read }))).toMatchObject({ code: 'FORBIDDEN' });
    expect(result(await call('GET', '/api/users', { token: full }))).toMatchObject({ ok: true });
    expect(result(await call('GET', '/api/tokens', { token: full }))).toMatchObject({ code: 'FORBIDDEN' });
    // No Origin check for tokens: they are not sent automatically by browsers
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { authorization: `Bearer ${full}` },
      payload: { username: 'bot', password: pw('bot-password-1'), role: 'viewer' },
    });
    expect(result(res)).toMatchObject({ ok: true });
  });

  it('restricts a token to its instances', async () => {
    const admin = await setupAdmin();
    const scoped = await createToken(admin, { name: 'host1', scopes: ['read'], hostIds: [1] });
    expect(result(await call('GET', '/api/hosts/1/ping', { token: scoped }))).toEqual({ ok: true });
    expect(result(await call('GET', '/api/hosts/2/ping', { token: scoped }))).toMatchObject({ code: 'FORBIDDEN' });
    expect(
      result(
        await call('POST', '/api/tokens', { cookie: admin, body: { name: 'x', scopes: ['read'], hostIds: [99] } }),
      ),
    ).toMatchObject({ code: 'VALIDATION' });
  });

  it('refuses revoked tokens and deletes only revoked ones', async () => {
    const admin = await setupAdmin();
    const secret = await createToken(admin, { name: 'tmp', scopes: ['read'] });
    expect(result(await call('DELETE', '/api/tokens/1', { cookie: admin }))).toMatchObject({ code: 'CONFLICT' });
    await call('POST', '/api/tokens/1/revoke', { cookie: admin });
    expect(result(await call('GET', '/api/hosts/1/ping', { token: secret }))).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(result(await call('DELETE', '/api/tokens/1', { cookie: admin }))).toEqual({ ok: true });
  });
});

describe('users', () => {
  it('treats usernames without regard to case', async () => {
    const admin = await setupAdmin();
    expect(result(await call('POST', '/api/auth/login', { body: { ...ADMIN, username: 'ADMIN' } }))).toMatchObject({
      ok: true,
    });
    const dup = await call('POST', '/api/users', {
      cookie: admin,
      body: { username: 'Admin', password: pw('another-password'), role: 'viewer' },
    });
    expect(result(dup)).toMatchObject({ code: 'CONFLICT' });
  });

  it('revokes the tokens of a deleted or demoted admin', async () => {
    const admin = await setupAdmin();
    const second = await createUser(admin, 'second', 'admin');
    const third = await createUser(admin, 'third', 'admin');
    const fromSecond = await createToken(second, { name: 'a', scopes: ['read'] });
    const fromThird = await createToken(third, { name: 'b', scopes: ['read'] });

    await call('DELETE', '/api/users/2', { cookie: admin });
    await call('PATCH', '/api/users/3', { cookie: admin, body: { role: 'viewer' } });
    expect(result(await call('GET', '/api/hosts/1/ping', { token: fromSecond }))).toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(result(await call('GET', '/api/hosts/1/ping', { token: fromThird }))).toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

describe('audit log', () => {
  it('records failed logins and changes with their author', async () => {
    const admin = await setupAdmin();
    await call('POST', '/api/auth/login', { body: { ...ADMIN, password: pw('wrong-password') } });
    await createToken(admin, { name: 'ci', scopes: ['read'] });

    const failed = app.db.select().from(auditLog).where(eq(auditLog.action, 'auth.login')).get();
    expect(failed).toMatchObject({ ok: false, actorName: 'admin', detail: 'invalid credentials' });
    const entries = result(await call('GET', '/api/audit', { cookie: admin })).entries as {
      action: string;
      actorName: string;
    }[];
    expect(entries[0]).toMatchObject({ action: 'token.create', actorName: 'admin' });
  });
});

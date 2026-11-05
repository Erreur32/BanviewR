import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, sessions } from '../db/schema.ts';
import { resetPassword } from '../resetPassword.ts';
import { addUser, buildTestApp, pw, TEST_ORIGIN } from '../test-utils.ts';

const ADMIN = { username: 'admin', password: pw('correct-horse-battery') };
let app: FastifyInstance;
let admin: string;

beforeEach(async () => {
  app = await buildTestApp();
  admin = await signIn('setup', ADMIN);
});
afterEach(() => app.close());

async function signIn(path: 'setup' | 'login', body: object) {
  const res = await app.inject({ method: 'POST', url: `/api/auth/${path}`, headers: TEST_ORIGIN, payload: body });
  const value = res.cookies.find((c) => c.name === 'bvr_session')?.value;
  return value ? `bvr_session=${value}` : res.json().result.code;
}

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie: string, body?: object) {
  const res = await app.inject({ method, url, headers: { ...TEST_ORIGIN, cookie }, payload: body });
  return res.json().result;
}

// Pretends the password was last typed 20 minutes ago in every session
const ageConfirmations = () =>
  app.db
    .update(sessions)
    .set({ confirmedAt: new Date(Date.now() - 20 * 60_000) })
    .run();

describe('recent password confirmation', () => {
  it('asks the admin password again before account and token changes', async () => {
    ageConfirmations();
    const newUser = { username: 'bob', password: pw('bob-password'), role: 'viewer' };
    expect(await call('POST', '/api/users', admin, newUser)).toMatchObject({ code: 'REAUTH_REQUIRED' });
    expect(await call('POST', '/api/tokens', admin, { name: 't', scopes: ['read'] })).toMatchObject({
      code: 'REAUTH_REQUIRED',
    });
    // Reading stays open
    expect(await call('GET', '/api/users', admin)).toMatchObject({ ok: true });

    expect(await call('POST', '/api/auth/confirm', admin, { password: pw('wrong') })).toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(await call('POST', '/api/auth/confirm', admin, { password: ADMIN.password })).toEqual({ ok: true });
    expect(await call('POST', '/api/users', admin, newUser)).toMatchObject({ ok: true });
  });

  it('locks the confirmation after repeated wrong passwords', async () => {
    for (let i = 0; i < 5; i++) await call('POST', '/api/auth/confirm', admin, { password: pw('wrong') });
    expect(await call('POST', '/api/auth/confirm', admin, { password: ADMIN.password })).toMatchObject({
      code: 'LOCKED',
    });
  });
});

describe('password chosen by an admin', () => {
  it('must be replaced before anything else works', async () => {
    await call('POST', '/api/users', admin, { username: 'bob', password: pw('given-password'), role: 'viewer' });
    const bob = await signIn('login', { username: 'bob', password: pw('given-password') });
    expect(await call('GET', '/api/auth/status', bob)).toMatchObject({ user: { mustChangePassword: true } });
    expect(await call('GET', '/api/hosts', bob)).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });

    const same = { currentPassword: pw('given-password'), newPassword: pw('given-password') };
    expect(await call('POST', '/api/auth/password', bob, same)).toMatchObject({ code: 'CONFLICT' });
    const own = { currentPassword: pw('given-password'), newPassword: pw('bob-own-password') };
    expect(await call('POST', '/api/auth/password', bob, own)).toEqual({ ok: true });
    expect(await call('GET', '/api/hosts', bob)).toMatchObject({ ok: true });

    await call('PATCH', '/api/users/2', admin, { password: pw('reset-password') });
    const again = await signIn('login', { username: 'bob', password: pw('reset-password') });
    expect(await call('GET', '/api/auth/status', again)).toMatchObject({ user: { mustChangePassword: true } });
  });

  it('can be set from the command line, signing the account out', async () => {
    const bob = await addUser(app, admin, 'bob', 'viewer');
    const done = await resetPassword(app.db, 'BOB');
    expect(done).toMatchObject({ username: 'bob', disabled: false });
    expect(await call('GET', '/api/auth/status', bob)).toMatchObject({ user: null });

    const fresh = await signIn('login', { username: 'bob', password: done?.password });
    expect(await call('GET', '/api/auth/status', fresh)).toMatchObject({ user: { mustChangePassword: true } });
    expect(await resetPassword(app.db, 'nobody')).toBeNull();
    const entry = app.db.select().from(auditLog).where(eq(auditLog.ip, 'cli')).get();
    expect(entry).toMatchObject({ actorType: 'system', target: 'bob', action: 'user.update' });
  });
});

describe('disabled accounts', () => {
  it('cannot sign in, lose their sessions and tokens, and come back when enabled', async () => {
    const second = await addUser(app, admin, 'second', 'admin');
    const token = (await call('POST', '/api/tokens', second, { name: 't', scopes: ['read'] })).secret;
    expect(await call('PATCH', '/api/users/2', admin, { disabled: true })).toMatchObject({
      user: { disabledAt: expect.any(String) },
    });
    expect(await call('GET', '/api/auth/status', second)).toMatchObject({ user: null });
    const byToken = await app.inject({
      method: 'GET',
      url: '/api/hosts',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(byToken.json().result).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await signIn('login', { username: 'second', password: pw('own-password') })).toBe('ACCOUNT_DISABLED');
    // A wrong password says nothing about the account
    expect(await signIn('login', { username: 'second', password: pw('wrong') })).toBe('INVALID_CREDENTIALS');

    await call('PATCH', '/api/users/2', admin, { disabled: false });
    expect(await signIn('login', { username: 'second', password: pw('own-password') })).toMatch(/^bvr_session=/);
  });

  it('never disables or demotes yourself', async () => {
    expect(await call('PATCH', '/api/users/1', admin, { disabled: true })).toMatchObject({ code: 'CONFLICT' });
    const second = await addUser(app, admin, 'second', 'admin');
    await call('PATCH', '/api/users/1', second, { disabled: true });
    expect(await call('PATCH', '/api/users/2', second, { role: 'viewer' })).toMatchObject({ code: 'CONFLICT' });
  });
});

describe('own sessions', () => {
  it('lists them and signs out one, or all the others', async () => {
    const other = await signIn('login', ADMIN);
    const { sessions: list } = await call('GET', '/api/auth/sessions', admin);
    expect(list).toHaveLength(2);
    const current = list.find((s: { current: boolean }) => s.current);
    const away = list.find((s: { current: boolean }) => !s.current);
    expect(current).toBeDefined();

    const bob = await addUser(app, admin, 'bob', 'viewer');
    expect(await call('DELETE', `/api/auth/sessions/${away.id}`, bob)).toMatchObject({ code: 'NOT_FOUND' });
    expect(await call('DELETE', `/api/auth/sessions/${away.id}`, admin)).toEqual({ ok: true });
    expect(await call('GET', '/api/auth/status', other)).toMatchObject({ user: null });

    await signIn('login', ADMIN);
    await call('POST', '/api/auth/sessions/revoke-others', admin);
    expect((await call('GET', '/api/auth/sessions', admin)).sessions).toHaveLength(1);
  });
});

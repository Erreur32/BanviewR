import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseBlocklist } from './blocklists.ts';
import type { Fail2banConnector } from './connectors/connector.ts';
import { auditLog, blocklists, sessions } from './db/schema.ts';
import { buildTestApp, fakeConnector, pw } from './test-utils.ts';

const ORIGIN = { host: 'bvr.test', origin: 'http://bvr.test' };
const LIST_URL = 'https://lists.example.test/drop.txt';

describe('parseBlocklist', () => {
  it('reads addresses and networks in the usual formats', () => {
    const text = [
      '# comment',
      '203.0.113.7',
      '198.51.100.0/24 ; SBL1234',
      'add someset 192.0.2.9',
      '203.0.113.7',
      '2001:db8::1',
      '1234.5.6.7',
      '203.0.113.8/32',
    ].join('\n');
    expect(parseBlocklist(text, [])).toEqual({
      entries: ['203.0.113.7', '198.51.100.0/24', '192.0.2.9', '203.0.113.8'],
      skipped: 0,
    });
  });

  it('leaves out private ranges, signed-in users and networks too wide', () => {
    const text = ['10.1.2.3', '192.168.0.0/16', '172.0.0.0/8', '100.0.0.0/6', '198.51.100.0/24', '203.0.113.7'].join(
      '\n',
    );
    expect(parseBlocklist(text, ['::ffff:198.51.100.9'])).toEqual({ entries: ['203.0.113.7'], skipped: 5 });
  });
});

describe('blocklist routes', () => {
  let app: FastifyInstance;
  let cookie: string;

  async function start(overrides: Partial<Fail2banConnector>) {
    app = await buildTestApp({ connect: () => fakeConnector(overrides) });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: ORIGIN,
      payload: { username: 'admin', password: pw('blocklist-admin') },
    });
    cookie = `bvr_session=${res.cookies.find((c) => c.name === 'bvr_session')?.value}`;
  }
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
  });

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app
      .inject({ method, url: `/api/hosts/1/blocklists${url}`, headers: { ...ORIGIN, cookie }, payload })
      .then((r) => r.json().result);

  it('adds a list off, loads it when turned on, removes it when turned off or deleted', async () => {
    const loadBlocklist = vi.fn(async () => {});
    const dropBlocklist = vi.fn(async () => {});
    await start({ loadBlocklist, dropBlocklist });
    const fetchMock = vi.fn(async () => new Response('203.0.113.7\n10.0.0.1\n198.51.100.20\n'));
    vi.stubGlobal('fetch', fetchMock);
    // A user signed in from a listed address
    const userId = app.db.select().from(sessions).get()?.userId ?? 0;
    app.db
      .insert(sessions)
      .values({ id: 'x', userId, expiresAt: new Date(Date.now() + 60_000), ip: '198.51.100.20', userAgent: '' })
      .run();

    const { blocklist } = await call('POST', '', { name: 'Drop', url: LIST_URL });
    expect(blocklist).toMatchObject({ enabled: false, set: `bvr-bl-${blocklist.id}`, lastError: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await call('POST', `/${blocklist.id}/refresh`)).code).toBe('CONFLICT');

    const on = await call('PATCH', `/${blocklist.id}`, { enabled: true });
    expect(on.blocklist).toMatchObject({ enabled: true, entries: 1, skipped: 2, lastError: '' });
    expect(loadBlocklist).toHaveBeenCalledWith(`bvr-bl-${blocklist.id}`, ['203.0.113.7']);
    expect(fetchMock).toHaveBeenCalledWith(LIST_URL, expect.anything());

    expect((await call('POST', `/${blocklist.id}/refresh`)).ok).toBe(true);
    expect((await call('PATCH', `/${blocklist.id}`, { enabled: false })).blocklist.enabled).toBe(false);
    expect((await call('DELETE', `/${blocklist.id}`)).ok).toBe(true);
    expect(dropBlocklist).toHaveBeenCalledTimes(2);
    expect(app.db.select().from(blocklists).all()).toEqual([]);
    expect(
      app.db
        .select()
        .from(auditLog)
        .all()
        .map((a) => a.action)
        .filter((a) => a.startsWith('blocklist.')),
    ).toEqual(['blocklist.create', 'blocklist.enable', 'blocklist.refresh', 'blocklist.disable', 'blocklist.delete']);
  });

  it('stays off and keeps the error when the download fails', async () => {
    await start({});
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }));
    const { blocklist } = await call('POST', '', { name: 'Drop', url: LIST_URL });
    expect((await call('PATCH', `/${blocklist.id}`, { enabled: true })).code).toBe('UNAVAILABLE');
    expect((await call('GET', '')).blocklists[0]).toMatchObject({
      enabled: false,
      lastError: 'The list answered HTTP 404',
    });
  });

  it('refuses other URLs and API tokens', async () => {
    await start({});
    expect((await call('POST', '', { name: 'x', url: 'file:///etc/passwd' })).code).toBe('VALIDATION');
    const { secret } = await app
      .inject({
        method: 'POST',
        url: '/api/tokens',
        headers: { ...ORIGIN, cookie },
        payload: { name: 't', scopes: ['admin'] },
      })
      .then((r) => r.json().result);
    const res = await app.inject({
      method: 'POST',
      url: '/api/hosts/1/blocklists',
      headers: { authorization: `Bearer ${secret}` },
      payload: { name: 'x', url: LIST_URL },
    });
    expect(res.json().result.code).toBe('FORBIDDEN');
  });
});

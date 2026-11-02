import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webhooks } from './db/schema.ts';
import { noGeo } from './geoip.ts';
import { notifyAction, notifyBans } from './notifications.ts';
import { buildTestApp, pw } from './test-utils.ts';

const ORIGIN = { host: 'bvr.test', origin: 'http://bvr.test' };
// Placeholder fixture, built at runtime so it never looks like a real webhook URL
const DISCORD = ['https://discord.com/api', 'webhooks', '123', 'secret-part'].join('/');
const NOW = Math.floor(Date.now() / 1000);

let app: FastifyInstance;
let cookie: string;
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('', { status: 204 }));
const sentBodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));

beforeEach(async () => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  app = await buildTestApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    headers: ORIGIN,
    payload: { username: 'admin', password: pw('notify-admin') },
  });
  cookie = `bvr_session=${res.cookies.find((c) => c.name === 'bvr_session')?.value}`;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
});

const asAdmin = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { ...ORIGIN, cookie }, payload });

describe('notification settings', () => {
  it('never sends the secret part back', async () => {
    const created = await asAdmin('POST', '/api/webhooks', { name: 'chat', kind: 'discord', target: DISCORD });
    expect(created.json().result.webhook).toMatchObject({ destination: 'https://discord.com', lastError: null });
    const list = await asAdmin('GET', '/api/webhooks');
    expect(list.body).not.toContain('secret-part');
  });

  it('checks the destination for its kind', async () => {
    const bad = [
      { name: 'a', kind: 'generic', target: 'file:///etc/passwd' },
      { name: 'b', kind: 'telegram', target: 'not-a-token', chatId: '42' },
      { name: 'c', kind: 'telegram', target: `123456:${'x'.repeat(35)}`, chatId: null },
    ];
    for (const body of bad) {
      expect((await asAdmin('POST', '/api/webhooks', body)).json().result.code).toBe('VALIDATION');
    }
  });

  it('refuses API tokens', async () => {
    const token = await asAdmin('POST', '/api/tokens', { name: 't', scopes: ['admin'] });
    const res = await app.inject({
      method: 'GET',
      url: '/api/webhooks',
      headers: { authorization: `Bearer ${token.json().result.secret}` },
    });
    expect(res.json().result.code).toBe('FORBIDDEN');
  });

  it('reports a failed test send', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    const { webhook } = (await asAdmin('POST', '/api/webhooks', { name: 'x', kind: 'generic', target: DISCORD })).json()
      .result;
    const res = (await asAdmin('POST', `/api/webhooks/${webhook.id}/test`)).json().result;
    expect(res).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect((await asAdmin('GET', '/api/webhooks')).json().result.webhooks[0].lastError).toBe('HTTP 500');
  });
});

describe('notification sending', () => {
  const add = (values: Partial<typeof webhooks.$inferInsert>) =>
    app.db
      .insert(webhooks)
      .values({ name: 'n', kind: 'discord', target: DISCORD, ...values })
      .run();
  const ban = (ip: string, bannedAt: number) => ({ ip, jail: 'sshd', bannedAt, bantime: 600, failures: 3 });

  it('sends recent bans only, without mentions', async () => {
    add({});
    add({ enabled: false });
    add({ onBans: false });
    notifyBans(app.db, noGeo, 1, [ban('203.0.113.1', NOW - 86400), ban('203.0.113.2', NOW)]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [body] = sentBodies();
    expect(body.content).toContain('203.0.113.2');
    expect(body.content).not.toContain('203.0.113.1');
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it('sends manual actions only where asked, with who did it', async () => {
    add({});
    add({ onActions: true, onBans: false });
    const caller = { principal: { kind: 'user', id: 1, name: 'alice' } as never, ip: '127.0.0.1' };
    notifyAction(app.db, caller, { hostId: 1, action: 'unban', target: '203.0.113.9', jail: 'sshd' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(sentBodies()[0].content).toBe('BanviewR local: alice unban 203.0.113.9 in sshd');
  });

  it('sends nothing for a catch-up import', async () => {
    add({});
    notifyBans(app.db, noGeo, 1, [ban('203.0.113.1', NOW - 86400)]);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends JSON to a generic webhook, Telegram in plain text', async () => {
    add({ kind: 'generic', target: 'https://hooks.example/x' });
    add({ kind: 'telegram', target: `123456:${'x'.repeat(35)}`, chatId: '-100' });
    notifyBans(app.db, noGeo, 1, [ban('203.0.113.2', NOW)]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const bodies = sentBodies();
    expect(bodies).toContainEqual(
      expect.objectContaining({
        event: 'bans',
        instance: 'local',
        more: 0,
        bans: [expect.objectContaining({ ip: '203.0.113.2' })],
      }),
    );
    expect(bodies).toContainEqual(
      expect.objectContaining({ chat_id: '-100', text: expect.stringContaining('203.0.113.2') }),
    );
    expect(bodies.find((b) => b.chat_id)).not.toHaveProperty('parse_mode');
  });
});

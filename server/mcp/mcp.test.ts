import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fail2banConnector } from '../connectors/connector.ts';
import { auditLog, banEvents } from '../db/schema.ts';
import { buildTestApp, fakeConnector, pw } from '../test-utils.ts';

const ORIGIN = { host: 'bvr.test', origin: 'http://bvr.test' };

let app: FastifyInstance;
let cookie: string;
let client: Client | undefined;
let url: URL;

// A real HTTP round trip with the SDK client: the transport is what can break
async function start(overrides: Partial<Fail2banConnector> = {}, mcpWrite = false) {
  app = await buildTestApp({ connect: () => fakeConnector(overrides), mcpWrite });
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    headers: ORIGIN,
    payload: { username: 'admin', password: pw('mcp-admin') },
  });
  cookie = `bvr_session=${res.cookies.find((c) => c.name === 'bvr_session')?.value}`;
  url = new URL(`${await app.listen({ port: 0, host: '127.0.0.1' })}/api/mcp`);
}

async function token(body: object) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    headers: { ...ORIGIN, cookie },
    payload: { name: 'agent', ...body },
  });
  return res.json().result.secret as string;
}

async function connect(secret: string) {
  client = new Client({ name: 'test', version: '1' });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: `Bearer ${secret}` } },
  });
  await client.connect(transport);
  return client;
}

const call = async (name: string, args: Record<string, unknown>) => {
  const res = await (client as Client).callTool({ name, arguments: args });
  const text = (res.content as { text: string }[])[0]?.text ?? '';
  return res.isError ? { error: text } : JSON.parse(text);
};
const toolNames = async () => (await (client as Client).listTools()).tools.map((t) => t.name);

afterEach(async () => {
  await client?.close();
  client = undefined;
  await app.close();
});

describe('MCP over HTTP', () => {
  it('serves read tools to a read token, without the write ones', async () => {
    await start({ activeBans: async () => [] }, true);
    await connect(await token({ scopes: ['read'] }));
    const names = await toolNames();
    expect(names).toContain('active_bans');
    expect(names).not.toContain('ban');
    expect(await call('active_bans', { hostId: 1 })).toEqual({ bans: [] });
    expect((await call('list_instances', {})).instances[0]).toMatchObject({ id: 1, name: 'local' });
  });

  it('hides write tools while the switch is off, even from a write token', async () => {
    await start();
    await connect(await token({ scopes: ['write'] }));
    expect(await toolNames()).not.toContain('ban');
  });

  it('bans through the same audit log as the API', async () => {
    const ban = vi.fn(async () => {});
    await start({ ban }, true);
    await connect(await token({ scopes: ['write'] }));
    expect(await call('ban', { hostId: 1, jail: 'sshd', target: '203.0.113.7' })).toEqual({ ok: true });
    expect(ban).toHaveBeenCalledWith('sshd', '203.0.113.7');
    expect(app.db.select().from(auditLog).all().at(-1)).toMatchObject({
      action: 'jail.ban',
      actorType: 'token',
      actorName: 'agent',
      hostId: 1,
      ok: true,
    });
  });

  it('refuses to ban the address of the caller', async () => {
    const ban = vi.fn(async () => {});
    await start({ ban }, true);
    await connect(await token({ scopes: ['write'] }));
    const res = await call('ban', { hostId: 1, jail: 'sshd', target: '127.0.0.1' });
    expect(res.error).toContain('CONFLICT');
    expect(ban).not.toHaveBeenCalled();
  });

  it('keeps a limited token to its instances', async () => {
    await start({ activeBans: async () => [] });
    await connect(await token({ scopes: ['read'], hostIds: [1] }));
    expect((await call('active_bans', { hostId: 2 })).error).toContain('FORBIDDEN');
  });

  it('reads the history and threats', async () => {
    await start();
    const now = Math.floor(Date.now() / 1000);
    const row = { hostId: 1, jail: 'sshd', ip: '203.0.113.1', bantime: 600, failures: 3 };
    app.db
      .insert(banEvents)
      .values([
        { ...row, bannedAt: now - 60 },
        { ...row, bannedAt: now - 120 },
        { ...row, ip: '203.0.113.2', bannedAt: now - 60 },
      ])
      .run();
    await connect(await token({ scopes: ['read'] }));
    const { bans } = await call('ban_history', { hostId: 1, ip: '203.0.113.1' });
    expect(bans).toHaveLength(2);
    const { threats } = await call('active_threats', { hostId: 1 });
    expect(threats).toMatchObject([{ ip: '203.0.113.1', bans: 2, jails: ['sshd'] }]);
    const resource = await (client as Client).readResource({ uri: 'banviewr://threats' });
    expect((resource.contents[0] as { text: string }).text).toContain('203.0.113.1');
  });

  it('hides internal errors', async () => {
    await start({
      activeBans: async () => {
        throw new Error('secret path /etc/x');
      },
    });
    await connect(await token({ scopes: ['read'] }));
    expect(await call('active_bans', { hostId: 1 })).toEqual({ error: 'INTERNAL: Internal server error' });
  });

  it('refuses a session cookie and a missing token', async () => {
    await start();
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    const withCookie = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: { ...ORIGIN, cookie },
      payload: body,
    });
    expect(withCookie.json().result.code).toBe('FORBIDDEN');
    const anonymous = await app.inject({ method: 'POST', url: '/api/mcp', headers: ORIGIN, payload: body });
    expect(anonymous.json().result.code).toBe('UNAUTHORIZED');
  });

  it('answers 405 on GET', async () => {
    await start();
    const secret = await token({ scopes: ['read'] });
    const res = await app.inject({ method: 'GET', url: '/api/mcp', headers: { authorization: `Bearer ${secret}` } });
    expect(res.statusCode).toBe(405);
  });
});

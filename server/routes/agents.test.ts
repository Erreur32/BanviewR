import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { JailStatus } from '../../shared/fail2ban.ts';
import { answerCall } from '../agentRpc.ts';
import type { Fail2banConnector } from '../connectors/connector.ts';
import { agents, auditLog } from '../db/schema.ts';
import { buildTestApp, fakeConnector, pw, TEST_ORIGIN } from '../test-utils.ts';

const ADMIN = { username: 'admin', password: pw('agents-admin') };
const SSHD: JailStatus = {
  name: 'sshd',
  currentlyFailed: 1,
  totalFailed: 9,
  currentlyBanned: 1,
  totalBanned: 4,
  bannedIps: ['203.0.113.7'],
  fileList: '/var/log/auth.log',
};

let app: FastifyInstance;
let cookie: string;
let base: string;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  app = await buildTestApp();
  const res = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: TEST_ORIGIN, payload: ADMIN });
  cookie = `bvr_session=${res.cookies.find((c) => c.name === 'bvr_session')?.value}`;
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  base = `ws://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await app.close();
});

const asAdmin = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { ...TEST_ORIGIN, cookie }, payload }).then((r) => r.json().result);

const enroll = (code: string) =>
  app
    .inject({ method: 'POST', url: '/api/agents/enroll', headers: { authorization: `Bearer ${code}` } })
    .then((r) => r.json().result);

async function addAgent(name = 'myoueb') {
  const created = await asAdmin('POST', '/api/agents', { name });
  const { secret } = await enroll(created.code);
  return { hostId: created.host.id as number, secret: secret as string, code: created.code as string };
}

// An agent process in miniature: says hello, answers calls with the given connector
function runAgent(secret: string, connector: Fail2banConnector) {
  const ws = new WebSocket(`${base}/api/agents/connect`, { headers: { authorization: `Bearer ${secret}` } });
  sockets.push(ws);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', version: '9.9.9', write: false })));
  ws.on('message', async (data) => {
    const reply = await answerCall(connector, data);
    if (reply) ws.send(JSON.stringify(reply));
  });
  return ws;
}

const waitOnline = (hostId: number) => vi.waitFor(() => expect(app.agents.online(hostId)).not.toBeNull());

describe('agent enrolment', () => {
  it('creates an agent instance with a one-time code, traded for a secret', async () => {
    const created = await asAdmin('POST', '/api/agents', { name: 'myoueb' });
    expect(created.code).toMatch(/^bvre_/);
    expect(created.host).toMatchObject({ mode: 'agent', socketPath: '', status: { error: 'AGENT_OFFLINE' } });
    expect(created.host.agent).toMatchObject({ enrolled: false, online: false });

    const first = await enroll(created.code);
    expect(first.secret).toMatch(/^bvra_/);
    // One use only
    expect(await enroll(created.code)).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });

    // Only hashes are stored
    const row = app.db.select().from(agents).get();
    expect(JSON.stringify(row)).not.toContain(first.secret);
    expect(row?.enrollHash).toBeNull();
    const actions = app.db
      .select()
      .from(auditLog)
      .all()
      .map((e) => `${e.action}:${e.ok}`);
    expect(actions).toEqual(expect.arrayContaining(['agent.create:true', 'agent.enroll:true', 'agent.enroll:false']));
  });

  it('refuses an expired code and API tokens passed as codes', async () => {
    const created = await asAdmin('POST', '/api/agents', { name: 'myoueb' });
    app.db
      .update(agents)
      .set({ enrollExpiresAt: new Date(Date.now() - 1000) })
      .run();
    expect(await enroll(created.code)).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    expect(await enroll('bvr_not-a-code')).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('needs a signed-in admin', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/agents', headers: TEST_ORIGIN, payload: { name: 'x' } });
    expect(res.json().result).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('keeps agent paths out of reach', async () => {
    const { hostId } = await addAgent();
    const res = await asAdmin('PATCH', `/api/hosts/${hostId}`, { socketPath: '/run/other.sock' });
    expect(res).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    expect(await asAdmin('PATCH', `/api/hosts/${hostId}`, { name: 'renamed' })).toMatchObject({ ok: true });
  });
});

describe('agent connection', () => {
  it('refuses an unknown secret before the upgrade', async () => {
    const ws = new WebSocket(`${base}/api/agents/connect`, { headers: { authorization: 'Bearer bvra_wrong' } });
    sockets.push(ws);
    const error = await new Promise<Error>((resolve) => ws.on('error', resolve));
    expect(error.message).toContain('401');
  });

  it('serves the remote fail2ban through the agent, read-only', async () => {
    const { hostId, secret } = await addAgent();
    const ban = vi.fn();
    runAgent(
      secret,
      fakeConnector({
        listJails: async () => [SSHD],
        jailConfigs: async () => [],
        ban,
        status: async () => ({ reachable: true, version: '1.1.0', error: null }),
      }),
    );
    await waitOnline(hostId);

    const { host } = await asAdmin('GET', `/api/hosts/${hostId}`);
    expect(host).toMatchObject({
      status: { reachable: true },
      agent: { online: true, version: '9.9.9', write: false },
    });
    const { jails } = await asAdmin('GET', `/api/hosts/${hostId}/jails`);
    expect(jails).toMatchObject([{ name: 'sshd', currentlyBanned: 1 }]);

    const refused = await asAdmin('POST', `/api/hosts/${hostId}/jails/sshd/ban`, { target: '198.51.100.1' });
    expect(refused).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(ban).not.toHaveBeenCalled();
  });

  it('turns an invalid answer into an error', async () => {
    const { hostId, secret } = await addAgent();
    runAgent(secret, fakeConnector({ listJails: async () => [{ name: 42 }] as never, jailConfigs: async () => [] }));
    await waitOnline(hostId);
    expect(await asAdmin('GET', `/api/hosts/${hostId}/jails`)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  });

  it('refuses bans whose address is not an address', async () => {
    const { hostId, secret } = await addAgent();
    const ban = { ip: '<b>@everyone</b>', jail: 'sshd', bannedAt: new Date().toISOString(), bantime: 600, failures: 3 };
    runAgent(secret, fakeConnector({ activeBans: async () => [ban], recentBans: async () => [ban] }));
    await waitOnline(hostId);
    expect(await asAdmin('GET', `/api/hosts/${hostId}/bans`)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  });

  it('cuts off the old connection when the agent enrols again', async () => {
    const { hostId, secret } = await addAgent();
    const ws = runAgent(secret, fakeConnector());
    await waitOnline(hostId);
    const closed = new Promise<number>((resolve) => ws.on('close', resolve));
    const { code } = await asAdmin('POST', `/api/agents/${hostId}/code`);
    await enroll(code);
    expect(await closed).toBe(4001);
    await vi.waitFor(() => expect(app.agents.online(hostId)).toBeNull());
  });

  it('forgets the agent with its instance', async () => {
    const { hostId, secret } = await addAgent();
    const ws = runAgent(secret, fakeConnector());
    await waitOnline(hostId);
    const closed = new Promise<number>((resolve) => ws.on('close', resolve));
    expect(await asAdmin('DELETE', `/api/hosts/${hostId}`)).toMatchObject({ ok: true });
    expect(await closed).toBe(4001);
    expect(app.db.select().from(agents).all()).toEqual([]);
  });
});

describe('agent side', () => {
  it('only answers the read methods, with checked parameters', async () => {
    const ban = vi.fn();
    const connector = fakeConnector({ ban, jail: async () => SSHD });
    const call = (method: string, params: unknown[]) =>
      answerCall(connector, JSON.stringify({ type: 'call', id: 1, method, params }));
    expect(await call('ban', ['sshd', '1.2.3.4'])).toBeNull();
    expect(ban).not.toHaveBeenCalled();
    expect(await call('jail', [42])).toMatchObject({ ok: false, code: 'VALIDATION' });
    // Never an option of fail2ban-client
    expect(await call('jail', ['--help'])).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await call('jail', ['sshd'])).toMatchObject({ ok: true, value: SSHD });
    expect(await answerCall(connector, 'not json')).toBeNull();
  });
});

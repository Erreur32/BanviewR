import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HostStatus } from '../../shared/hosts.ts';
import { auditLog } from '../db/schema.ts';
import { addUser, buildTestApp, fakeConnector, pw } from '../test-utils.ts';

const ORIGIN = { host: 'bvr.test', origin: 'http://bvr.test' };
const ADMIN = { username: 'admin', password: pw('hosts-admin') };
const SECOND = {
  name: 'second',
  socketPath: '/run/second.sock',
  dbPath: '/var/lib/second.sqlite3',
  confPath: '/etc/second',
};

let app: FastifyInstance;
let cookie: string;

async function start(deps = {}) {
  app = await buildTestApp(deps);
  const res = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: ORIGIN, payload: ADMIN });
  cookie = `bvr_session=${res.cookies.find((c) => c.name === 'bvr_session')?.value}`;
}

beforeEach(() => start());
afterEach(() => app.close());

const asAdmin = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { ...ORIGIN, cookie }, payload }).then((r) => r.json().result);

const createHost = async () => (await asAdmin('POST', '/api/hosts', SECOND)).host;

async function createToken(body: object) {
  return (await asAdmin('POST', '/api/tokens', { name: 'token', ...body })).secret as string;
}

const asToken = (secret: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${secret}` }, payload }).then((r) => r.json().result);

describe('instances', () => {
  it('lists the local instance with its status', async () => {
    const { hosts } = await asAdmin('GET', '/api/hosts');
    expect(hosts).toMatchObject([{ id: 1, name: 'local', mode: 'external', status: { reachable: true } }]);
  });

  it('reports an unreachable instance without failing the request', async () => {
    await app.close();
    const status: HostStatus = { reachable: false, version: null, error: 'UNREACHABLE' };
    await start({ connect: () => fakeConnector({ status: async () => status }) });
    const { hosts } = await asAdmin('GET', '/api/hosts');
    expect(hosts[0].status).toEqual(status);
  });

  it('creates, updates and removes an instance, with audit entries', async () => {
    const host = await createHost();
    expect(host).toMatchObject({ ...SECOND, mode: 'external' });

    const renamed = await asAdmin('PATCH', `/api/hosts/${host.id}`, { name: 'dedicated' });
    expect(renamed.host).toMatchObject({ name: 'dedicated', socketPath: SECOND.socketPath });

    expect((await asAdmin('DELETE', `/api/hosts/${host.id}`)).ok).toBe(true);
    expect((await asAdmin('GET', `/api/hosts/${host.id}`)).code).toBe('NOT_FOUND');

    const actions = app.db.select().from(auditLog).all();
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(['host.create', 'host.update', 'host.delete']));
  });

  it('refuses a name or socket already used', async () => {
    await createHost();
    const sameName = await asAdmin('POST', '/api/hosts', { ...SECOND, socketPath: '/run/other.sock' });
    expect(sameName.code).toBe('CONFLICT');
    const sameSocket = await asAdmin('POST', '/api/hosts', { ...SECOND, name: 'other' });
    expect(sameSocket.code).toBe('CONFLICT');
    const sameSocketOnPatch = await asAdmin('PATCH', '/api/hosts/1', { socketPath: SECOND.socketPath });
    expect(sameSocketOnPatch.code).toBe('CONFLICT');
    // Keeping its own values is not a conflict
    expect((await asAdmin('PATCH', '/api/hosts/1', { name: 'local' })).ok).toBe(true);
  });

  it('refuses relative paths and empty changes', async () => {
    const relative = await asAdmin('POST', '/api/hosts', { ...SECOND, socketPath: 'run/x.sock' });
    expect(relative.code).toBe('VALIDATION');
    const flagLike = await asAdmin('PATCH', '/api/hosts/1', { socketPath: '--help' });
    expect(flagLike.code).toBe('VALIDATION');
    expect((await asAdmin('PATCH', '/api/hosts/1', {})).code).toBe('VALIDATION');
  });

  it('keeps the last instance', async () => {
    expect((await asAdmin('DELETE', '/api/hosts/1')).code).toBe('CONFLICT');
  });
});

describe('instance access', () => {
  it('shows a limited token only its instances', async () => {
    const host = await createHost();
    const secret = await createToken({ scopes: ['read'], hostIds: [host.id] });

    const { hosts } = await asToken(secret, 'GET', '/api/hosts');
    expect(hosts.map((h: { id: number }) => h.id)).toEqual([host.id]);
    expect((await asToken(secret, 'GET', `/api/hosts/${host.id}`)).ok).toBe(true);
    expect((await asToken(secret, 'GET', '/api/hosts/1')).code).toBe('FORBIDDEN');
  });

  it('lets an unrestricted token read every instance', async () => {
    await createHost();
    const secret = await createToken({ scopes: ['read'] });
    expect((await asToken(secret, 'GET', '/api/hosts')).hosts).toHaveLength(2);
  });

  it('refuses writes from tokens, even admin ones', async () => {
    const secret = await createToken({ scopes: ['admin'] });
    expect((await asToken(secret, 'POST', '/api/hosts', SECOND)).code).toBe('FORBIDDEN');
    expect((await asToken(secret, 'PATCH', '/api/hosts/1', { socketPath: '/tmp/x' })).code).toBe('FORBIDDEN');
    expect((await asToken(secret, 'DELETE', '/api/hosts/1')).code).toBe('FORBIDDEN');
  });

  it('refuses writes from viewers', async () => {
    const headers = { ...ORIGIN, cookie: await addUser(app, cookie, 'viewer', 'viewer') };

    const list = await app.inject({ method: 'GET', url: '/api/hosts', headers });
    expect(list.json().result.hosts).toHaveLength(1);
    const create = await app.inject({ method: 'POST', url: '/api/hosts', headers, payload: SECOND });
    expect(create.json().result.code).toBe('FORBIDDEN');
  });

  it('needs authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/hosts' });
    expect(res.json().result.code).toBe('UNAUTHORIZED');
  });
});

describe('GET /api/health', () => {
  it('exposes the detection result', async () => {
    await app.close();
    await start({ detection: { mode: 'external', reason: 'service' } });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json().result.fail2ban).toEqual({ mode: 'external', reason: 'service' });
  });
});

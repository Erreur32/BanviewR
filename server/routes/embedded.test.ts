import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { auditLog, hosts } from '../db/schema.ts';
import { buildTestApp, fakeServer, fakeStock, pw } from '../test-utils.ts';

const ORIGIN = { host: 'bvr.test', origin: 'http://bvr.test' };
const ADMIN = { username: 'admin', password: pw('embedded-admin') };

let app: FastifyInstance;
let cookie: string;
let dir: string;

async function start(lock: { allowed: boolean; inContainer: boolean }) {
  dir = mkdtempSync(join(tmpdir(), 'bvr-emb-'));
  app = await buildTestApp({
    embedded: {
      ...lock,
      dataDir: join(dir, 'data'),
      detect: async () => ({ mode: 'none', reason: 'none' }),
      serverBin: fakeServer(dir),
      stockDir: fakeStock(dir),
    },
  });
  const res = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: ORIGIN, payload: ADMIN });
  cookie = `bvr_session=${res.cookies.find((c) => c.name === 'bvr_session')?.value}`;
}

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const asAdmin = (method: 'GET' | 'POST', url: string) =>
  app
    .inject({ method, url, headers: { ...ORIGIN, cookie }, payload: method === 'POST' ? {} : undefined })
    .then((r) => r.json().result);

describe('embedded routes', () => {
  it('starts and stops the embedded fail2ban, with its instance and audit entries', async () => {
    await start({ allowed: true, inContainer: true });
    expect((await asAdmin('GET', '/api/embedded')).embedded).toMatchObject({ running: false, blockedBy: null });

    const started = await asAdmin('POST', '/api/embedded/start');
    expect(started.embedded).toMatchObject({ running: true, enabled: true });
    const row = app.db
      .select()
      .from(hosts)
      .all()
      .find((h) => h.mode === 'embedded');
    expect(row).toMatchObject({ name: 'embedded', socketPath: app.embedded.paths.socketPath });
    expect(started.embedded.hostId).toBe(row?.id);

    // A second start reuses the same instance
    await asAdmin('POST', '/api/embedded/start');
    expect(app.db.select().from(hosts).all()).toHaveLength(2);

    const stopped = await asAdmin('POST', '/api/embedded/stop');
    expect(stopped.embedded).toMatchObject({ running: false, enabled: false });

    const actions = app.db
      .select()
      .from(auditLog)
      .all()
      .filter((a) => a.action.startsWith('embedded.'));
    expect(actions.map((a) => [a.action, a.ok])).toEqual([
      ['embedded.start', true],
      ['embedded.start', true],
      ['embedded.stop', true],
    ]);
  });

  it('refuses outside a container and audits the refusal', async () => {
    await start({ allowed: true, inContainer: false });
    expect((await asAdmin('GET', '/api/embedded')).embedded.blockedBy).toBe('NOT_CONTAINER');
    expect((await asAdmin('POST', '/api/embedded/start')).code).toBe('FORBIDDEN');
    expect(app.db.select().from(hosts).all()).toHaveLength(1);
    const [entry] = app.db
      .select()
      .from(auditLog)
      .all()
      .filter((a) => a.action === 'embedded.start');
    expect(entry?.ok).toBe(false);
  });

  it('is out of reach of API tokens, even admin ones', async () => {
    await start({ allowed: true, inContainer: true });
    const { secret } = await app
      .inject({
        method: 'POST',
        url: '/api/tokens',
        headers: { ...ORIGIN, cookie },
        payload: { name: 't', scopes: ['admin'] },
      })
      .then((r) => r.json().result);
    for (const [method, url] of [
      ['GET', '/api/embedded'],
      ['POST', '/api/embedded/start'],
    ] as const) {
      const res = await app.inject({ method, url, headers: { authorization: `Bearer ${secret}` }, payload: {} });
      expect(res.json().result.code).toBe('FORBIDDEN');
    }
    expect(app.embedded.status().running).toBe(false);
  });
});

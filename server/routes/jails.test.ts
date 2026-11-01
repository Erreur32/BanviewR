import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fail2banConnector } from '../connectors/connector.ts';
import { auditLog, banEvents } from '../db/schema.ts';
import { AppError } from '../errors.ts';
import { covers } from '../jailOps.ts';
import { buildTestApp, fakeConnector, pw } from '../test-utils.ts';

const ORIGIN = { host: 'bvr.test', origin: 'http://bvr.test' };
const ADMIN = { username: 'admin', password: pw('jails-admin') };

let app: FastifyInstance;
let cookie: string;

async function start(overrides: Partial<Fail2banConnector>) {
  app = await buildTestApp({ connect: () => fakeConnector(overrides) });
  const res = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: ORIGIN, payload: ADMIN });
  cookie = `bvr_session=${res.cookies.find((c) => c.name === 'bvr_session')?.value}`;
}
afterEach(() => app.close());

const post = (url: string, payload: object = {}) =>
  app.inject({ method: 'POST', url, headers: { ...ORIGIN, cookie }, payload }).then((r) => r.json().result);
const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } }).then((r) => r.json().result);

async function tokenFor(body: object) {
  return (await post('/api/tokens', { name: 'token', ...body })).secret as string;
}
const withToken = (secret: string, url: string, payload: object) =>
  app
    .inject({ method: 'POST', url, headers: { authorization: `Bearer ${secret}` }, payload })
    .then((r) => r.json().result);

const lastAudit = () => app.db.select().from(auditLog).all().at(-1);

describe('jails', () => {
  it('bans an address and audits it', async () => {
    const ban = vi.fn(async () => {});
    await start({ ban });
    expect((await post('/api/hosts/1/jails/sshd/ban', { target: '203.0.113.7' })).ok).toBe(true);
    expect(ban).toHaveBeenCalledWith('sshd', '203.0.113.7');
    expect(lastAudit()).toMatchObject({
      action: 'jail.ban',
      hostId: 1,
      target: '203.0.113.7',
      detail: 'sshd',
      ok: true,
    });
  });

  it('accepts IPv6 and networks, refuses anything else', async () => {
    const ban = vi.fn(async () => {});
    await start({ ban });
    expect((await post('/api/hosts/1/jails/sshd/ban', { target: '2001:db8::1' })).ok).toBe(true);
    expect((await post('/api/hosts/1/jails/sshd/ban', { target: '203.0.113.0/24' })).ok).toBe(true);
    for (const target of ['--help', 'example.com', '203.0.113.7; reboot', '', '0.0.0.0/0', '10.0.0.0/7', '::/0']) {
      expect((await post('/api/hosts/1/jails/sshd/ban', { target })).code).toBe('VALIDATION');
    }
    expect(ban).toHaveBeenCalledTimes(2);
  });

  it('can still lift a wide ban set outside BanviewR', async () => {
    const unban = vi.fn(async () => {});
    await start({ unban });
    expect((await post('/api/hosts/1/jails/sshd/unban', { target: '0.0.0.0/0' })).ok).toBe(true);
    expect((await post('/api/hosts/1/jails/sshd/unban', { target: '--help' })).code).toBe('VALIDATION');
    expect(unban).toHaveBeenCalledTimes(1);
  });

  it('refuses option-like jail names', async () => {
    const jail = vi.fn();
    await start({ jail });
    expect((await get('/api/hosts/1/jails/--help')).code).toBe('VALIDATION');
    expect(jail).not.toHaveBeenCalled();
  });

  it('audits a failed action and reports it', async () => {
    await start({
      unban: async () => {
        throw new AppError('UNAVAILABLE', 'fail2ban did not answer');
      },
    });
    expect((await post('/api/hosts/1/jails/sshd/unban', { target: '203.0.113.7' })).code).toBe('UNAVAILABLE');
    expect(lastAudit()).toMatchObject({ action: 'jail.unban', ok: false });
  });

  it('runs jail actions, unknown ones are refused', async () => {
    const jailAction = vi.fn(async () => {});
    await start({ jailAction });
    expect((await post('/api/hosts/1/jails/sshd/reload')).ok).toBe(true);
    expect(jailAction).toHaveBeenCalledWith('sshd', 'reload');
    expect(lastAudit()).toMatchObject({ action: 'jail.reload', target: 'sshd', ok: true });
    expect((await post('/api/hosts/1/jails/sshd/delete')).code).toBe('VALIDATION');
  });

  it('answers NOT_FOUND for an unknown instance', async () => {
    await start({ listJails: async () => [] });
    expect((await get('/api/hosts/99/jails')).code).toBe('NOT_FOUND');
  });
});

describe('jail list', () => {
  const config = (name: string, enabled: boolean) => ({
    name,
    enabled,
    filter: null,
    bantime: 600,
    findtime: null,
    maxretry: null,
  });
  const status = {
    currentlyFailed: 0,
    totalFailed: 0,
    currentlyBanned: 1,
    totalBanned: 1,
    bannedIps: [],
    fileList: '',
  };

  it('adds stopped jails from the config, not disabled ones', async () => {
    await start({
      listJails: async () => [{ name: 'sshd', ...status }],
      jailConfigs: async () => [config('sshd', true), config('nginx', true), config('old', false)],
    });
    const { jails } = await get('/api/hosts/1/jails');
    expect(jails.map((j: { name: string; running: boolean }) => [j.name, j.running])).toEqual([
      ['sshd', true],
      ['nginx', false],
    ]);
    expect(jails[0].config.bantime).toBe(600);
  });

  it('keeps a running jail the config does not describe', async () => {
    await start({ listJails: async () => [{ name: 'sshd', ...status }], jailConfigs: async () => [] });
    const { jails } = await get('/api/hosts/1/jails');
    expect(jails[0]).toMatchObject({ name: 'sshd', running: true, config: null });
  });
});

describe('own address', () => {
  it('refuses to ban the address of the caller, alone or in a network', async () => {
    const ban = vi.fn(async () => {});
    await start({ ban });
    const banFrom = (target: string) =>
      app
        .inject({
          method: 'POST',
          url: '/api/hosts/1/jails/sshd/ban',
          remoteAddress: '198.51.100.9',
          headers: { ...ORIGIN, cookie },
          payload: { target },
        })
        .then((r) => r.json().result);
    expect((await banFrom('198.51.100.9')).code).toBe('CONFLICT');
    expect((await banFrom('198.51.100.0/24')).code).toBe('CONFLICT');
    expect((await banFrom('198.51.101.0/24')).ok).toBe(true);
    expect(ban).toHaveBeenCalledTimes(1);
  });

  it('matches IPv6 and IPv4-mapped clients', () => {
    expect(covers('2001:db8::/32', '2001:db8::1')).toBe(true);
    expect(covers('203.0.113.0/24', '::ffff:203.0.113.5')).toBe(true);
    expect(covers('2001:db8::/32', '203.0.113.5')).toBe(false);
  });
});

describe('bans and stats', () => {
  it('picks active or recent bans', async () => {
    const activeBans = vi.fn(async () => []);
    const recentBans = vi.fn(async () => []);
    await start({ activeBans, recentBans });
    await get('/api/hosts/1/bans');
    expect(activeBans).toHaveBeenCalled();
    await get('/api/hosts/1/bans?active=false&limit=5');
    expect(recentBans).toHaveBeenCalledWith(5);
  });

  it('serves stats from the local history, without fail2ban', async () => {
    await start({});
    app.db
      .insert(banEvents)
      .values({ hostId: 1, jail: 'sshd', ip: '203.0.113.1', bannedAt: 1000, bantime: 600, failures: 3 })
      .run();
    expect((await get('/api/hosts/1/stats?days=0')).stats.totalBans).toBe(1);
    expect((await get('/api/hosts/99/stats')).code).toBe('NOT_FOUND');
  });

  it('bounds the stats period', async () => {
    await start({});
    expect((await get('/api/hosts/1/stats?days=-1')).code).toBe('VALIDATION');
  });
});

describe('access', () => {
  it('refuses a read token and a token of another instance', async () => {
    const ban = vi.fn(async () => {});
    await start({ ban });
    const payload = { target: '203.0.113.7' };
    const readOnly = await tokenFor({ scopes: ['read'] });
    expect((await withToken(readOnly, '/api/hosts/1/jails/sshd/ban', payload)).code).toBe('FORBIDDEN');

    const other = (
      await post('/api/hosts', { name: 'b', socketPath: '/run/b.sock', dbPath: '/var/b.db', confPath: '/etc/b' })
    ).host;
    const limited = await tokenFor({ scopes: ['write'], hostIds: [other.id] });
    expect((await withToken(limited, '/api/hosts/1/jails/sshd/ban', payload)).code).toBe('FORBIDDEN');
    expect((await withToken(limited, `/api/hosts/${other.id}/jails/sshd/ban`, payload)).ok).toBe(true);
    expect(ban).toHaveBeenCalledTimes(1);
  });
});

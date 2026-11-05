import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectLocalFail2ban } from './detect.ts';
import { parseDuration, readJailConfigs } from './jailConfig.ts';
import { localConnector, parseJailList, parseJailStatus } from './local.ts';
import { activeBans, bansSince, recentBans } from './sqliteReader.ts';

let dir: string;
let server: Server | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'banviewr-'));
});
afterEach(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(null)));
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function script(name: string, body: string) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function fakeProc(cmdlines: Record<string, string[]>) {
  const procDir = join(dir, 'proc');
  mkdirSync(procDir);
  for (const [pid, argv] of Object.entries(cmdlines)) {
    mkdirSync(join(procDir, pid));
    writeFileSync(join(procDir, pid, 'cmdline'), argv.join('\0'));
  }
  return procDir;
}

describe('localConnector', () => {
  it('passes the instance socket and reports the server version', async () => {
    const client = script('client', 'echo "$1 $2 $3" > "$(dirname "$0")/args"; echo 1.1.0');
    const status = await localConnector(
      { socketPath: '/run/custom.sock', dbPath: '/none', confPath: '/none' },
      client,
    ).status();
    expect(status).toEqual({ reachable: true, version: '1.1.0', error: null });
    expect(readFileSync(join(dir, 'args'), 'utf8').trim()).toBe('-s /run/custom.sock version');
  });

  it('reports an unreachable server', async () => {
    const client = script('client', 'echo "Failed to access socket path" >&2; exit 255');
    const status = await localConnector(
      { socketPath: '/run/custom.sock', dbPath: '/none', confPath: '/none' },
      client,
    ).status();
    expect(status).toEqual({ reachable: false, version: null, error: 'UNREACHABLE' });
  });

  it('reports a missing client', async () => {
    const status = await localConnector(
      { socketPath: '/run/custom.sock', dbPath: '/none', confPath: '/none' },
      join(dir, 'nope'),
    ).status();
    expect(status).toEqual({ reachable: false, version: null, error: 'CLIENT_MISSING' });
  });
});

describe('detectLocalFail2ban', () => {
  const noService = () => script('systemctl', 'echo not-found');

  it('finds a listening socket', async () => {
    const socket = join(dir, 'f2b.sock');
    server = createServer();
    await new Promise<void>((resolve) => server?.listen(socket, resolve));
    expect(await detectLocalFail2ban(socket, { procDir: fakeProc({}), systemctl: noService() })).toEqual({
      mode: 'external',
      reason: 'socket',
    });
  });

  it('ignores a file that does not listen', async () => {
    const stale = join(dir, 'stale.sock');
    writeFileSync(stale, '');
    expect(await detectLocalFail2ban(stale, { procDir: fakeProc({}), systemctl: noService() })).toEqual({
      mode: 'none',
      reason: 'none',
    });
  });

  it('finds the server process, directly or through python', async () => {
    const direct = fakeProc({ 12: ['/usr/bin/fail2ban-server', '-xf', 'start'] });
    expect(await detectLocalFail2ban(join(dir, 'x'), { procDir: direct, systemctl: noService() })).toMatchObject({
      reason: 'process',
    });
    rmSync(direct, { recursive: true });
    const python = fakeProc({ 12: ['/usr/bin/python3', '/usr/bin/fail2ban-server', '-xf', 'start'] });
    expect(await detectLocalFail2ban(join(dir, 'x'), { procDir: python, systemctl: noService() })).toMatchObject({
      reason: 'process',
    });
  });

  it('is not fooled by a command that only mentions the server', async () => {
    const procDir = fakeProc({ 12: ['grep', '-r', 'fail2ban-server'], self: ['fail2ban-server'] });
    expect(await detectLocalFail2ban(join(dir, 'x'), { procDir, systemctl: noService() })).toMatchObject({
      reason: 'none',
    });
  });

  it('does not count the embedded server it was told about', async () => {
    const procDir = fakeProc({ 12: ['/usr/bin/fail2ban-server', '-f', '-x'] });
    const opts = { procDir, systemctl: noService() };
    expect(await detectLocalFail2ban(join(dir, 'x'), { ...opts, ignorePids: [12] })).toMatchObject({ reason: 'none' });
    expect(await detectLocalFail2ban(join(dir, 'x'), { ...opts, ignorePids: [13] })).toMatchObject({
      reason: 'process',
    });
  });

  it('counts a stopped but installed service', async () => {
    const systemctl = script('systemctl', 'echo loaded');
    expect(await detectLocalFail2ban(join(dir, 'x'), { procDir: fakeProc({}), systemctl })).toEqual({
      mode: 'external',
      reason: 'service',
    });
  });

  it('survives a machine without systemd', async () => {
    const opts = { procDir: fakeProc({}), systemctl: join(dir, 'nope') };
    expect(await detectLocalFail2ban(join(dir, 'x'), opts)).toMatchObject({ reason: 'none' });
  });
});

describe('fail2ban-client output', () => {
  const output = [
    'Status for the jail: sshd',
    '|- Filter',
    '|  |- Currently failed:\t2',
    '|  |- Total failed:\t11',
    '|  `- File list:\t',
    '`- Actions',
    '   |- Currently banned:\t2',
    '   |- Total banned:\t5',
    '   `- Banned IP list:\t203.0.113.7 2001:db8::1',
  ].join('\n');

  it('reads a jail status', () => {
    expect(parseJailStatus('sshd', output)).toEqual({
      name: 'sshd',
      currentlyFailed: 2,
      totalFailed: 11,
      currentlyBanned: 2,
      totalBanned: 5,
      bannedIps: ['203.0.113.7', '2001:db8::1'],
      fileList: '',
    });
  });

  it('has no banned IP when the list is empty or missing', () => {
    expect(parseJailStatus('a', `   \`- Banned IP list:\t`).bannedIps).toEqual([]);
    expect(parseJailStatus('a', '').bannedIps).toEqual([]);
  });

  it('reads the jail list', () => {
    expect(parseJailList('Status\n|- Number of jail:\t2\n`- Jail list:\tsshd, nginx')).toEqual(['sshd', 'nginx']);
    expect(parseJailList('Status\n|- Number of jail:\t0\n`- Jail list:\t')).toEqual([]);
  });
});

describe('localConnector commands', () => {
  const connector = (body: string) =>
    localConnector(
      { socketPath: '/run/x.sock', dbPath: join(dir, 'none.sqlite3'), confPath: dir },
      script('client', body),
    );

  it('maps an unknown jail to NOT_FOUND', async () => {
    const jailError = `echo "Sorry but the jail 'x' does not exist"; echo "ERROR NOK: ('x',)" >&2; exit 255`;
    await expect(connector(jailError).jail('x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('starts a stopped jail with a full reload', async () => {
    const log = join(dir, 'calls');
    const host = connector(`echo "$3 $4" >> ${log}; echo "Status for the jail: x"`);
    await host.jailAction('x', 'start');
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    expect(calls.map((c) => c.trim())).toEqual(['reload', 'status x']);
  });

  it('reports a jail that a reload does not bring back', async () => {
    const body = `[ "$3" = reload ] && exit 0; echo "Sorry but the jail 'x' does not exist"; exit 255`;
    await expect(connector(body).jailAction('x', 'start')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('hides client errors behind UNAVAILABLE', async () => {
    const failing = 'echo "/secret/path: denied" >&2; exit 255';
    await expect(connector(failing).ban('x', '203.0.113.7')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: 'fail2ban did not answer',
    });
  });

  it('runs at most five clients at once', async () => {
    const log = join(dir, 'log');
    const body = `echo start >> ${log}; sleep 0.2; echo end >> ${log}; echo 1.1.0`;
    const host = connector(body);
    await Promise.all(Array.from({ length: 8 }, () => host.status()));
    let running = 0;
    let peak = 0;
    for (const line of readFileSync(log, 'utf8').trim().split('\n')) {
      running += line === 'start' ? 1 : -1;
      peak = Math.max(peak, running);
    }
    expect(peak).toBe(5);
  });
});

describe('fail2ban database', () => {
  const NOW = Math.floor(Date.now() / 1000);

  function fail2banDb() {
    const path = join(dir, 'f2b.sqlite3');
    const db = new Database(path);
    db.exec('CREATE TABLE bans (jail TEXT, ip TEXT, timeofban INTEGER, bantime INTEGER, bancount INTEGER, data JSON)');
    const insert = db.prepare('INSERT INTO bans VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('sshd', '203.0.113.1', NOW - 60, 600, 1, '{"failures": 7}');
    insert.run('sshd', '203.0.113.1', NOW - 86400 * 3, 600, 2, null);
    insert.run('nginx', '203.0.113.2', NOW - 86400 * 40, -1, 1, '{"failures": 3}');
    db.close();
    return path;
  }

  it('lists active bans, permanent ones included', () => {
    const bans = activeBans(fail2banDb());
    expect(bans.map((b) => [b.jail, b.failures])).toEqual([
      ['sshd', 7],
      ['nginx', 3],
    ]);
    expect(bans[0]?.bannedAt).toBe(new Date((NOW - 60) * 1000).toISOString());
  });

  it('lists recent bans with a limit', () => {
    expect(recentBans(fail2banDb(), 2)).toHaveLength(2);
  });

  it('reads bans oldest first, page by page', () => {
    const path = fail2banDb();
    expect(bansSince(path, 0, 2, 0).map((b) => b.jail)).toEqual(['nginx', 'sshd']);
    expect(bansSince(path, 0, 2, 2).map((b) => b.timeofban)).toEqual([NOW - 60]);
    expect(bansSince(path, NOW - 3600, 10, 0)).toHaveLength(1);
  });

  it('skips a ban without an address, it would block the sync', () => {
    const path = fail2banDb();
    const db = new Database(path);
    db.prepare('INSERT INTO bans VALUES (?, NULL, ?, 600, 1, NULL)').run('sshd', NOW);
    db.close();
    expect(bansSince(path, NOW - 3600, 10, 0)).toHaveLength(1);
  });

  it('reports an unreadable database instead of an empty list', () => {
    expect(() => activeBans(join(dir, 'none.sqlite3'))).toThrowError(expect.objectContaining({ code: 'UNAVAILABLE' }));
  });
});

describe('jail config', () => {
  function conf(files: Record<string, string>) {
    mkdirSync(join(dir, 'jail.d'));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return readJailConfigs(dir);
  }

  it('inherits defaults, in fail2ban override order', () => {
    const jails = conf({
      'jail.conf':
        '[DEFAULT]\nbantime = 10m\nmaxretry = 5\nenabled = false\n\n[sshd]\nport = ssh\n[nginx]\nfilter = web\n',
      'jail.d/a.conf': '[sshd]\nenabled = true\nbantime = 1h\n',
      'jail.local': '[sshd]\nmaxretry = 3\n',
      'jail.d/z.local': '[sshd]\nbantime = 1d\n',
    });
    expect(jails).toEqual([
      { name: 'sshd', enabled: true, filter: null, bantime: 86400, findtime: null, maxretry: 3 },
      { name: 'nginx', enabled: false, filter: 'web', bantime: 600, findtime: null, maxretry: 5 },
    ]);
  });

  it('leaves out reserved sections and treats a missing enabled as off', () => {
    const jails = conf({
      'jail.conf': '[INCLUDES]\nbefore = paths.conf\n[DEFAULT]\nmaxretry = 2\n[sshd]\nport = 22\n',
    });
    expect(jails).toMatchObject([{ name: 'sshd', enabled: false, maxretry: 2 }]);
  });

  it('keeps the case of jail names, handles comments and continuation lines', () => {
    const text = '# top\n[MyJail]\nenabled = true ; on\nfilter = %(__name__)s\nignoreip = 1.1.1.1\n  2.2.2.2\n';
    expect(conf({ 'jail.conf': text })).toMatchObject([{ name: 'MyJail', enabled: true, filter: 'MyJail' }]);
  });

  it('survives a missing directory', () => {
    expect(readJailConfigs(join(dir, 'nope'))).toEqual([]);
  });

  it('reads durations', () => {
    expect(['600', '10m', '1.5h', '-1', '1h30m', undefined].map(parseDuration)).toEqual([
      600,
      600,
      5400,
      -1,
      null,
      null,
    ]);
  });
});

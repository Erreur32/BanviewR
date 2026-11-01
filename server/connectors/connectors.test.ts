import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectLocalFail2ban } from './detect.ts';
import { localConnector } from './local.ts';

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
    const status = await localConnector({ socketPath: '/run/custom.sock' }, client).status();
    expect(status).toEqual({ reachable: true, version: '1.1.0', error: null });
    expect(readFileSync(join(dir, 'args'), 'utf8').trim()).toBe('-s /run/custom.sock version');
  });

  it('reports an unreachable server', async () => {
    const client = script('client', 'echo "Failed to access socket path" >&2; exit 255');
    const status = await localConnector({ socketPath: '/run/custom.sock' }, client).status();
    expect(status).toEqual({ reachable: false, version: null, error: 'UNREACHABLE' });
  });

  it('reports a missing client', async () => {
    const status = await localConnector({ socketPath: '/run/custom.sock' }, join(dir, 'nope')).status();
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

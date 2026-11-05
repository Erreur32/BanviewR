import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LocalDetection } from '../shared/hosts.ts';
import {
  BASE_IGNOREIP,
  createEmbedded,
  dockerNetworks,
  type EmbeddedOptions,
  embeddedBlock,
  embeddedPaths,
  keepIgnoreip,
  parseIgnoreList,
  pickFirewall,
  writeBaseConfig,
} from './embedded.ts';
import { fakeServer, fakeStock } from './test-utils.ts';

const NONE: LocalDetection = { mode: 'none', reason: 'none' };
const HOST: LocalDetection = { mode: 'external', reason: 'process' };
const quiet = { info: () => undefined, warn: () => undefined };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bvr-emb-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('embeddedBlock', () => {
  const open = { inContainer: true, allowed: true, detection: NONE };

  it('only lets it start in a container, when allowed, without a host fail2ban', () => {
    expect(embeddedBlock(open)).toBeNull();
    expect(embeddedBlock({ ...open, inContainer: false })).toBe('NOT_CONTAINER');
    expect(embeddedBlock({ ...open, allowed: false })).toBe('NOT_ALLOWED');
    expect(embeddedBlock({ ...open, detection: HOST })).toBe('HOST_FAIL2BAN');
  });

  it('names the container lock first, it is the one the operator cannot get around', () => {
    expect(embeddedBlock({ inContainer: false, allowed: false, detection: HOST })).toBe('NOT_CONTAINER');
    expect(embeddedBlock({ inContainer: true, allowed: false, detection: HOST })).toBe('NOT_ALLOWED');
  });
});

describe('dockerNetworks', () => {
  it('gives the networks of the Docker bridges only', () => {
    const iface = (address: string, cidr: string, family: 'IPv4' | 'IPv6' = 'IPv4') => ({
      address,
      cidr,
      family,
      netmask: '',
      mac: '',
      internal: false,
    });
    const nets = dockerNetworks({
      docker0: [iface('172.17.0.1', '172.17.0.1/16'), iface('fd00::1', 'fd00::1/64', 'IPv6')],
      'br-0a1b2c3d4e5f': [iface('203.0.113.129', '203.0.113.129/25')],
      eth0: [iface('192.168.32.202', '192.168.32.202/24')],
    } as never);
    expect(nets).toEqual(['172.17.0.0/16', '203.0.113.128/25']);
  });
});

describe('writeBaseConfig', () => {
  it('links the stock files, leaves out jail.d, and always ignores the private ranges', () => {
    const stock = fakeStock(dir);
    const paths = embeddedPaths(join(dir, 'data'));
    writeBaseConfig(paths, { stockDir: stock, ignoreip: [...BASE_IGNOREIP, '203.0.113.128/25'] });

    expect(lstatSync(join(paths.confDir, 'jail.conf')).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(paths.confDir, 'filter.d')).isSymbolicLink()).toBe(true);
    // Debian's sshd default and the stock .local files are not taken
    expect(existsSync(join(paths.confDir, 'jail.d', 'defaults-debian.conf'))).toBe(false);
    expect(lstatSync(join(paths.confDir, 'jail.d')).isDirectory()).toBe(true);
    expect(existsSync(join(paths.confDir, 'jail.local'))).toBe(false);

    const main = readFileSync(join(paths.confDir, 'fail2ban.local'), 'utf8');
    expect(main).toContain(`socket = ${paths.socketPath}`);
    expect(main).toContain(`dbfile = ${paths.dbPath}`);
    const base = readFileSync(join(paths.confDir, 'jail.d', '00-banviewr.local'), 'utf8');
    const ignoreip = base.match(/^ignoreip = (.*)$/m)?.[1]?.split(' ');
    expect(ignoreip).toEqual(expect.arrayContaining(['127.0.0.0/8', '::1', '10.0.0.0/8', '172.16.0.0/12']));
    expect(ignoreip).toEqual(expect.arrayContaining(['192.168.0.0/16', '203.0.113.128/25']));
  });

  it('runs again without harm and keeps a file the admin put in place of a link', () => {
    const stock = fakeStock(dir);
    const paths = embeddedPaths(join(dir, 'data'));
    writeBaseConfig(paths, { stockDir: stock, ignoreip: BASE_IGNOREIP });
    rmSync(join(paths.confDir, 'jail.conf'));
    writeFileSync(join(paths.confDir, 'jail.conf'), '# mine\n');
    writeFileSync(join(paths.confDir, 'jail.d', 'mine.local'), '[x]\n');
    writeBaseConfig(paths, { stockDir: stock, ignoreip: BASE_IGNOREIP });
    expect(readFileSync(join(paths.confDir, 'jail.conf'), 'utf8')).toBe('# mine\n');
    expect(existsSync(join(paths.confDir, 'jail.d', 'mine.local'))).toBe(true);
  });

  it('writes the backend and the DOCKER-USER action in a .conf the admin can override', () => {
    const paths = embeddedPaths(join(dir, 'data'));
    const conf = () => readFileSync(join(paths.confDir, 'jail.d', '00-banviewr.conf'), 'utf8');
    writeBaseConfig(paths, { stockDir: fakeStock(dir), ignoreip: BASE_IGNOREIP });
    expect(conf()).not.toContain('action');

    writeBaseConfig(paths, {
      stockDir: fakeStock(dir),
      ignoreip: BASE_IGNOREIP,
      firewall: { backend: 'iptables-nft', dockerUser: true },
    });
    expect(conf()).toContain('chain="DOCKER-USER"');
    expect(conf()).toMatch(/^action = %\(action_\)s\n\s+%\(action_docker\)s$/m);
    expect(conf()).not.toContain('banaction');

    writeBaseConfig(paths, {
      stockDir: fakeStock(dir),
      ignoreip: BASE_IGNOREIP,
      firewall: { backend: 'nftables', dockerUser: false },
    });
    expect(conf()).toContain('banaction = nftables\n');
    expect(conf()).not.toContain('DOCKER-USER');
  });

  it('escapes % for fail2ban interpolation', () => {
    const paths = embeddedPaths(join(dir, '100%'));
    writeBaseConfig(paths, { stockDir: fakeStock(dir), ignoreip: BASE_IGNOREIP });
    expect(readFileSync(join(paths.confDir, 'fail2ban.local'), 'utf8')).toContain('100%%');
  });
});

describe('pickFirewall', () => {
  const docker = '*filter\n:INPUT ACCEPT [0:0]\n:DOCKER-USER - [0:0]\n-A FORWARD -j DOCKER-USER\nCOMMIT\n';
  const emptyNft = '*filter\n:INPUT ACCEPT [0:0]\nCOMMIT\n';

  it("follows Docker's iptables backend and finds DOCKER-USER", () => {
    expect(pickFirewall({ legacy: null, nft: docker, nftTables: 'table ip filter\n' })).toEqual({
      backend: 'iptables-nft',
      dockerUser: true,
    });
    expect(pickFirewall({ legacy: docker, nft: emptyNft, nftTables: 'table ip filter\n' })).toEqual({
      backend: 'iptables-legacy',
      dockerUser: true,
    });
  });

  it('keeps a legacy firewall with rules, else nftables when only nft tables exist', () => {
    const legacy = '*filter\n:INPUT ACCEPT [0:0]\n-A INPUT -p tcp --dport 22 -j ACCEPT\nCOMMIT\n';
    expect(pickFirewall({ legacy, nft: null, nftTables: '' }).backend).toBe('iptables-legacy');
    expect(pickFirewall({ legacy: null, nft: '', nftTables: 'table inet filter\n' }).backend).toBe('nftables');
    expect(pickFirewall({ legacy: null, nft: emptyNft, nftTables: 'table ip filter\n' }).backend).toBe('iptables-nft');
    // Nothing anywhere: the stock iptables actions
    expect(pickFirewall({ legacy: null, nft: null, nftTables: null })).toEqual({
      backend: 'iptables-nft',
      dockerUser: false,
    });
  });
});

describe('ignoreip of jails', () => {
  it('reads the list fail2ban prints', () => {
    const out = 'These IP addresses/networks are ignored:\n|- 127.0.0.0/8\n|- ::1\n`- 203.0.113.7\n';
    expect(parseIgnoreList(out)).toEqual(['127.0.0.0/8', '::1', '203.0.113.7']);
    expect(parseIgnoreList('No IP address/network is ignored\n')).toEqual([]);
  });

  it('adds the base ranges back to a jail that set its own list, and only to it', async () => {
    const calls: string[] = [];
    const client = async (args: string[]) => {
      calls.push(args.join(' '));
      if (args[0] === 'status') return 'Status\n|- Number of jail:\t2\n`- Jail list:\tsshd, own\n';
      if (args[2] === 'ignoreip' && args[1] === 'own')
        return 'These IP addresses/networks are ignored:\n`- 198.51.100.9\n';
      if (args[2] === 'ignoreip')
        return `These IP addresses/networks are ignored:\n${BASE_IGNOREIP.map((ip) => `|- ${ip}`).join('\n')}\n`;
      return '';
    };
    const added = await keepIgnoreip(client, BASE_IGNOREIP);
    expect(added).toEqual(BASE_IGNOREIP.map((ip) => `own ${ip}`));
    expect(calls.filter((c) => c.startsWith('set'))).toEqual(BASE_IGNOREIP.map((ip) => `set own addignoreip ${ip}`));
  });
});

describe('embedded supervisor', () => {
  let enabled: boolean;
  let detections: number[][];

  function supervisor(over: Partial<EmbeddedOptions> = {}, hostFound = () => false) {
    detections = [];
    return createEmbedded({
      dataDir: join(dir, 'data'),
      allowed: true,
      inContainer: true,
      detect: async (ignorePids) => {
        detections.push(ignorePids);
        return hostFound() ? HOST : NONE;
      },
      serverBin: fakeServer(dir),
      stockDir: fakeStock(dir),
      readyTimeoutMs: 5000,
      client: async () => '',
      onHostStop: (d) => stops.push(d),
      detection: NONE,
      store: {
        enabled: () => enabled,
        setEnabled: (on) => {
          enabled = on;
        },
      },
      log: quiet,
      ...over,
    });
  }

  let stops: LocalDetection[];
  beforeEach(() => {
    enabled = false;
    stops = [];
  });

  it('refuses to start outside a container, without EMBEDDED_ALLOWED or next to a host fail2ban', async () => {
    await expect(supervisor({ inContainer: false }).start()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(supervisor({ allowed: false }).start()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(supervisor({}, () => true).start()).rejects.toMatchObject({ code: 'CONFLICT' });
    // Nothing was run, nothing was written
    expect(existsSync(join(dir, 'args'))).toBe(false);
    expect(existsSync(join(dir, 'data'))).toBe(false);
    expect(enabled).toBe(false);
  });

  it('starts the server on its own config and socket, then stops it', async () => {
    const embedded = supervisor();
    await embedded.start();
    const { confDir, socketPath, pidFile } = embedded.paths;
    expect(readFileSync(join(dir, 'args'), 'utf8')).toBe(`-f -x -c ${confDir} -s ${socketPath} -p ${pidFile}`);
    expect(embedded.status()).toMatchObject({ running: true, enabled: true, blockedBy: null, stopReason: null });

    await embedded.stop();
    expect(embedded.status()).toMatchObject({ running: false, enabled: false, pid: null, stopReason: null });
  });

  it('stays enabled when it stops with the container, and resumes', async () => {
    const embedded = supervisor();
    await embedded.start();
    await embedded.stop(true);
    expect(enabled).toBe(true);
    await embedded.resume();
    expect(embedded.status().running).toBe(true);
    await embedded.stop();
  });

  it('reports a server that exits on start', async () => {
    const bad = join(dir, 'bad-server');
    writeFileSync(bad, '#!/bin/sh\necho "ERROR  No file(s) found for glob" >&2\nexit 255\n');
    chmodSync(bad, 0o755);
    const embedded = supervisor({ serverBin: bad });
    await expect(embedded.start()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(embedded.status()).toMatchObject({ running: false, enabled: false, stopReason: 'EXITED' });
    expect(embedded.status().lastError).toContain('No file(s) found');
  });

  it('stops for good when a host fail2ban shows up', async () => {
    let host = false;
    const embedded = supervisor({}, () => host);
    await embedded.start();
    const { pid } = embedded.status();
    await embedded.check();
    // Its own server is left out of the process check
    expect(detections.at(-1)).toEqual([pid]);
    expect(embedded.status().running).toBe(true);

    host = true;
    await embedded.check();
    expect(embedded.status()).toMatchObject({
      running: false,
      enabled: false,
      stopReason: 'HOST_FAIL2BAN',
      blockedBy: 'HOST_FAIL2BAN',
    });
    expect(stops).toEqual([HOST]);
    // Told once, not on every later check
    await embedded.check();
    expect(stops).toHaveLength(1);
  });

  it('shows the firewall it found and gives the server legacy iptables first in its PATH', async () => {
    const embedded = supervisor({ firewall: async () => ({ backend: 'iptables-legacy', dockerUser: true }) });
    expect(embedded.status().firewall).toBeNull();
    await embedded.start();
    expect(embedded.status().firewall).toEqual({ backend: 'iptables-legacy', dockerUser: true });
    expect(readlinkSync(join(embedded.paths.binDir, 'iptables'))).toBe('/usr/sbin/iptables-legacy');
    await embedded.stop();
  });

  it('does not resume next to a host fail2ban, and stays off', async () => {
    enabled = true;
    const embedded = supervisor({}, () => true);
    await embedded.resume();
    expect(embedded.status()).toMatchObject({ running: false, enabled: false, stopReason: 'HOST_FAIL2BAN' });
  });
});

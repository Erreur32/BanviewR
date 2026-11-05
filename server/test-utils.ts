import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AppDeps, buildApp } from './app.ts';
import type { Fail2banConnector } from './connectors/connector.ts';
import { openDb } from './db/index.ts';
import { openGeoIp } from './geoip.ts';

export const testLocalHost = { socketPath: '/tmp/f2b.sock', dbPath: '/tmp/f2b.sqlite3', confPath: '/tmp/f2b' };

export function openTestDb() {
  return openDb(':memory:', testLocalHost);
}

// Each test overrides what it needs, an unexpected call fails loudly
export const fakeConnector = (overrides: Partial<Fail2banConnector> = {}): Fail2banConnector => {
  const unexpected = async () => {
    throw new Error('Unexpected connector call');
  };
  return {
    status: async () => ({ reachable: true, version: '1.1.0', error: null }),
    listJails: unexpected,
    jail: unexpected,
    jailConfigs: unexpected,
    ban: unexpected,
    unban: unexpected,
    jailAction: unexpected,
    activeBans: unexpected,
    recentBans: unexpected,
    bansSince: unexpected,
    jailActions: unexpected,
    actionProperty: unexpected,
    firewall: unexpected,
    loadBlocklist: unexpected,
    dropBlocklist: unexpected,
    ...overrides,
  };
};

const testDeps: AppDeps = {
  connect: () => fakeConnector(),
  detection: { mode: 'none', reason: 'none' },
  // Locked: tests that start it pass their own options
  embedded: {
    dataDir: '/nonexistent-bvr-test',
    allowed: false,
    inContainer: false,
    detect: async () => ({ mode: 'none', reason: 'none' }),
  },
  mcpWrite: false,
  geo: openGeoIp(null),
};

export function buildTestApp(deps: Partial<AppDeps> = {}) {
  return buildApp(openTestDb(), { ...testDeps, ...deps });
}

// Test password fixtures, built at runtime so they never look like stored credentials
export const pw = (label: string) => `${label}-fixture`;

// The stock /etc/fail2ban of the image, reduced to what the generator looks at
export function fakeStock(root: string) {
  const stock = join(root, 'stock');
  mkdirSync(join(stock, 'filter.d'), { recursive: true });
  mkdirSync(join(stock, 'jail.d'), { recursive: true });
  writeFileSync(join(stock, 'jail.conf'), '[DEFAULT]\nbantime = 10m\n');
  writeFileSync(join(stock, 'fail2ban.conf'), '[Definition]\n');
  writeFileSync(join(stock, 'jail.d', 'defaults-debian.conf'), '[sshd]\nenabled = true\n');
  writeFileSync(join(stock, 'jail.local'), '[DEFAULT]\n');
  return stock;
}

// Stands in for fail2ban-server: listens on the -s socket until SIGTERM, records its arguments
export function fakeServer(root: string) {
  const path = join(root, 'fake-server.cjs');
  writeFileSync(
    path,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
require('node:fs').writeFileSync(require('node:path').join(__dirname, 'args'), args.join(' '));
const server = require('node:net').createServer().listen(args[args.indexOf('-s') + 1]);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`,
  );
  chmodSync(path, 0o755);
  return path;
}

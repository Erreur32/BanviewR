import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { JailStatus } from '../../shared/fail2ban.ts';
import { AppError } from '../errors.ts';
import type { Fail2banConnector } from './connector.ts';
import { readJailConfigs } from './jailConfig.ts';
import { activeBans, banStats, recentBans } from './sqliteReader.ts';

const run = promisify(execFile);
const TIMEOUT_MS = 10_000;
// A jail fed by a blocklist can list tens of thousands of addresses
const MAX_OUTPUT = 16 * 1024 * 1024;

// Each client is a Python process and the socket serves them one at a time
const MAX_CLIENTS = 5;
let clients = 0;
const waiting: (() => void)[] = [];

async function limited<T>(task: () => Promise<T>) {
  if (clients < MAX_CLIENTS) clients++;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await task();
  } finally {
    // A waiting task inherits the slot
    const next = waiting.shift();
    if (next) next();
    else clients--;
  }
}

export function parseJailList(output: string) {
  const list = output.match(/Jail list:[ \t]*(.*)/)?.[1] ?? '';
  return list
    .split(',')
    .map((j) => j.trim())
    .filter(Boolean);
}

export function parseJailStatus(name: string, output: string): JailStatus {
  // [ \t], not \s: on an empty value \s would run on into the next line
  const text = (label: string) => output.match(new RegExp(`${label}:[ \\t]*(.*)`))?.[1]?.trim() ?? '';
  const count = (label: string) => Number.parseInt(text(label), 10) || 0;
  return {
    name,
    currentlyFailed: count('Currently failed'),
    totalFailed: count('Total failed'),
    currentlyBanned: count('Currently banned'),
    totalBanned: count('Total banned'),
    bannedIps: text('Banned IP list').split(/\s+/).filter(Boolean),
    fileList: text('File list'),
  };
}

// Talks to a fail2ban on this machine through its own client, its instance socket and its database
export function localConnector(
  host: { socketPath: string; dbPath: string; confPath: string },
  client = 'fail2ban-client',
): Fail2banConnector {
  const exec = (args: string[]) =>
    limited(() => run(client, ['-s', host.socketPath, ...args], { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT }));

  // The client's error text stays out of the response, it can hold server paths
  async function command(args: string[]) {
    try {
      const { stdout } = await exec(args);
      return stdout.trim();
    } catch (err) {
      // Printed on stdout, the exit code is the generic 255
      if (String((err as { stdout?: string }).stdout).includes('does not exist')) {
        throw new AppError('NOT_FOUND', 'Jail not found');
      }
      throw new AppError('UNAVAILABLE', 'fail2ban did not answer');
    }
  }

  const jail = async (name: string) => parseJailStatus(name, await command(['status', name]));

  return {
    async status() {
      try {
        const { stdout } = await exec(['version']);
        return { reachable: true, version: stdout.trim(), error: null };
      } catch (err) {
        const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
        return { reachable: false, version: null, error: missing ? 'CLIENT_MISSING' : 'UNREACHABLE' };
      }
    },
    jail,
    jailConfigs: async () => readJailConfigs(host.confPath),
    listJails: async () => Promise.all(parseJailList(await command(['status'])).map(jail)),
    ban: async (name, target) => void (await command(['set', name, 'banip', target])),
    unban: async (name, target) => void (await command(['set', name, 'unbanip', target])),
    async jailAction(name, action) {
      if (action !== 'start') {
        await command([action, name]);
        return;
      }
      // A stopped jail is gone from the server: `start <jail>` and `reload <jail>` both
      // answer "does not exist", only a full reload brings it back from the config
      await command(['reload']);
      await jail(name);
    },
    activeBans: async () => activeBans(host.dbPath),
    recentBans: async (limit) => recentBans(host.dbPath, limit),
    stats: async (days) => banStats(host.dbPath, days),
  };
}

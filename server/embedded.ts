import { type ChildProcess, spawn } from 'node:child_process';
import { lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { EmbeddedBlock, EmbeddedStatus, LocalDetection } from '../shared/hosts.ts';
import { socketListens } from './connectors/detect.ts';
import type { Db } from './db/index.ts';
import { settings } from './db/schema.ts';
import { AppError } from './errors.ts';

// Never banned, whatever the jails say: loopback, private and link-local ranges, CGNAT (Tailscale).
// Banning one of them could lock the admin out of the machine.
export const BASE_IGNOREIP = [
  '127.0.0.0/8',
  '::1',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '100.64.0.0/10',
  'fc00::/7',
  'fe80::/10',
];

// Linux socket paths hold 107 bytes
const MAX_SOCKET_PATH = 107;

// Isolation level 2: the embedded fail2ban changes the firewall of whatever network namespace it runs in,
// so it only starts in a container, when the operator allowed it, and never next to a host fail2ban
export function embeddedBlock(lock: {
  inContainer: boolean;
  allowed: boolean;
  detection: LocalDetection;
}): EmbeddedBlock | null {
  if (!lock.inContainer) return 'NOT_CONTAINER';
  if (!lock.allowed) return 'NOT_ALLOWED';
  if (lock.detection.mode === 'external') return 'HOST_FAIL2BAN';
  return null;
}

const toInt = (ip: string) => ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
const toIp = (n: number) => [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.');

// IPv4 networks of the Docker bridges seen here (docker0, br-*): an address pool can be set outside
// the private ranges. shortcut: IPv6 bridges rely on fc00::/7, add them if a global IPv6 pool shows up
export function dockerNetworks(ifaces = networkInterfaces()) {
  const nets = new Set<string>();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!/^(docker\d+|br-[0-9a-f]+)$/.test(name)) continue;
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || !addr.cidr) continue;
      const bits = Number(addr.cidr.split('/')[1]);
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      nets.add(`${toIp((toInt(addr.address) & mask) >>> 0)}/${bits}`);
    }
  }
  return [...nets];
}

export function embeddedPaths(dataDir: string) {
  const root = join(resolve(dataDir), 'fail2ban');
  return {
    confDir: join(root, 'etc'),
    socketPath: join(root, 'fail2ban.sock'),
    pidFile: join(root, 'fail2ban.pid'),
    dbPath: join(root, 'fail2ban.sqlite3'),
    logPath: join(root, 'fail2ban.log'),
  };
}
type Paths = ReturnType<typeof embeddedPaths>;

// fail2ban interpolates %(name)s in values: a literal % is written %%
function iniValue(value: string) {
  if (/[\r\n]/.test(value)) throw new AppError('BAD_REQUEST', 'Line break in an embedded fail2ban path');
  return value.replaceAll('%', '%%');
}

const HEADER = `# Written by BanviewR at every start of the embedded fail2ban: changes here are lost.
# Put your own jails in other *.local files of jail.d/.
`;

// Stock files (jail.conf, filter.d, action.d, paths-*.conf) are linked from the image, so they follow
// its upgrades. jail.d and fail2ban.d are not: Debian's defaults-debian.conf enables sshd on the journal,
// which a container does not have, and a jail that cannot start stops the whole server.
export function writeBaseConfig(paths: Paths, { stockDir, ignoreip }: { stockDir: string; ignoreip: string[] }) {
  mkdirSync(join(paths.confDir, 'jail.d'), { recursive: true });
  for (const entry of readdirSync(stockDir)) {
    if (entry === 'jail.d' || entry === 'fail2ban.d' || entry.endsWith('.local')) continue;
    const link = join(paths.confDir, entry);
    const target = join(stockDir, entry);
    const existing = lstatSync(link, { throwIfNoEntry: false });
    // A real file the admin put there wins over the stock one
    if (existing && !existing.isSymbolicLink()) continue;
    if (existing && readlinkSync(link) === target) continue;
    if (existing) rmSync(link);
    symlinkSync(target, link);
  }
  writeFileSync(
    join(paths.confDir, 'fail2ban.local'),
    `${HEADER}
[Definition]
logtarget = ${iniValue(paths.logPath)}
socket = ${iniValue(paths.socketPath)}
pidfile = ${iniValue(paths.pidFile)}
dbfile = ${iniValue(paths.dbPath)}
`,
  );
  // In jail.d with a 00 prefix: read after jail.conf and jail.local, so their [DEFAULT] cannot drop it.
  // shortcut: a jail that sets its own ignoreip still replaces this list, check jails on start in the next slice
  writeFileSync(
    join(paths.confDir, 'jail.d', '00-banviewr.local'),
    `${HEADER}
[DEFAULT]
ignoreself = true
ignoreip = ${ignoreip.map(iniValue).join(' ')}
`,
  );
}

type Store = { enabled(): boolean; setEnabled(on: boolean): void };

const ENABLED_KEY = 'embedded.enabled';

export const settingsStore = (db: Db): Store => ({
  enabled: () => db.select().from(settings).where(eq(settings.key, ENABLED_KEY)).get()?.value === true,
  setEnabled: (on) =>
    void db
      .insert(settings)
      .values({ key: ENABLED_KEY, value: on })
      .onConflictDoUpdate({ target: settings.key, set: { value: on } })
      .run(),
});

export type EmbeddedOptions = {
  dataDir: string;
  allowed: boolean;
  inContainer: boolean;
  // Fresh host fail2ban detection, leaving out the given processes (the embedded server itself)
  detect: (ignorePids: number[]) => Promise<LocalDetection>;
  serverBin?: string;
  stockDir?: string;
  readyTimeoutMs?: number;
};

type Run = { proc: ChildProcess; startedAt: Date; ended: Promise<string>; stopping: boolean };

// Runs fail2ban-server as a child process, started from the UI only, never on its own the first time.
// Once started it comes back with the container (resume), until stopped from the UI.
export function createEmbedded(
  opts: EmbeddedOptions & { detection: LocalDetection; store: Store; log: Pick<FastifyBaseLogger, 'info' | 'warn'> },
) {
  const { store, log, serverBin = 'fail2ban-server', stockDir = '/etc/fail2ban', readyTimeoutMs = 20_000 } = opts;
  const paths = embeddedPaths(opts.dataDir);
  let detection = opts.detection;
  let current: Run | null = null;
  let stopReason: EmbeddedStatus['stopReason'] = null;
  let lastError: string | null = null;

  const blockedBy = () => embeddedBlock({ inContainer: opts.inContainer, allowed: opts.allowed, detection });

  // Start and stop never overlap: a second click waits for the first to finish
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>) => {
    const next = queue.then(task);
    queue = next.catch(() => undefined);
    return next;
  };

  async function halt() {
    const run = current;
    if (!run) return;
    run.stopping = true;
    run.proc.kill('SIGTERM');
    // fail2ban removes its firewall rules on the way out, which can take a while with many bans
    const force = setTimeout(() => run.proc.kill('SIGKILL'), 30_000);
    await run.ended;
    clearTimeout(force);
  }

  async function launch() {
    if (current) return;
    detection = await opts.detect([]);
    const block = blockedBy();
    if (block) {
      throw new AppError(block === 'HOST_FAIL2BAN' ? 'CONFLICT' : 'FORBIDDEN', `Embedded fail2ban blocked: ${block}`);
    }
    if (Buffer.byteLength(paths.socketPath) > MAX_SOCKET_PATH) {
      throw new AppError('BAD_REQUEST', 'DATA_DIR is too long for the embedded fail2ban socket path');
    }
    writeBaseConfig(paths, { stockDir, ignoreip: [...BASE_IGNOREIP, ...dockerNetworks()] });
    stopReason = null;
    lastError = null;

    // Fixed arguments, no shell. spawn and not execFile: the server runs for good, execFile would buffer
    // its output and kill it past maxBuffer. -x removes a socket left by a crash.
    const proc = spawn(serverBin, ['-f', '-x', '-c', paths.confDir, '-s', paths.socketPath, '-p', paths.pidFile], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    proc.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    const ended = new Promise<string>((done) => {
      proc.once('error', (err: NodeJS.ErrnoException) =>
        done(err.code === 'ENOENT' ? `${serverBin} not found` : err.message),
      );
      proc.once('exit', (code, signal) => done(stderr.trim().slice(-500) || `exited with ${signal ?? code}`));
    });
    const run: Run = { proc, startedAt: new Date(), ended, stopping: false };
    current = run;
    void ended.then((detail) => {
      if (current !== run) return;
      current = null;
      if (run.stopping) return;
      stopReason = 'EXITED';
      lastError = detail;
      log.warn({ detail }, 'Embedded fail2ban exited');
    });

    const deadline = Date.now() + readyTimeoutMs;
    while (!(await socketListens(paths.socketPath))) {
      if (current !== run) throw new AppError('UNAVAILABLE', `fail2ban-server stopped: ${lastError}`);
      if (Date.now() > deadline) {
        await halt();
        throw new AppError('UNAVAILABLE', 'fail2ban-server did not open its socket in time');
      }
      await sleep(250);
    }
    store.setEnabled(true);
    log.info({ pid: proc.pid, confDir: paths.confDir }, 'Embedded fail2ban started');
  }

  const start = () => serial(launch);

  // keepEnabled: shutting down with the container, it must come back on the next start
  const stop = (keepEnabled = false) =>
    serial(async () => {
      await halt();
      if (!keepEnabled) store.setEnabled(false);
    });

  // Never both at once: a host fail2ban that shows up wins, the embedded one stops and stays off
  async function check() {
    const pid = current?.proc.pid;
    detection = await opts.detect(pid ? [pid] : []);
    if (detection.mode !== 'external') return;
    if (current) {
      log.warn(detection, 'Host fail2ban found, stopping the embedded one');
      await stop();
      stopReason = 'HOST_FAIL2BAN';
    } else if (store.enabled()) {
      store.setEnabled(false);
      stopReason = 'HOST_FAIL2BAN';
    }
  }

  return {
    paths,
    start,
    stop,
    check,
    // Boot: start again what the UI started before
    async resume() {
      if (!store.enabled()) return;
      try {
        await start();
      } catch (err) {
        log.warn({ err }, 'Embedded fail2ban not resumed');
        if (blockedBy() === 'HOST_FAIL2BAN') await check();
      }
    },
    startWatch(intervalMs = 60_000) {
      const timer = setInterval(() => {
        check().catch((err) => log.warn({ err }, 'Host fail2ban check failed'));
      }, intervalMs);
      timer.unref();
      return () => clearInterval(timer);
    },
    status: (): Omit<EmbeddedStatus, 'hostId'> => ({
      blockedBy: current ? null : blockedBy(),
      enabled: store.enabled(),
      running: current !== null,
      pid: current?.proc.pid ?? null,
      startedAt: current?.startedAt.toISOString() ?? null,
      stopReason,
      lastError,
      confDir: paths.confDir,
    }),
  };
}

export type Embedded = ReturnType<typeof createEmbedded>;

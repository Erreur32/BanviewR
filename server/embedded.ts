import { type ChildProcess, execFile, spawn } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { jailName } from '../shared/fail2ban.ts';
import type {
  EmbeddedBlock,
  EmbeddedFirewall,
  EmbeddedMachine,
  EmbeddedStatus,
  LocalDetection,
} from '../shared/hosts.ts';
import { socketListens } from './connectors/detect.ts';
import { dump, parseJailList } from './connectors/local.ts';
import type { Db } from './db/index.ts';
import { settings } from './db/schema.ts';
import { AppError } from './errors.ts';
import { covers } from './jailOps.ts';

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

const VM_NAMES = /qemu|kvm|vmware|virtualbox|innotek|xen|bochs|hyper-v|virtual machine|parallels|bhyve/i;

// VM or bare metal, from the CPU flags (x86) and the DMI names. Without a flags line (arm64) and no known
// VM name it stays unknown: a remote bare-metal machine is the case where a lockout is hardest to undo.
export function describeMachine({
  cpuinfo,
  vendor,
  product,
}: {
  cpuinfo: string | null;
  vendor: string | null;
  product: string | null;
}): EmbeddedMachine {
  const name =
    [vendor, product]
      .map((v) => v?.trim())
      .filter(Boolean)
      .join(' ') || null;
  const flags = cpuinfo
    ?.split('\n')
    .filter((line) => line.startsWith('flags'))
    .flatMap((line) => line.split(/\s+/));
  if (flags?.includes('hypervisor') || (name && VM_NAMES.test(name))) return { kind: 'vm', name };
  return { kind: flags?.length ? 'physical' : 'unknown', name };
}

const readOrNull = (file: string) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

export const readMachine = () =>
  describeMachine({
    cpuinfo: readOrNull('/proc/cpuinfo'),
    vendor: readOrNull('/sys/class/dmi/id/sys_vendor'),
    product: readOrNull('/sys/class/dmi/id/product_name'),
  });

// docker0 only shows in the host's network namespace, read from sysfs: networkInterfaces() leaves out an
// interface without an address (a docker0 with no container on it). shortcut: a Docker without its
// default bridge reads as "not host network", compare namespaces if that comes up
export const onHostNetwork = (netDir = '/sys/class/net') => existsSync(join(netDir, 'docker0'));

// An IPv4 client reached over a dual-stack socket shows as ::ffff:a.b.c.d, fail2ban wants a.b.c.d
const plainIp = (ip: string) => (ip.toLowerCase().startsWith('::ffff:') && ip.includes('.') ? ip.slice(7) : ip);

export function embeddedPaths(dataDir: string) {
  const root = join(resolve(dataDir), 'fail2ban');
  return {
    confDir: join(root, 'etc'),
    socketPath: join(root, 'fail2ban.sock'),
    pidFile: join(root, 'fail2ban.pid'),
    dbPath: join(root, 'fail2ban.sqlite3'),
    logPath: join(root, 'fail2ban.log'),
    // Put first in the server's PATH when the host firewall is iptables-legacy
    binDir: join(root, 'bin'),
  };
}
type Paths = ReturnType<typeof embeddedPaths>;

const hasRules = (save: string | null) => !!save && /^-A /m.test(save);
const hasDockerUser = (save: string | null) => !!save && /^:DOCKER-USER /m.test(save);

// Same backend as the host, told by where Docker's rules are. Rules in the other iptables backend would
// still apply, but DOCKER-USER only exists where Docker made it, and a mixed firewall is hard to read.
// Inputs are the filter table of each iptables backend (null: not loaded or not readable) and `nft list tables`.
type Dumps = {
  legacy: string | null;
  nft: string | null;
  nftTables: string | null;
  legacy6?: string | null;
  nft6?: string | null;
};

export function pickFirewall(fw: Dumps) {
  const pick = (backend: EmbeddedFirewall['backend'], dockerUser = false): EmbeddedFirewall => ({
    backend,
    dockerUser,
    dockerUser6: dockerUser && hasDockerUser(backend === 'iptables-legacy' ? (fw.legacy6 ?? null) : (fw.nft6 ?? null)),
  });
  if (hasDockerUser(fw.legacy)) return pick('iptables-legacy', true);
  if (hasDockerUser(fw.nft)) return pick('iptables-nft', true);
  if (hasRules(fw.legacy)) return pick('iptables-legacy');
  if (fw.nft && /^\*filter/m.test(fw.nft)) return pick('iptables-nft');
  // A firewall written in nftables only (no Docker, or Docker with its nftables backend)
  if (fw.nftTables?.trim()) return pick('nftables');
  return pick('iptables-nft');
}

export async function detectFirewall() {
  // Asking the legacy tool for a table that is not loaded would load its module on the host
  const loaded = (file: string) =>
    readFile(file, 'utf8').then(
      (names) => /^filter$/m.test(names),
      () => false,
    );
  const [legacyOn, legacy6On] = await Promise.all([
    loaded('/proc/net/ip_tables_names'),
    loaded('/proc/net/ip6_tables_names'),
  ]);
  const [legacy, nft, nftTables, legacy6, nft6] = await Promise.all([
    legacyOn ? dump('iptables-legacy-save', ['-t', 'filter']) : null,
    dump('iptables-nft-save', ['-t', 'filter']),
    dump('nft', ['list', 'tables']),
    legacy6On ? dump('ip6tables-legacy-save', ['-t', 'filter']) : null,
    dump('ip6tables-nft-save', ['-t', 'filter']),
  ]);
  return pickFirewall({ legacy, nft, nftTables, legacy6, nft6 });
}

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
export function writeBaseConfig(
  paths: Paths,
  { stockDir, ignoreip, firewall = null }: { stockDir: string; ignoreip: string[]; firewall?: EmbeddedFirewall | null },
) {
  mkdirSync(join(paths.confDir, 'jail.d'), { recursive: true });
  // action.d is a real folder of links, so BanviewR's own action can sit next to the stock ones
  const actionDir = join(paths.confDir, 'action.d');
  if (lstatSync(actionDir, { throwIfNoEntry: false })?.isSymbolicLink()) rmSync(actionDir);
  mkdirSync(actionDir, { recursive: true });
  linkStock(stockDir, paths.confDir, (entry) => entry === 'jail.d' || entry === 'fail2ban.d' || entry === 'action.d');
  const stockActions = join(stockDir, 'action.d');
  if (lstatSync(stockActions, { throwIfNoEntry: false }))
    linkStock(stockActions, actionDir, (e) => e === DOCKER_ACTION_FILE);
  writeFileSync(join(actionDir, DOCKER_ACTION_FILE), dockerAction(firewall));
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
  // A .conf file: read before jail.local and the jail.d/*.local files, so the admin's own banaction wins
  writeFileSync(
    join(paths.confDir, 'jail.d', '00-banviewr.conf'),
    `${HEADER}\n[DEFAULT]\n${firewallDefaults(firewall)}`,
  );
  // In jail.d with a 00 prefix: read after jail.conf and jail.local, so their [DEFAULT] cannot drop it.
  // A jail that sets its own ignoreip replaces this list: keepIgnoreip adds the base back at run time.
  writeFileSync(
    join(paths.confDir, 'jail.d', '00-banviewr.local'),
    `${HEADER}
[DEFAULT]
ignoreself = true
ignoreip = ${ignoreip.map(iniValue).join(' ')}
`,
  );
}

// Links each stock entry, except the skipped ones and .local files. A real file the admin put there wins.
function linkStock(from: string, to: string, skip: (entry: string) => boolean) {
  for (const entry of readdirSync(from)) {
    if (skip(entry) || entry.endsWith('.local')) continue;
    const link = join(to, entry);
    const target = join(from, entry);
    const existing = lstatSync(link, { throwIfNoEntry: false });
    if (existing && !existing.isSymbolicLink()) continue;
    if (existing && readlinkSync(link) === target) continue;
    if (existing) rmSync(link);
    symlinkSync(target, link);
  }
}

const DOCKER_ACTION_FILE = 'banviewr-docker-user.conf';

// Bans on every port in DOCKER-USER. Without an IPv6 DOCKER-USER chain (Docker not managing ip6tables),
// IPv6 bans skip it: `true` stands in for ip6tables, so they stay in INPUT and leave no empty chain behind.
function dockerAction(fw: EmbeddedFirewall | null) {
  return `${HEADER}
[INCLUDES]
before = iptables-allports.conf

[Init]
chain = DOCKER-USER
protocol = all
${fw?.dockerUser6 ? '' : '\n[Init?family=inet6]\niptables = true\n'}`;
}

// DOCKER-USER sees the traffic forwarded to containers after DNAT, so the container port, not the
// published one: the extra action bans on every port. Jails with their own `action` add %(action_docker)s.
function firewallDefaults(fw: EmbeddedFirewall | null) {
  const lines: string[] = [];
  if (fw?.backend === 'nftables') lines.push('banaction = nftables', 'banaction_allports = nftables[type=allports]');
  if (fw?.dockerUser) {
    lines.push(
      'action_docker = banviewr-docker-user[name="%(__name__)s-du"]',
      'action = %(action_)s',
      '         %(action_docker)s',
    );
  }
  return lines.map((l) => `${l}\n`).join('');
}

// The iptables actions run `iptables`: on a legacy host it must be iptables-legacy, for the server only
function firewallEnv(paths: Paths, fw: EmbeddedFirewall | null) {
  rmSync(paths.binDir, { recursive: true, force: true });
  if (fw?.backend !== 'iptables-legacy') return undefined;
  mkdirSync(paths.binDir, { recursive: true });
  for (const cmd of ['iptables', 'ip6tables']) symlinkSync(`/usr/sbin/${cmd}-legacy`, join(paths.binDir, cmd));
  return { ...process.env, PATH: `${paths.binDir}:${process.env.PATH ?? '/usr/sbin:/usr/bin:/sbin:/bin'}` };
}

export type Client = (args: string[]) => Promise<string>;

// `get <jail> ignoreip` prints one "|- entry" (or "`- entry" for the last) line each
export const parseIgnoreList = (out: string) =>
  out
    .split('\n')
    .map((l) => l.match(/^\s*[|`]-\s*(\S+)/)?.[1])
    .filter((ip): ip is string => ip !== undefined);

// A jail with its own ignoreip drops the base list: add back what it lacks. Returns "jail entry" per add.
export async function keepIgnoreip(client: Client, ignoreip: string[]) {
  const added: string[] = [];
  for (const jail of parseJailList(await client(['status']))) {
    // Names come from fail2ban, but end up as arguments
    if (!jailName.safeParse(jail).success) continue;
    const have = new Set(parseIgnoreList(await client(['get', jail, 'ignoreip'])));
    for (const ip of ignoreip) {
      if (have.has(ip)) continue;
      await client(['set', jail, 'addignoreip', ip]);
      added.push(`${jail} ${ip}`);
    }
  }
  return added;
}

type Store = {
  enabled(): boolean;
  setEnabled(on: boolean): void;
  trustedIp(): string | null;
  setTrustedIp(ip: string): void;
};

const ENABLED_KEY = 'embedded.enabled';
const TRUSTED_KEY = 'embedded.trustedIp';

export function settingsStore(db: Db): Store {
  const get = (key: string) => db.select().from(settings).where(eq(settings.key, key)).get()?.value;
  const put = (key: string, value: unknown) =>
    void db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  return {
    enabled: () => get(ENABLED_KEY) === true,
    setEnabled: (on) => put(ENABLED_KEY, on),
    trustedIp: () => {
      const ip = get(TRUSTED_KEY);
      return typeof ip === 'string' ? ip : null;
    },
    setTrustedIp: (ip) => put(TRUSTED_KEY, ip),
  };
}

// Started from the UI, the embedded fail2ban stops on its own unless confirmed from the UI within this time:
// a start that cut the admin off undoes itself
export const TRIAL_MS = 10 * 60_000;

// trustedIp: the address of the admin who starts it, kept out of every jail when it is not private already
export type StartOptions = { trial?: boolean; trustedIp?: string };

export type EmbeddedOptions = {
  dataDir: string;
  allowed: boolean;
  inContainer: boolean;
  // Fresh host fail2ban detection, leaving out the given processes (the embedded server itself)
  detect: (ignorePids: number[]) => Promise<LocalDetection>;
  // Host firewall check on each start, left out in tests (status firewall stays null)
  firewall?: () => Promise<EmbeddedFirewall>;
  // Told when a host fail2ban turns the embedded one off
  onHostStop?: (detection: LocalDetection) => void;
  // Told when a trial start was not confirmed in time and the server was stopped
  onTrialEnd?: () => void;
  trialMs?: number;
  serverBin?: string;
  clientBin?: string;
  // Stands in for clientBin in tests
  client?: Client;
  stockDir?: string;
  readyTimeoutMs?: number;
};

const run = promisify(execFile);

type Run = { proc: ChildProcess; startedAt: Date; ended: Promise<string>; stopping: boolean };

// Runs fail2ban-server as a child process, started from the UI only, never on its own the first time.
// Once started it comes back with the container (resume), until stopped from the UI.
export function createEmbedded(
  opts: EmbeddedOptions & { detection: LocalDetection; store: Store; log: Pick<FastifyBaseLogger, 'info' | 'warn'> },
) {
  const {
    store,
    log,
    serverBin = 'fail2ban-server',
    stockDir = '/etc/fail2ban',
    readyTimeoutMs = 20_000,
    trialMs = TRIAL_MS,
  } = opts;
  const paths = embeddedPaths(opts.dataDir);
  let detection = opts.detection;
  let current: Run | null = null;
  let stopReason: EmbeddedStatus['stopReason'] = null;
  let lastError: string | null = null;
  let firewall: EmbeddedFirewall | null = null;
  let ignoreip: string[] = [];
  let trial: { until: Date; timer: NodeJS.Timeout } | null = null;
  const endTrial = () => {
    if (trial) clearTimeout(trial.timer);
    trial = null;
  };
  const client: Client =
    opts.client ??
    ((args) =>
      run(opts.clientBin ?? 'fail2ban-client', ['-s', paths.socketPath, ...args], { timeout: 10_000 }).then(
        (r) => r.stdout,
      ));

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

  async function launch({ trial: onTrial = false, trustedIp }: StartOptions = {}) {
    if (current) return;
    detection = await opts.detect([]);
    const block = blockedBy();
    if (block) {
      throw new AppError(block === 'HOST_FAIL2BAN' ? 'CONFLICT' : 'FORBIDDEN', `Embedded fail2ban blocked: ${block}`);
    }
    // A start from the LAN keeps the public address an earlier admin was protected with
    const ip = trustedIp && plainIp(trustedIp);
    if (ip && !BASE_IGNOREIP.some((range) => covers(range, ip))) store.setTrustedIp(ip);
    if (Buffer.byteLength(paths.socketPath) > MAX_SOCKET_PATH) {
      throw new AppError('BAD_REQUEST', 'DATA_DIR is too long for the embedded fail2ban socket path');
    }
    firewall = opts.firewall ? await opts.firewall() : null;
    const trusted = store.trustedIp();
    ignoreip = [...BASE_IGNOREIP, ...dockerNetworks(), ...(trusted ? [trusted] : [])];
    writeBaseConfig(paths, { stockDir, ignoreip, firewall });
    stopReason = null;
    lastError = null;

    // Fixed arguments, no shell. spawn and not execFile: the server runs for good, execFile would buffer
    // its output and kill it past maxBuffer. -x removes a socket left by a crash.
    const proc = spawn(serverBin, ['-f', '-x', '-c', paths.confDir, '-s', paths.socketPath, '-p', paths.pidFile], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: firewallEnv(paths, firewall),
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
    // On trial it is not enabled yet: a container restart before the confirmation leaves it off
    if (onTrial) {
      const timer = setTimeout(() => {
        void serial(async () => {
          if (current !== run || !trial) return;
          trial = null;
          await halt();
          stopReason = 'TRIAL_EXPIRED';
          log.warn('Embedded fail2ban trial not confirmed, stopped');
          opts.onTrialEnd?.();
        });
      }, trialMs);
      timer.unref();
      trial = { until: new Date(Date.now() + trialMs), timer };
    } else store.setEnabled(true);
    log.info({ pid: proc.pid, confDir: paths.confDir, firewall, trial: onTrial }, 'Embedded fail2ban started');
    await enforceIgnoreip();
  }

  // Also called after a jail action from BanviewR (app.connect); a reload done outside BanviewR waits for the
  // next watch tick (1 min)
  async function enforceIgnoreip() {
    if (!current) return;
    try {
      const added = await keepIgnoreip(client, ignoreip);
      if (added.length) log.info({ added }, 'Base ignoreip added back to jails that set their own');
    } catch (err) {
      log.warn({ err }, 'Embedded fail2ban ignoreip check failed');
    }
  }

  const start = (options?: StartOptions) => serial(() => launch(options));

  // keepEnabled: shutting down with the container, it must come back on the next start
  const stop = (keepEnabled = false) =>
    serial(async () => {
      endTrial();
      await halt();
      if (!keepEnabled) store.setEnabled(false);
    });

  // The admin still reaches BanviewR after a trial start: keep it, and bring it back with the container
  const confirm = () =>
    serial(async () => {
      if (!current || !trial) throw new AppError('CONFLICT', 'No embedded fail2ban trial to confirm');
      endTrial();
      store.setEnabled(true);
    });

  // Never both at once: a host fail2ban that shows up wins, the embedded one stops and stays off
  async function check() {
    const pid = current?.proc.pid;
    detection = await opts.detect(pid ? [pid] : []);
    if (detection.mode !== 'external') return enforceIgnoreip();
    if (!current && !store.enabled()) return;
    if (current) {
      log.warn(detection, 'Host fail2ban found, stopping the embedded one');
      await stop();
    } else store.setEnabled(false);
    stopReason = 'HOST_FAIL2BAN';
    opts.onHostStop?.(detection);
  }

  return {
    paths,
    start,
    stop,
    confirm,
    check,
    enforceIgnoreip,
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
      firewall,
      trialUntil: trial?.until.toISOString() ?? null,
      trustedIp: store.trustedIp(),
      machine: readMachine(),
      hostNetwork: onHostNetwork(),
    }),
  };
}

export type Embedded = ReturnType<typeof createEmbedded>;

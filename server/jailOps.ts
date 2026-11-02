import { BlockList, isIP } from 'node:net';
import { gt } from 'drizzle-orm';
import type { JailAction } from '../shared/fail2ban.ts';
import { audited, type Caller, recordAudit } from './audit.ts';
import type { Fail2banConnector } from './connectors/connector.ts';
import type { Db } from './db/index.ts';
import { sessions } from './db/schema.ts';
import { AppError } from './errors.ts';
import { notifyAction } from './notifications.ts';

// What the REST routes and the MCP tools share, so both apply the same rules

const idleJail = (name: string) => ({
  name,
  currentlyFailed: 0,
  totalFailed: 0,
  currentlyBanned: 0,
  totalBanned: 0,
  bannedIps: [],
  fileList: '',
});

export async function listJailRows(host: Fail2banConnector) {
  const [running, configs] = await Promise.all([host.listJails(), host.jailConfigs()]);
  const configOf = (name: string) => configs.find((c) => c.name === name) ?? null;
  const stopped = configs.filter((c) => c.enabled && !running.some((j) => j.name === c.name));
  return [
    ...running.map((jail) => ({ ...jail, running: true, config: configOf(jail.name) })),
    ...stopped.map((config) => ({ ...idleJail(config.name), running: false, config })),
  ];
}

const family = (ip: string) => (isIP(ip) === 6 ? 'ipv6' : 'ipv4');

// BlockList also matches IPv4 rules against IPv4-mapped IPv6 clients
export function covers(target: string, ip: string) {
  const [address = '', prefix] = target.split('/');
  const list = new BlockList();
  if (prefix) list.addSubnet(address, Number(prefix), family(address));
  else list.addAddress(address, family(address));
  return list.check(ip, family(ip));
}

type BanChange = { hostId: number; jail: string; target: string };

// Local, private and link-local ranges: an agent misled by some text could cut the LAN off
const PRIVATE_RANGES = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '::/127',
  'fc00::/7',
  'fe80::/10',
];

// Two networks overlap when one holds the start of the other
const overlaps = (a: string, b: string) => covers(a, b.split('/')[0] ?? '') || covers(b, a.split('/')[0] ?? '');

// Extra rules for bans asked by an AI agent, on top of changeBan's. Refusals are audited:
// they may be the trace of a prompt injection.
export function checkAgentBan(db: Db, caller: Caller, { hostId, jail, target }: BanChange) {
  let reason: string | undefined;
  if (PRIVATE_RANGES.some((range) => overlaps(target, range))) {
    reason = 'Agents cannot ban private, local or link-local addresses';
  } else {
    const signedIn = db
      .selectDistinct({ ip: sessions.ip })
      .from(sessions)
      .where(gt(sessions.expiresAt, new Date()))
      .all();
    if (signedIn.some((s) => covers(target, s.ip))) reason = 'A user is signed in from this address';
  }
  if (!reason) return;
  recordAudit(db, caller, { action: 'jail.ban', ok: false, hostId, target, detail: `${jail}: refused, ${reason}` });
  throw new AppError('FORBIDDEN', reason);
}

export async function changeBan(
  db: Db,
  caller: Caller,
  host: Fail2banConnector,
  verb: 'ban' | 'unban',
  { hostId, jail, target }: BanChange,
) {
  // Whoever bans their own address loses the UI and has to fix it from the machine
  if (verb === 'ban' && covers(target, caller.ip)) throw new AppError('CONFLICT', 'This would ban your own address');
  await audited(db, caller, { action: `jail.${verb}`, hostId, target, detail: jail }, () => host[verb](jail, target));
  notifyAction(db, caller, { hostId, action: verb, target, jail });
}

export async function runJailAction(
  db: Db,
  caller: Caller,
  host: Fail2banConnector,
  { hostId, jail, action }: { hostId: number; jail: string; action: JailAction },
) {
  await audited(db, caller, { action: `jail.${action}`, hostId, target: jail }, () => host.jailAction(jail, action));
  notifyAction(db, caller, { hostId, action, target: jail, jail: null });
}

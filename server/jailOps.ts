import { BlockList, isIP } from 'node:net';
import type { JailAction } from '../shared/fail2ban.ts';
import { audited, type Caller } from './audit.ts';
import type { Fail2banConnector } from './connectors/connector.ts';
import type { Db } from './db/index.ts';
import { AppError } from './errors.ts';

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
}

export const runJailAction = (
  db: Db,
  caller: Caller,
  host: Fail2banConnector,
  { hostId, jail, action }: { hostId: number; jail: string; action: JailAction },
) => audited(db, caller, { action: `jail.${action}`, hostId, target: jail }, () => host.jailAction(jail, action));

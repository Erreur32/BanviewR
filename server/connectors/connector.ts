import type { BanRow, JailAction, JailConfig, JailStatus } from '../../shared/fail2ban.ts';
import type { HostStatus } from '../../shared/hosts.ts';
import type { hosts } from '../db/schema.ts';
import type { RawBan } from './sqliteReader.ts';

// The only way routes reach an instance: local socket today, remote agent later.
// Everything but status() throws an AppError when fail2ban cannot answer.
export interface Fail2banConnector {
  status(): Promise<HostStatus>;
  listJails(): Promise<JailStatus[]>;
  jail(name: string): Promise<JailStatus>;
  jailConfigs(): Promise<JailConfig[]>;
  ban(jail: string, target: string): Promise<void>;
  unban(jail: string, target: string): Promise<void>;
  jailAction(jail: string, action: JailAction): Promise<void>;
  activeBans(): Promise<BanRow[]>;
  recentBans(limit: number): Promise<BanRow[]>;
  // Oldest first, read page by page: a first import can hold years of bans
  bansSince(since: number, limit: number, offset: number): Promise<RawBan[]>;
  jailActions(jail: string): Promise<string[]>;
  // One setting of a jail action as fail2ban holds it, <tags> included. null when it has no such setting.
  actionProperty(jail: string, action: string, property: string): Promise<string | null>;
  firewall(): Promise<FirewallDump>;
}

// Raw output of the firewall tools, null when one could not be read (missing, no permission)
export type FirewallDump = { iptables: string | null; ipset: string | null; nft: string | null };

export type ConnectorFactory = (host: typeof hosts.$inferSelect) => Fail2banConnector;

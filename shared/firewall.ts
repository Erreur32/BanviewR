import { z } from 'zod';

// How one action of a jail bans: an iptables chain, an ipset, an nftables set, or something else
export const banMechanism = z.object({
  action: z.string(),
  kind: z.enum(['iptables', 'ipset', 'nftables', 'other']),
  // Chain, ipset name, or "family table set" for nftables. null when it could not be resolved.
  target: z.string().nullable(),
});
export type BanMechanism = z.infer<typeof banMechanism>;

export const firewallIssue = z.object({
  severity: z.enum(['critical', 'warning']),
  kind: z.enum([
    // The jail has bans but its chain or set does not exist
    'target-missing',
    // The chain or set exists but no rule sends traffic through it
    'not-hooked',
    // Banned by fail2ban, absent from the firewall
    'ip-missing',
    // In the jail's chain or set, unknown to fail2ban
    'ip-orphan',
    // An ipset with entries that no rule uses
    'orphan-set',
    // A rule matching an ipset that does not exist
    'dangling-rule',
  ]),
  jail: z.string().nullable(),
  target: z.string().nullable(),
  ip: z.string().nullable(),
});
export type FirewallIssue = z.infer<typeof firewallIssue>;

export const firewallAudit = z.object({
  // What BanviewR could read: false means missing tool or no permission (root, NET_ADMIN in Docker)
  readable: z.object({ iptables: z.boolean(), ipset: z.boolean(), nftables: z.boolean() }),
  jails: z.array(z.object({ jail: z.string(), banned: z.number(), actions: z.array(banMechanism) })),
  issues: z.array(firewallIssue),
});
export type FirewallAudit = z.infer<typeof firewallAudit>;

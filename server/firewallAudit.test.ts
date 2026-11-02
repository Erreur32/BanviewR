import { describe, expect, it } from 'vitest';
import { type AuditedJail, auditFirewall, parseBanCommand, readFirewallAudit, resolveTags } from './firewallAudit.ts';
import { buildTestApp, fakeConnector } from './test-utils.ts';

// Trimmed from a Debian 13 test server: sshd on iptables, recidive on ipset, manual on nftables
const IPTABLES = `*filter
:INPUT ACCEPT [0:0]
:DOCKER-USER - [0:0]
:f2b-sshd - [0:0]
-A INPUT -p tcp -m set --match-set f2b-recidive src -j REJECT --reject-with icmp-port-unreachable
-A INPUT -p tcp -m multiport --dports 22 -j f2b-sshd
-A DOCKER-USER -j RETURN
-A f2b-sshd -s 198.51.100.20/32 -j REJECT --reject-with icmp-port-unreachable
-A f2b-sshd -j RETURN
COMMIT`;
const IPSET = `create f2b-recidive hash:ip family inet hashsize 1024 maxelem 65536 timeout 0
add f2b-recidive 192.0.2.30 timeout 0`;
const nftDump = (elems: unknown[], ruleSet = '@addr-set-manual') =>
  JSON.stringify({
    nftables: [
      { metainfo: { version: '1.1.3' } },
      { set: { family: 'inet', name: 'addr-set-manual', table: 'f2b-table', type: 'ipv4_addr', elem: elems } },
      {
        rule: {
          family: 'inet',
          table: 'f2b-table',
          chain: 'f2b-chain',
          expr: [{ match: { op: '==', left: { payload: { protocol: 'ip', field: 'saddr' } }, right: ruleSet } }],
        },
      },
    ],
  });

const JAILS = [
  { jail: 'sshd', bannedIps: ['198.51.100.20'], actions: [{ action: 'a', kind: 'iptables', target: 'f2b-sshd' }] },
  { jail: 'recidive', bannedIps: ['192.0.2.30'], actions: [{ action: 'b', kind: 'ipset', target: 'f2b-recidive' }] },
  {
    jail: 'manual',
    bannedIps: ['203.0.113.10'],
    actions: [{ action: 'c', kind: 'nftables', target: 'inet f2b-table addr-set-manual' }],
  },
] as const;
const jails = (): AuditedJail[] => JAILS.map((j) => ({ ...j, bannedIps: [...j.bannedIps], actions: [...j.actions] }));

describe('auditFirewall', () => {
  it('finds nothing when the firewall matches fail2ban', () => {
    const audit = auditFirewall({ iptables: IPTABLES, ipset: IPSET, nft: nftDump(['203.0.113.10']) }, jails());
    expect(audit.issues).toEqual([]);
    expect(audit.readable).toEqual({ iptables: true, ipset: true, nftables: true });
    expect(audit.jails.map((j) => j.banned)).toEqual([1, 1, 1]);
  });

  it('reports missing and leftover addresses on each backend', () => {
    const list = jails();
    list[0]?.bannedIps.push('198.51.100.21');
    const audit = auditFirewall(
      {
        iptables: IPTABLES,
        ipset: `${IPSET}\nadd f2b-recidive 192.0.2.31 timeout 0`,
        nft: nftDump([{ elem: { val: '203.0.113.10', timeout: 600 } }, { prefix: { addr: '203.0.113.64', len: 26 } }]),
      },
      list,
    );
    expect(audit.issues.map((i) => [i.kind, i.jail, i.ip])).toEqual([
      ['ip-missing', 'sshd', '198.51.100.21'],
      ['ip-orphan', 'recidive', '192.0.2.31'],
      ['ip-orphan', 'manual', '203.0.113.64/26'],
    ]);
  });

  it('reports chains and sets nothing uses, missing ones, orphans and dangling rules', () => {
    const iptables = IPTABLES.replace('-A INPUT -p tcp -m multiport --dports 22 -j f2b-sshd\n', '').replace(
      'f2b-recidive src',
      'f2b-gone src',
    );
    const ipset = `${IPSET}\ncreate blocklist hash:net\nadd blocklist 192.0.2.0/24\ncreate docker-x hash:ip\nadd docker-x 10.0.0.1`;
    const audit = auditFirewall({ iptables, ipset, nft: nftDump([], '@other') }, jails());
    expect(audit.issues.map((i) => [i.severity, i.kind, i.target])).toEqual([
      ['critical', 'not-hooked', 'f2b-sshd'],
      ['critical', 'not-hooked', 'f2b-recidive'],
      ['critical', 'not-hooked', 'inet f2b-table addr-set-manual'],
      ['critical', 'ip-missing', 'inet f2b-table addr-set-manual'],
      ['warning', 'orphan-set', 'blocklist'],
      ['critical', 'dangling-rule', 'f2b-gone'],
    ]);
  });

  it('only flags a missing chain when the jail has bans', () => {
    const list = jails();
    const audit = auditFirewall({ iptables: '', ipset: null, nft: null }, list);
    expect(audit.issues).toEqual([
      { severity: 'critical', kind: 'target-missing', jail: 'sshd', target: 'f2b-sshd', ip: null },
    ]);
    expect(audit.readable).toEqual({ iptables: true, ipset: false, nftables: false });
    if (list[0]) list[0].bannedIps = [];
    expect(auditFirewall({ iptables: '', ipset: null, nft: null }, list).issues).toEqual([]);
  });
});

describe('ban actions', () => {
  it('finds where a ban command puts the address', () => {
    expect(parseBanCommand('<iptables> -I f2b-sshd 1 -s <ip> -j <blocktype>')).toEqual({
      kind: 'iptables',
      target: 'f2b-sshd',
    });
    expect(parseBanCommand('ipset -exist add <ipmset> <ip> timeout 0')).toEqual({ kind: 'ipset', target: '<ipmset>' });
    expect(parseBanCommand('nft add element inet f2b-table <addr_set> \\{ <ip> \\}')).toEqual({
      kind: 'nftables',
      target: 'inet f2b-table <addr_set>',
    });
    expect(parseBanCommand('printf %b "Subject: banned <ip>" | sendmail')).toEqual({ kind: 'other', target: null });
  });

  it('resolves tags through the action settings', async () => {
    const props: Record<string, string> = { addr_set: 'addr-set-<name>' };
    const property = async (p: string) => props[p] ?? null;
    expect(await resolveTags('inet f2b-table <addr_set>', 'manual', property)).toBe('inet f2b-table addr-set-manual');
    expect(await resolveTags('<unknown>', 'manual', property)).toBeNull();
    expect(await resolveTags('<x>', 'j', async () => 'a$&b')).toBe('a$&b');
  });

  it('audits through the connector and the API', async () => {
    const props: Record<string, string> = {
      actionban: 'ipset -exist add <ipmset> <ip> timeout 0',
      ipmset: 'f2b-<name>',
    };
    const connector = fakeConnector({
      listJails: async () => [
        {
          name: 'recidive',
          bannedIps: ['192.0.2.30'],
          currentlyFailed: 0,
          totalFailed: 0,
          currentlyBanned: 1,
          totalBanned: 1,
          fileList: '',
        },
      ],
      jailActions: async () => ['iptables-ipset-proto6-allports', '-bad'],
      actionProperty: async (_jail, _action, p) => props[p] ?? null,
      firewall: async () => ({ iptables: IPTABLES, ipset: IPSET, nft: null }),
    });
    const audit = await readFirewallAudit(connector);
    expect(audit.jails[0]?.actions).toEqual([
      { action: 'iptables-ipset-proto6-allports', kind: 'ipset', target: 'f2b-recidive' },
      { action: '-bad', kind: 'other', target: null },
    ]);
    expect(audit.issues).toEqual([]);

    const app = await buildTestApp({ connect: () => connector });
    try {
      // No session: the route is not public
      const res = await app.inject({ method: 'GET', url: '/api/hosts/1/firewall' });
      expect(res.json().result).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    } finally {
      await app.close();
    }
  });
});

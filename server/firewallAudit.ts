import { jailName } from '../shared/fail2ban.ts';
import type { BanMechanism, FirewallAudit, FirewallIssue } from '../shared/firewall.ts';
import type { Fail2banConnector, FirewallDump } from './connectors/connector.ts';

// Read-only: compares what fail2ban says it bans with what the kernel really blocks.

type Rule = { chain: string; source?: string; matchSet?: string; jump?: string };

// iptables prints 1.2.3.4/32, fail2ban 1.2.3.4
const normalize = (ip: string) => ip.replace(/\/(32|128)$/, '');

export function parseIptablesSave(text: string) {
  const chains = new Set<string>();
  const rules: Rule[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const declared = line.match(/^:(\S+)\s/)?.[1];
    if (declared) chains.add(declared);
    const chain = line.match(/^-A\s+(\S+)/)?.[1];
    if (!chain) continue;
    const source = line.match(/\s-s\s+(\S+)/)?.[1];
    rules.push({
      chain,
      source: source && normalize(source),
      matchSet: line.match(/--match-set\s+(\S+)/)?.[1],
      jump: line.match(/\s-j\s+(\S+)/)?.[1],
    });
  }
  return { chains, rules };
}

// `ipset list -o save`: "create NAME ..." then "add NAME ENTRY [timeout N]"
export function parseIpsetSave(text: string) {
  const sets = new Map<string, Set<string>>();
  for (const line of text.split('\n')) {
    const [verb, name, entry] = line.trim().split(/\s+/);
    if (!name) continue;
    if (verb === 'create') sets.set(name, sets.get(name) ?? new Set());
    if (verb === 'add' && entry) sets.get(name)?.add(normalize(entry));
  }
  return sets;
}

type NftElem = string | { prefix?: { addr: string; len: number }; elem?: { val: NftElem } };
type NftItem = {
  set?: { family: string; table: string; name: string; elem?: NftElem[] };
  rule?: { family: string; table: string; expr: unknown };
};

const nftElem = (e: NftElem): string | null => {
  if (typeof e === 'string') return normalize(e);
  if (e.prefix) return normalize(`${e.prefix.addr}/${e.prefix.len}`);
  return e.elem ? nftElem(e.elem.val) : null;
};

// `nft -j list ruleset`: sets keyed "family table name", rules kept as JSON text per table.
// null when the output is not JSON (nft built without it).
export function parseNft(text: string) {
  let items: NftItem[];
  try {
    items = JSON.parse(text).nftables ?? [];
  } catch {
    return null;
  }
  const sets = new Map<string, Set<string>>();
  const rules = new Map<string, string>();
  for (const { set, rule } of items) {
    if (set) {
      const entries = (set.elem ?? []).map(nftElem).filter((e) => e !== null);
      sets.set(`${set.family} ${set.table} ${set.name}`, new Set(entries));
    }
    if (rule) {
      const table = `${rule.family} ${rule.table}`;
      rules.set(table, `${rules.get(table) ?? ''}${JSON.stringify(rule.expr)}\n`);
    }
  }
  return { sets, rules };
}

// Where an action's ban command puts the address, tags still unresolved
export function parseBanCommand(ban: string): Omit<BanMechanism, 'action'> {
  if (/\bipset\b/.test(ban)) {
    return { kind: 'ipset', target: ban.match(/ipset\s+(?:-\S+\s+)*add\s+(\S+)/)?.[1] ?? null };
  }
  if (/\bnft\b/.test(ban)) {
    const m = ban.match(/add\s+element\s+(\S+)\s+(\S+)\s+(\S+)/);
    return { kind: 'nftables', target: m ? `${m[1]} ${m[2]} ${m[3]}` : null };
  }
  if (/\bip6?tables\b/.test(ban)) return { kind: 'iptables', target: ban.match(/\s-[IA]\s+(\S+)/)?.[1] ?? null };
  return { kind: 'other', target: null };
}

// fail2ban fills <name> with the jail, other tags are settings of the action, possibly holding tags too
export async function resolveTags(text: string, jail: string, property: (tag: string) => Promise<string | null>) {
  let out = text;
  for (let depth = 0; depth < 4; depth++) {
    const tags = [...new Set([...out.matchAll(/<(\w+)>/g)].map((m) => m[1] as string))];
    if (!tags.length) return out;
    for (const tag of tags) {
      const value = tag === 'name' ? jail : await property(tag);
      if (value === null) return null;
      // A function: a string replacement would read $& and the like in the value
      out = out.replaceAll(`<${tag}>`, () => value);
    }
  }
  return /<\w+>/.test(out) ? null : out;
}

export type AuditedJail = { jail: string; bannedIps: string[]; actions: BanMechanism[] };

const union = (...sets: (Set<string> | undefined)[]) => new Set(sets.flatMap((s) => (s ? [...s] : [])));

export function auditFirewall(dump: FirewallDump, jails: AuditedJail[]): FirewallAudit {
  const ipt = dump.iptables === null ? null : parseIptablesSave(dump.iptables);
  const ipsets = dump.ipset === null ? null : parseIpsetSave(dump.ipset);
  const nft = dump.nft === null ? null : parseNft(dump.nft);
  const issues: FirewallIssue[] = [];
  const add = (severity: FirewallIssue['severity'], kind: FirewallIssue['kind'], fields: Partial<FirewallIssue>) =>
    issues.push({ severity, kind, jail: null, target: null, ip: null, ...fields });
  const jailSets = new Set<string>();

  for (const { jail, bannedIps, actions } of jails) {
    const banned = new Set(bannedIps.map(normalize));
    for (const { kind, target } of actions) {
      if (!target) continue;
      let found: { exists: boolean; hooked: boolean; entries: Set<string> };
      if (kind === 'iptables' && ipt) {
        found = {
          exists: ipt.chains.has(target),
          hooked: ipt.rules.some((r) => r.chain !== target && r.jump === target),
          entries: new Set(ipt.rules.filter((r) => r.chain === target && r.source).map((r) => r.source as string)),
        };
      } else if (kind === 'ipset' && ipsets) {
        // fail2ban keeps IPv6 addresses in a twin set named with a trailing 6
        jailSets.add(target).add(`${target}6`);
        found = {
          exists: ipsets.has(target),
          // Unknown without iptables: no issue then
          hooked: !ipt || ipt.rules.some((r) => r.matchSet === target),
          entries: union(ipsets.get(target), ipsets.get(`${target}6`)),
        };
      } else if (kind === 'nftables' && nft) {
        const [family, table, set] = target.split(' ');
        // IPv6 twin: addr-set-<jail> and addr6-set-<jail>
        const twin = `${family} ${table} ${set?.replace(/^addr-/, 'addr6-')}`;
        found = {
          exists: nft.sets.has(target),
          hooked: (nft.rules.get(`${family} ${table}`) ?? '').includes(`"@${set}"`),
          entries: union(nft.sets.get(target), nft.sets.get(twin)),
        };
      } else continue;

      // Chains and sets are created on the first ban: none yet is fine
      if (!found.exists) {
        if (banned.size) add('critical', 'target-missing', { jail, target });
        continue;
      }
      if (!found.hooked) add('critical', 'not-hooked', { jail, target });
      for (const ip of banned) if (!found.entries.has(ip)) add('critical', 'ip-missing', { jail, target, ip });
      for (const ip of found.entries) if (!banned.has(ip)) add('warning', 'ip-orphan', { jail, target, ip });
    }
  }

  if (ipt && ipsets) {
    for (const [name, entries] of ipsets) {
      if (jailSets.has(name) || name.startsWith('docker-') || !entries.size) continue;
      if (!ipt.rules.some((r) => r.matchSet === name)) add('warning', 'orphan-set', { target: name });
    }
    const dangling = new Set(ipt.rules.flatMap((r) => (r.matchSet && !ipsets.has(r.matchSet) ? [r.matchSet] : [])));
    for (const name of dangling) add('critical', 'dangling-rule', { target: name });
  }

  return {
    readable: { iptables: ipt !== null, ipset: ipsets !== null, nftables: nft !== null },
    jails: jails.map(({ jail, bannedIps, actions }) => ({ jail, banned: bannedIps.length, actions })),
    issues,
  };
}

async function jailMechanisms(connector: Fail2banConnector, jail: string): Promise<BanMechanism[]> {
  const names = await connector.jailActions(jail);
  return Promise.all(
    names.map(async (action) => {
      // Passed back to fail2ban-client as an argument
      if (!jailName.safeParse(action).success) return { action, kind: 'other', target: null };
      const property = (p: string) => connector.actionProperty(jail, action, p);
      const { kind, target } = parseBanCommand((await property('actionban')) ?? '');
      return { action, kind, target: target && (await resolveTags(target, jail, property)) };
    }),
  );
}

export async function readFirewallAudit(connector: Fail2banConnector) {
  const [dump, jails] = await Promise.all([connector.firewall(), connector.listJails()]);
  const audited = await Promise.all(
    jails.map(async (j) => ({
      jail: j.name,
      bannedIps: j.bannedIps,
      actions: await jailMechanisms(connector, j.name),
    })),
  );
  return auditFirewall(dump, audited);
}

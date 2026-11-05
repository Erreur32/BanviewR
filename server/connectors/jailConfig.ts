import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JailConfig } from '../../shared/fail2ban.ts';

type Section = Record<string, string>;

// Not jails: [DEFAULT] holds inherited values, the others are fail2ban's own
const RESERVED = new Set(['DEFAULT', 'INCLUDES', 'Init', 'Definition']);
const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

function readIni(file: string, sections: Map<string, Section>) {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return; // jail.local and jail.d are optional
  }
  let current: Section | undefined;
  let lastKey = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*[#;].*$/, '').replace(/\s+[#;].*$/, '');
    if (!line.trim()) {
      lastKey = '';
      continue;
    }
    if (/^\s/.test(line) && current && lastKey) {
      current[lastKey] = `${current[lastKey]} ${line.trim()}`;
      continue;
    }
    // Section names keep their case: fail2ban treats sshd and SSHD as two jails
    const name = line.match(/^\[([^\]]+)\]\s*$/)?.[1];
    if (name) {
      current = sections.get(name) ?? {};
      sections.set(name, current);
      lastKey = '';
      continue;
    }
    const pair = line.match(/^([\w-]+)\s*=\s*(.*)$/);
    if (pair?.[1] && current) {
      lastKey = pair[1].toLowerCase();
      current[lastKey] = (pair[2] ?? '').trim();
    }
  }
}

// 10m, 1h, 1d, -1 (permanent). Compound values like 1h30m are not read, they give null.
export function parseDuration(value: string | undefined) {
  const match = value?.trim().match(/^(-?\d+(?:\.\d+)?)\s*([smhdw])?$/i);
  if (!match?.[1]) return null;
  const amount = Number(match[1]);
  return amount < 0 ? amount : Math.round(amount * (UNITS[(match[2] ?? 's').toLowerCase()] ?? 1));
}

// shortcut: action names are not resolved, add them with the firewall audit
export function readJailConfigs(confDir: string): JailConfig[] {
  const sections = new Map<string, Section>();
  let dropIns: string[] = [];
  try {
    dropIns = readdirSync(join(confDir, 'jail.d')).sort();
  } catch {
    // no jail.d
  }
  const inDir = (ext: string) => dropIns.filter((f) => f.endsWith(ext)).map((f) => join(confDir, 'jail.d', f));
  // fail2ban's override order
  for (const file of [join(confDir, 'jail.conf'), ...inDir('.conf'), join(confDir, 'jail.local'), ...inDir('.local')]) {
    readIni(file, sections);
  }

  const defaults = sections.get('DEFAULT') ?? {};
  return [...sections]
    .filter(([name]) => !RESERVED.has(name))
    .map(([name, section]) => {
      const value = (key: string) => section[key] ?? defaults[key];
      const maxretry = Number.parseInt(value('maxretry') ?? '', 10);
      return {
        name,
        // fail2ban's own default: a jail runs only when asked to
        enabled: ['true', 'yes', '1', 'on'].includes((value('enabled') ?? 'false').toLowerCase()),
        // %(mode)s and the like, from the jail then [DEFAULT]; unknown ones stay as written
        filter:
          value('filter')?.replace(/%\((\w+)\)s/g, (raw, key: string) =>
            key === '__name__' ? name : (value(key.toLowerCase()) ?? raw),
          ) ?? null,
        bantime: parseDuration(value('bantime')),
        findtime: parseDuration(value('findtime')),
        maxretry: Number.isNaN(maxretry) ? null : maxretry,
      };
    });
}

import { z } from 'zod';
import { countryCount, ipGeo, orgCount } from './geoip.ts';

// Passed to fail2ban-client as an argument: the first character rules out option-like names
export const jailName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/, 'Invalid jail name');

// A very wide network would cut the host off from the world, its admins included
const MIN_PREFIX = { v4: 8, v6: 16 };
const notTooWide = (cidr: string) => {
  const [address, prefix] = cidr.split('/');
  return Number(prefix) >= (address?.includes(':') ? MIN_PREFIX.v6 : MIN_PREFIX.v4);
};

// Unbanning has no such limit: a wide ban set outside BanviewR must stay removable
export const unbanTarget = z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]);
export const banTarget = unbanTarget.refine((t) => !t.includes('/') || notTooWide(t), 'Network too wide');

export const jailAction = z.enum(['start', 'stop', 'reload']);
export type JailAction = z.infer<typeof jailAction>;

export const jailStatus = z.object({
  name: z.string(),
  currentlyFailed: z.number(),
  totalFailed: z.number(),
  currentlyBanned: z.number(),
  totalBanned: z.number(),
  bannedIps: z.array(z.string()),
  fileList: z.string(),
});
export type JailStatus = z.infer<typeof jailStatus>;

export const jailConfig = z.object({
  name: z.string(),
  enabled: z.boolean(),
  filter: z.string().nullable(),
  // Seconds, -1 means permanent, null when not set or not readable
  bantime: z.number().nullable(),
  findtime: z.number().nullable(),
  maxretry: z.number().nullable(),
});
export type JailConfig = z.infer<typeof jailConfig>;

// A jail fail2ban runs, or a stopped one found in the config
export const jailRow = jailStatus.extend({ running: z.boolean(), config: jailConfig.nullable() });
export type JailRow = z.infer<typeof jailRow>;

export const banRow = z.object({
  ip: z.string(),
  jail: z.string(),
  bannedAt: z.string(),
  // Seconds, -1 means permanent
  bantime: z.number(),
  failures: z.number(),
});
export type BanRow = z.infer<typeof banRow>;

// A ban as the API answers it, with where the address comes from
export const locatedBan = banRow.extend({ geo: ipGeo });
export type LocatedBan = z.infer<typeof locatedBan>;

export const banStats = z.object({
  totalBans: z.number(),
  uniqueIps: z.number(),
  topIps: z.array(z.object({ ip: z.string(), count: z.number(), geo: ipGeo })),
  // Sorted by bans, addresses with no known country left out
  countries: z.array(countryCount),
  // Top network operators, same rule as countries
  orgs: z.array(orgCount),
  topJails: z.array(z.object({ jail: z.string(), bans: z.number(), failures: z.number() })),
  // Hourly slots per jail, `at` in unix seconds: the reader folds them in its own time zone
  slots: z.array(z.object({ at: z.number(), jail: z.string(), bans: z.number() })),
  // Oldest ban kept for the instance, unix seconds, null without any: a comparison with an earlier
  // window only means something when the history reaches back that far
  firstBanAt: z.number().nullable(),
});
export type BanStats = z.infer<typeof banStats>;

export const threatRow = z.object({
  ip: z.string(),
  bans: z.number(),
  jails: z.array(z.string()),
  // First and last ban inside the window
  firstBanAt: z.string(),
  lastBanAt: z.string(),
  geo: ipGeo,
});
export type ThreatRow = z.infer<typeof threatRow>;

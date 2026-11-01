import { z } from 'zod';

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

export const banRow = z.object({
  ip: z.string(),
  jail: z.string(),
  bannedAt: z.string(),
  // Seconds, -1 means permanent
  bantime: z.number(),
  failures: z.number(),
});
export type BanRow = z.infer<typeof banRow>;

// Hours and dates are UTC, the web app converts them
export const banStats = z.object({
  totalBans: z.number(),
  uniqueIps: z.number(),
  topIps: z.array(z.object({ ip: z.string(), count: z.number() })),
  topJails: z.array(z.object({ jail: z.string(), bans: z.number(), failures: z.number() })),
  byHour: z.array(z.object({ hour: z.number(), bans: z.number(), failures: z.number() })),
  byDay: z.array(z.object({ date: z.string(), bans: z.number() })),
});
export type BanStats = z.infer<typeof banStats>;

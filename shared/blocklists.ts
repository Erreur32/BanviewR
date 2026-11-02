import { z } from 'zod';

export const blocklistBody = z.object({
  name: z.string().trim().min(1).max(64),
  url: z.url({ protocol: /^https?$/ }).max(2048),
});

export const blocklistRow = z.object({
  id: z.number(),
  name: z.string(),
  url: z.string(),
  enabled: z.boolean(),
  // The ipset holding it, matched by an iptables DROP rule on input
  set: z.string(),
  loadedAt: z.string().nullable(),
  entries: z.number(),
  skipped: z.number(),
  // null: never loaded, '': last load worked, otherwise why it failed
  lastError: z.string().nullable(),
});
export type BlocklistRow = z.infer<typeof blocklistRow>;

// Public IPv4 lists offered in the form, none is added without an admin choosing it
export const BLOCKLIST_PRESETS = [
  { name: 'Spamhaus DROP', url: 'https://www.spamhaus.org/drop/drop.txt' },
  { name: 'blocklist.de all', url: 'https://lists.blocklist.de/lists/all.txt' },
  { name: 'CINS Army', url: 'https://cinsscore.com/list/ci-badguys.txt' },
  { name: 'GreenSnow', url: 'https://blocklist.greensnow.co/greensnow.txt' },
  { name: 'BruteForceBlocker', url: 'https://danger.rulez.sk/projects/bruteforceblocker/blist.php' },
  { name: 'Tor exit nodes', url: 'https://check.torproject.org/torbulkexitlist' },
  {
    name: 'Data-Shield',
    url: 'https://cdn.jsdelivr.net/gh/duggytuxy/Data-Shield_IPv4_Blocklist@main/prod_data-shield_ipv4_blocklist.txt',
  },
] as const;

import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { BlocklistRow } from '../shared/blocklists.ts';
import type { Fail2banConnector } from './connectors/connector.ts';
import { toIso } from './dates.ts';
import type { Db } from './db/index.ts';
import { getHost } from './db/queries.ts';
import { blocklists } from './db/schema.ts';
import { AppError } from './errors.ts';
import { PRIVATE_RANGES, signedInIps } from './jailOps.ts';

type Blocklist = typeof blocklists.$inferSelect;

const REFRESH_MS = 6 * 3600_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_BYTES = 50 * 1024 * 1024;
// Past this a set is slow to load, and the list is likely not what was meant
export const MAX_ENTRIES = 500_000;
// A network wider than a /8 in a list is a mistake, or a trap
const MIN_PREFIX = 8;
const IPV4 = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?(?![\d.])/;

export const setName = (id: number) => `bvr-bl-${id}`;

export const toBlocklistRow = (b: Blocklist): BlocklistRow => ({
  id: b.id,
  name: b.name,
  url: b.url,
  enabled: b.enabled,
  set: setName(b.id),
  loadedAt: toIso(b.loadedAt),
  entries: b.entries,
  skipped: b.skipped,
  lastError: b.lastError,
});

// An IPv4 address or network as its first and last address, as numbers
function ipv4Range(cidr: string): [number, number] | null {
  const [address = '', prefix = '32'] = cidr.split('/');
  const octets = address.split('.').map(Number);
  const bits = Number(prefix);
  if (octets.length !== 4 || octets.some((o) => !(o >= 0 && o <= 255)) || !(bits >= 0 && bits <= 32)) return null;
  const base = octets.reduce((n, o) => n * 256 + o, 0);
  const size = 2 ** (32 - bits);
  const first = base - (base % size);
  return [first, first + size - 1];
}

// Keeps the IPv4 addresses and networks of a downloaded list. Leaves out what would cut off
// the LAN, the machine itself or a signed-in user, and networks too wide to be meant.
export function parseBlocklist(text: string, protectedIps: string[]) {
  const guarded = [...PRIVATE_RANGES, ...protectedIps.map((ip) => ip.replace(/^::ffff:/i, ''))]
    .map(ipv4Range)
    .filter((r) => r !== null);
  const entries = new Set<string>();
  let skipped = 0;
  for (const line of text.split('\n')) {
    const found = line.replace(/[#;].*$/, '').match(IPV4)?.[0];
    if (!found) continue;
    const range = ipv4Range(found);
    const tooWide = Number(found.split('/')[1] ?? 32) < MIN_PREFIX;
    if (!range || tooWide || guarded.some(([a, b]) => range[0] <= b && a <= range[1])) {
      skipped++;
      continue;
    }
    entries.add(found.replace(/\/32$/, ''));
  }
  return { entries: [...entries], skipped };
}

// The only data sent is the request itself: the list's site sees this server's address
async function download(url: string) {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch {
    throw new AppError('UNAVAILABLE', 'Download failed');
  }
  if (!res.ok || !res.body) throw new AppError('UNAVAILABLE', `The list answered HTTP ${res.status}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new AppError('UNAVAILABLE', 'The list is larger than 50 MB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const loading = new Set<number>();
// Turning a list off while it loads would see its rule come back
export const isLoading = (id: number) => loading.has(id);

// Downloads the list and swaps it into the firewall. The outcome is kept on the row either way.
export async function loadBlocklist(db: Db, connector: Fail2banConnector, list: Blocklist, protectedIps: string[]) {
  if (loading.has(list.id)) throw new AppError('CONFLICT', 'This list is already loading');
  loading.add(list.id);
  const save = (fields: Partial<Blocklist>) =>
    db.update(blocklists).set(fields).where(eq(blocklists.id, list.id)).returning().get();
  try {
    const { entries, skipped } = parseBlocklist(await download(list.url), protectedIps);
    if (!entries.length) throw new AppError('UNAVAILABLE', 'No IPv4 address or network found in the list');
    if (entries.length > MAX_ENTRIES) throw new AppError('UNAVAILABLE', `More than ${MAX_ENTRIES} entries`);
    await connector.loadBlocklist(setName(list.id), entries);
    return save({ loadedAt: new Date(), entries: entries.length, skipped, lastError: '' }) as Blocklist;
  } catch (err) {
    save({ lastError: err instanceof AppError ? err.message : 'Internal error' });
    throw err;
  } finally {
    loading.delete(list.id);
  }
}

// shortcut: enabled lists are downloaded again on each start (the kernel loses them on reboot),
// keep the last copy in DATA_DIR if a start without network must still restore them
export function startBlocklistRefresh(app: FastifyInstance) {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  async function round() {
    for (const { id } of app.db.select().from(blocklists).where(eq(blocklists.enabled, true)).all()) {
      // Read again: a list turned off while the previous one loaded must stay off
      const list = app.db.select().from(blocklists).where(eq(blocklists.id, id)).get();
      if (!list?.enabled) continue;
      try {
        const host = app.connect(getHost(app.db, list.hostId));
        const loaded = await loadBlocklist(app.db, host, list, signedInIps(app.db));
        app.log.info({ blocklist: list.id, entries: loaded.entries }, 'Blocklist loaded');
      } catch (err) {
        if (!stopped) app.log.warn({ blocklist: id, err }, 'Blocklist refresh failed');
      }
    }
    if (!stopped) timer = setTimeout(round, REFRESH_MS);
  }
  app.addHook('onReady', async () => {
    void round();
  });
  app.addHook('onClose', async () => {
    stopped = true;
    clearTimeout(timer);
  });
}

import { and, count, desc, eq, gte, lt, max, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { BanStats } from '../shared/fail2ban.ts';
import type { Fail2banConnector } from './connectors/connector.ts';
import type { Db } from './db/index.ts';
import { banEvents, hosts } from './db/schema.ts';
import { countByCountry, type Locate, located } from './geoip.ts';
import { type NewBan, notifyBans } from './notifications.ts';

const SYNC_MS = 60_000;
const PAGE = 2000;
// fail2ban writes a ban shortly after it happens, so jails can land slightly out of order.
// Rows read twice are dropped by the unique index.
const OVERLAP_S = 300;
const TOP = 10;
const MAX_THREATS = 100;

// Unix seconds `days` ago, 0 for days = 0 (no limit)
export const daysAgo = (days: number) => (days > 0 ? Math.floor(Date.now() / 1000) - days * 86400 : 0);

// notBefore: bans older than the retention are not imported, or each round would bring back what the purge removed
export async function syncBans(
  db: Db,
  connector: Fail2banConnector,
  hostId: number,
  notBefore = 0,
  onAdded?: (rows: NewBan[]) => void,
) {
  const latest = db
    .select({ at: max(banEvents.bannedAt) })
    .from(banEvents)
    .where(eq(banEvents.hostId, hostId))
    .get()?.at;
  const since = Math.max(latest ? latest - OVERLAP_S : 0, notBefore);
  let added = 0;
  for (let offset = 0; ; offset += PAGE) {
    const rows = await connector.bansSince(since, PAGE, offset);
    if (rows.length > 0) {
      const values = rows.map(({ timeofban, ...ban }) => ({ ...ban, hostId, bannedAt: timeofban }));
      const inserted = db.insert(banEvents).values(values).onConflictDoNothing().returning().all();
      added += inserted.length;
      if (inserted.length > 0) onAdded?.(inserted);
    }
    if (rows.length < PAGE) return added;
  }
}

export const purgeBans = (db: Db, hostId: number, before: number) =>
  db
    .delete(banEvents)
    .where(and(eq(banEvents.hostId, hostId), lt(banEvents.bannedAt, before)))
    .run().changes;

// Stopped with the app. An instance that cannot be read is retried on the next round.
export function startBanSync(app: FastifyInstance, historyDays: number) {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  async function round() {
    const cutoff = daysAgo(historyDays);
    for (const host of app.db.select().from(hosts).all()) {
      if (cutoff > 0) {
        const purged = purgeBans(app.db, host.id, cutoff);
        if (purged > 0) app.log.info({ hostId: host.id, purged }, 'Old bans purged');
      }
      try {
        const added = await syncBans(app.db, app.connect(host), host.id, cutoff, (rows) =>
          notifyBans(app.db, app.geo.locate, host.id, rows),
        );
        if (added > 0) app.log.info({ hostId: host.id, added }, 'Bans synced');
      } catch (err) {
        if (!stopped) app.log.warn({ hostId: host.id, err }, 'Ban sync failed');
      }
    }
    if (!stopped) timer = setTimeout(round, SYNC_MS);
  }
  app.addHook('onReady', async () => {
    void round();
  });
  app.addHook('onClose', async () => {
    stopped = true;
    clearTimeout(timer);
  });
}

// days = 0 covers everything: `since` is then 0, older than any ban
export function readBanStats(db: Db, hostId: number, days: number, locate: Locate): BanStats {
  const since = daysAgo(days);
  const inPeriod = and(eq(banEvents.hostId, hostId), gte(banEvents.bannedAt, since));
  const bans = count();
  const failures = sql<number>`SUM(${banEvents.failures})`;
  const slot = sql<number>`${banEvents.bannedAt} / 3600 * 3600`;

  // shortcut: every address of the period in memory for the country counts, fine up to a few
  // hundred thousand; past that, store the country with each ban and group in SQL
  const ipCounts = db
    .select({ ip: banEvents.ip, count: bans })
    .from(banEvents)
    .where(inPeriod)
    .groupBy(banEvents.ip)
    .orderBy(desc(bans))
    .all();
  return {
    totalBans: ipCounts.reduce((sum, row) => sum + row.count, 0),
    uniqueIps: ipCounts.length,
    topIps: located(locate, ipCounts.slice(0, TOP)),
    countries: countByCountry(locate, ipCounts),
    topJails: db
      .select({ jail: banEvents.jail, bans, failures })
      .from(banEvents)
      .where(inPeriod)
      .groupBy(banEvents.jail)
      .orderBy(desc(bans))
      .limit(TOP)
      .all(),
    slots: db.select({ at: slot, bans }).from(banEvents).where(inPeriod).groupBy(slot).orderBy(slot).all(),
  };
}

// Latest first, one address or all
export function readBanHistory(
  db: Db,
  hostId: number,
  { ip, limit }: { ip?: string | undefined; limit: number },
  locate: Locate,
) {
  const rows = db
    .select()
    .from(banEvents)
    .where(and(eq(banEvents.hostId, hostId), ip ? eq(banEvents.ip, ip) : undefined))
    .orderBy(desc(banEvents.bannedAt))
    .limit(limit)
    .all()
    .map(({ ip, jail, bannedAt, bantime, failures }) => ({
      ip,
      jail,
      bannedAt: new Date(bannedAt * 1000).toISOString(),
      bantime,
      failures,
    }));
  return located(locate, rows);
}

// Addresses that came back within the window: one ban alone is routine
export function readThreats(db: Db, hostId: number, hours: number, locate: Locate) {
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const bans = count();
  const lastBan = max(banEvents.bannedAt);
  return db
    .select({ ip: banEvents.ip, bans, jails: sql<string>`GROUP_CONCAT(DISTINCT ${banEvents.jail})`, lastBan })
    .from(banEvents)
    .where(and(eq(banEvents.hostId, hostId), gte(banEvents.bannedAt, since)))
    .groupBy(banEvents.ip)
    .having(gte(bans, 2))
    .orderBy(desc(bans))
    .limit(MAX_THREATS)
    .all()
    .map((row) => ({
      ip: row.ip,
      bans: row.bans,
      jails: row.jails.split(','),
      lastBanAt: new Date((row.lastBan ?? 0) * 1000).toISOString(),
      geo: locate(row.ip),
    }));
}

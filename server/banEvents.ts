import { and, count, countDistinct, desc, eq, gte, max, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { BanStats } from '../shared/fail2ban.ts';
import type { Fail2banConnector } from './connectors/connector.ts';
import type { Db } from './db/index.ts';
import { banEvents, hosts } from './db/schema.ts';

const SYNC_MS = 60_000;
const PAGE = 2000;
// fail2ban writes a ban shortly after it happens, so jails can land slightly out of order.
// Rows read twice are dropped by the unique index.
const OVERLAP_S = 300;
const TOP = 10;

export async function syncBans(db: Db, connector: Fail2banConnector, hostId: number) {
  const latest = db
    .select({ at: max(banEvents.bannedAt) })
    .from(banEvents)
    .where(eq(banEvents.hostId, hostId))
    .get()?.at;
  const since = latest ? latest - OVERLAP_S : 0;
  let added = 0;
  for (let offset = 0; ; offset += PAGE) {
    const rows = await connector.bansSince(since, PAGE, offset);
    if (rows.length > 0) {
      const values = rows.map(({ timeofban, ...ban }) => ({ ...ban, hostId, bannedAt: timeofban }));
      added += db.insert(banEvents).values(values).onConflictDoNothing().run().changes;
    }
    if (rows.length < PAGE) return added;
  }
}

// Stopped with the app. An instance that cannot be read is retried on the next round.
export function startBanSync(app: FastifyInstance) {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  async function round() {
    for (const host of app.db.select().from(hosts).all()) {
      try {
        const added = await syncBans(app.db, app.connect(host), host.id);
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
export function readBanStats(db: Db, hostId: number, days: number): BanStats {
  const since = days > 0 ? Math.floor(Date.now() / 1000) - days * 86400 : 0;
  const inPeriod = and(eq(banEvents.hostId, hostId), gte(banEvents.bannedAt, since));
  const bans = count();
  const failures = sql<number>`SUM(${banEvents.failures})`;
  const slot = sql<number>`${banEvents.bannedAt} / 3600 * 3600`;

  const totals = db
    .select({ totalBans: bans, uniqueIps: countDistinct(banEvents.ip) })
    .from(banEvents)
    .where(inPeriod)
    .get();
  return {
    totalBans: totals?.totalBans ?? 0,
    uniqueIps: totals?.uniqueIps ?? 0,
    topIps: db
      .select({ ip: banEvents.ip, count: bans })
      .from(banEvents)
      .where(inPeriod)
      .groupBy(banEvents.ip)
      .orderBy(desc(bans))
      .limit(TOP)
      .all(),
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

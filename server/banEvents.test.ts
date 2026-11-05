import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { purgeBans, readBanStats, readThreats, syncBans } from './banEvents.ts';
import type { RawBan } from './connectors/sqliteReader.ts';
import type { Db } from './db/index.ts';
import { banEvents, hosts } from './db/schema.ts';
import { noGeo } from './geoip.ts';
import { fakeConnector, openTestDb } from './test-utils.ts';

const NOW = Math.floor(Date.now() / 1000);
const ban = (ip: string, timeofban: number, jail = 'sshd'): RawBan => ({
  ip,
  jail,
  timeofban,
  bantime: 600,
  failures: 3,
});
// Same paging as the real reader
const source = (rows: RawBan[]) =>
  fakeConnector({
    bansSince: async (since, limit, offset) => rows.filter((r) => r.timeofban >= since).slice(offset, offset + limit),
  });

let db: Db;
beforeEach(() => {
  db = openTestDb();
});
afterEach(() => db.$client.close());

describe('ban sync', () => {
  it('imports everything once, then only what is new', async () => {
    const rows = [ban('203.0.113.1', NOW - 100), ban('203.0.113.2', NOW - 50)];
    expect(await syncBans(db, source(rows), 1)).toBe(2);
    expect(await syncBans(db, source(rows), 1)).toBe(0);
    rows.push(ban('203.0.113.3', NOW));
    expect(await syncBans(db, source(rows), 1)).toBe(1);
  });

  it('reads past one page', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ban('203.0.113.1', NOW - 5000 + i));
    expect(await syncBans(db, source(rows), 1)).toBe(2500);
  });

  it('asks from just before the latest ban, to catch late writes', async () => {
    const bansSince = vi.fn(async () => []);
    await syncBans(db, source([ban('203.0.113.1', NOW)]), 1);
    await syncBans(db, fakeConnector({ bansSince }), 1);
    expect(bansSince).toHaveBeenCalledWith(NOW - 300, 2000, 0);
  });

  it('keeps history after fail2ban purged it', async () => {
    await syncBans(db, source([ban('203.0.113.1', NOW - 90 * 86400), ban('203.0.113.2', NOW)]), 1);
    await syncBans(db, source([]), 1);
    expect(readBanStats(db, 1, 0, noGeo).totalBans).toBe(2);
  });

  it('removes the history with its instance', async () => {
    await syncBans(db, source([ban('203.0.113.1', NOW)]), 1);
    db.delete(hosts).run();
    expect(db.select().from(banEvents).all()).toEqual([]);
  });
});

describe('ban retention', () => {
  const rows = [ban('203.0.113.1', NOW - 400 * 86400), ban('203.0.113.2', NOW - 10)];

  it('purges bans older than the cutoff, for one instance', async () => {
    await syncBans(db, source(rows), 1);
    expect(purgeBans(db, 1, NOW - 365 * 86400)).toBe(1);
    expect(
      db
        .select()
        .from(banEvents)
        .all()
        .map((r) => r.ip),
    ).toEqual(['203.0.113.2']);
  });

  it('does not import what the purge would remove', async () => {
    expect(await syncBans(db, source(rows), 1, NOW - 365 * 86400)).toBe(1);
    expect(await syncBans(db, source(rows), 1, NOW - 365 * 86400)).toBe(0);
  });
});

describe('ban stats', () => {
  const twoHosts = async () => {
    const other = db
      .insert(hosts)
      .values({ name: 'b', socketPath: '/b', dbPath: '/b', confPath: '/b' })
      .returning()
      .get();
    await syncBans(
      db,
      source([
        ban('203.0.113.1', NOW - 60),
        ban('203.0.113.1', NOW - 3 * 86400),
        ban('203.0.113.2', NOW - 40 * 86400, 'nginx'),
      ]),
      1,
    );
    await syncBans(db, source([ban('198.51.100.1', NOW)]), other.id);
  };

  it('covers a period, for one instance', async () => {
    await twoHosts();
    const week = readBanStats(db, 1, 7, noGeo);
    expect(week).toMatchObject({
      totalBans: 2,
      uniqueIps: 1,
      topIps: [{ ip: '203.0.113.1', count: 2 }],
      topJails: [{ jail: 'sshd', bans: 2, failures: 6 }],
      // The whole history of the instance, not just the period
      firstBanAt: NOW - 40 * 86400,
    });
  });

  it('covers everything with hourly slots', async () => {
    await twoHosts();
    const all = readBanStats(db, 1, 0, noGeo);
    expect(all).toMatchObject({ totalBans: 3, uniqueIps: 2 });
    expect(all.slots).toHaveLength(3);
    expect(all.slots.every((s) => s.at % 3600 === 0)).toBe(true);
    expect(all.slots[0]?.at).toBeLessThan(all.slots[2]?.at ?? 0);
  });

  it('leaves the slots out when asked, totals unchanged', async () => {
    await twoHosts();
    const light = readBanStats(db, 1, 0, noGeo, false);
    expect(light).toMatchObject({ totalBans: 3, slots: [] });
    expect(light.topJails).toHaveLength(2);
  });

  it('is empty without bans', () => {
    expect(readBanStats(db, 1, 30, noGeo)).toEqual({
      totalBans: 0,
      uniqueIps: 0,
      topIps: [],
      countries: [],
      orgs: [],
      topJails: [],
      slots: [],
      firstBanAt: null,
    });
  });

  it('counts bans per country, unknown addresses left out', async () => {
    await twoHosts();
    const country: Record<string, string> = { '203.0.113.1': 'FR', '203.0.113.2': 'FR' };
    const locate = (ip: string) => (country[ip] ? { country: country[ip], asn: null, org: null } : null);
    const all = readBanStats(db, 1, 0, locate);
    expect(all.countries).toEqual([{ country: 'FR', bans: 3, ips: 2 }]);
    expect(all.topIps[0]?.geo).toEqual({ country: 'FR', asn: null, org: null });
  });
});

describe('threats', () => {
  it('keeps addresses that came back in the window, first and last ban', async () => {
    await syncBans(
      db,
      source([
        ban('203.0.113.1', NOW - 7200),
        ban('203.0.113.1', NOW - 60, 'recidive'),
        ban('203.0.113.2', NOW - 60),
        ban('203.0.113.3', NOW - 2 * 86400),
        ban('203.0.113.3', NOW - 60),
      ]),
      1,
    );
    const threats = readThreats(db, 1, 24, noGeo);
    expect(threats.map((t) => t.ip)).toEqual(['203.0.113.1']);
    expect(threats[0]?.jails.sort()).toEqual(['recidive', 'sshd']);
    expect(threats[0]?.firstBanAt).toBe(new Date((NOW - 7200) * 1000).toISOString());
    expect(threats[0]?.lastBanAt).toBe(new Date((NOW - 60) * 1000).toISOString());
  });
});

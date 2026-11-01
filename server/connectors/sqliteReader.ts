import Database from 'better-sqlite3';
import type { BanRow, BanStats } from '../../shared/fail2ban.ts';
import { AppError } from '../errors.ts';

// fail2ban.sqlite3 belongs to fail2ban: always opened read-only, never migrated.
// An unreadable database is an error, an empty list would read as "no bans".
function withDb<T>(dbPath: string, read: (db: Database.Database) => T) {
  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    return read(db);
  } catch {
    throw new AppError('UNAVAILABLE', 'fail2ban database not readable');
  } finally {
    db?.close();
  }
}

const FAILURES = `COALESCE(json_extract(data, '$.failures'), bancount)`;
const BAN_COLUMNS = `ip, jail, timeofban, bantime, ${FAILURES} AS failures`;
// A busy host can hold many active bans, the list stays bounded
const MAX_ACTIVE = 5000;

type RawBan = { ip: string; jail: string; timeofban: number; bantime: number; failures: number };

const toBanRow = ({ timeofban, ...ban }: RawBan): BanRow => ({
  ...ban,
  bannedAt: new Date(timeofban * 1000).toISOString(),
});

export const activeBans = (dbPath: string) =>
  withDb(dbPath, (db) => {
    const now = Math.floor(Date.now() / 1000);
    const rows = db
      .prepare(`SELECT ${BAN_COLUMNS} FROM bans
        WHERE bantime = -1 OR timeofban + bantime > ? ORDER BY timeofban DESC LIMIT ?`)
      .all(now, MAX_ACTIVE) as RawBan[];
    return rows.map(toBanRow);
  });

export const recentBans = (dbPath: string, limit: number) =>
  withDb(dbPath, (db) => {
    const rows = db.prepare(`SELECT ${BAN_COLUMNS} FROM bans ORDER BY timeofban DESC LIMIT ?`).all(limit) as RawBan[];
    return rows.map(toBanRow);
  });

// days <= 0 covers everything: `since` is then 0, older than any ban.
// shortcut: daily buckets only, add LogviewR's 30-minute slots with the 24h chart (step 11)
export const banStats = (dbPath: string, days: number): BanStats =>
  withDb(dbPath, (db) => {
    const since = days > 0 ? Math.floor(Date.now() / 1000) - days * 86400 : 0;
    const all = <T>(sql: string) => db.prepare(sql).all(since) as T[];
    const totals = db
      .prepare('SELECT COUNT(*) AS totalBans, COUNT(DISTINCT ip) AS uniqueIps FROM bans WHERE timeofban >= ?')
      .get(since) as { totalBans: number; uniqueIps: number };
    return {
      ...totals,
      topIps: all(`SELECT ip, COUNT(*) AS count FROM bans WHERE timeofban >= ?
        GROUP BY ip ORDER BY count DESC LIMIT 10`),
      topJails: all(`SELECT jail, COUNT(*) AS bans, SUM(${FAILURES}) AS failures FROM bans WHERE timeofban >= ?
        GROUP BY jail ORDER BY bans DESC LIMIT 10`),
      byHour: all(`SELECT CAST(strftime('%H', timeofban, 'unixepoch') AS INTEGER) AS hour,
        COUNT(*) AS bans, SUM(${FAILURES}) AS failures FROM bans WHERE timeofban >= ? GROUP BY hour ORDER BY hour`),
      byDay: all(`SELECT date(timeofban, 'unixepoch') AS date, COUNT(*) AS bans FROM bans WHERE timeofban >= ?
        GROUP BY date ORDER BY date`),
    };
  });

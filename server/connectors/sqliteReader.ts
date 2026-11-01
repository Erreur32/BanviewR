import Database from 'better-sqlite3';
import type { BanRow } from '../../shared/fail2ban.ts';
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

export type RawBan = { ip: string; jail: string; timeofban: number; bantime: number; failures: number };

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

export const bansSince = (dbPath: string, since: number, limit: number, offset: number) =>
  withDb(
    dbPath,
    (db) =>
      db
        .prepare(
          `SELECT ${BAN_COLUMNS} FROM bans WHERE timeofban >= ? AND ip IS NOT NULL ORDER BY timeofban, rowid LIMIT ? OFFSET ?`,
        )
        .all(since, limit, offset) as RawBan[],
  );

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

export type Db = ReturnType<typeof openDb>;

const migrationsFolder = join(import.meta.dirname, 'migrations');

export function openDb(file: string, localHost: { socketPath: string; dbPath: string }) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  // Only on an empty table: 'local' can be renamed or removed from the UI, it must not come back.
  // The last instance cannot be deleted, so this runs once.
  if (!db.select({ id: schema.hosts.id }).from(schema.hosts).limit(1).get()) {
    db.insert(schema.hosts)
      .values({ name: 'local', ...localHost })
      .run();
  }
  return db;
}

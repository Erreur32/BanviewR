import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const createdAt = () => integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`);

// A fail2ban instance driven by this UI. Only the local host exists in v0.1,
// the table is there so multi-host does not need a schema rewrite.
export const hosts = sqliteTable('hosts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  mode: text('mode', { enum: ['external', 'embedded'] })
    .notNull()
    .default('external'),
  socketPath: text('socket_path').notNull(),
  dbPath: text('db_path').notNull(),
  createdAt: createdAt(),
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'viewer'] }).notNull(),
  createdAt: createdAt(),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
});

// id is the SHA-256 of the cookie token, the token itself is never stored
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  ip: text('ip').notNull(),
  userAgent: text('user_agent').notNull(),
  createdAt: createdAt(),
});

// Failed login tracking, keyed by 'user:<name>' or 'ip:<address>'
export const loginAttempts = sqliteTable('login_attempts', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  firstAt: integer('first_at', { mode: 'timestamp' }).notNull(),
  lockedUntil: integer('locked_until', { mode: 'timestamp' }),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});

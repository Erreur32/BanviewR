import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { Role, Scope } from '../../shared/auth.ts';

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
  confPath: text('conf_path').notNull().default('/etc/fail2ban'),
  createdAt: createdAt(),
});

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['admin', 'viewer'] })
      .$type<Role>()
      .notNull(),
    // IANA time zone used to display dates, 'browser' follows the browser setting
    timezone: text('timezone').notNull().default('browser'),
    createdAt: createdAt(),
    lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
  },
  // 'admin' and 'Admin' are the same account
  (t) => [uniqueIndex('users_username_nocase').on(sql`lower(${t.username})`)],
);

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

// API tokens for scripts and MCP. Only the SHA-256 of the secret is stored.
export const apiTokens = sqliteTable('api_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  // First characters of the secret, shown in the UI to tell tokens apart
  prefix: text('prefix').notNull(),
  scopes: text('scopes', { mode: 'json' }).$type<Scope[]>().notNull(),
  // NULL = every instance, otherwise the allowed host ids
  hostIds: text('host_ids', { mode: 'json' }).$type<number[]>(),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
});

// Long-term copy of fail2ban's bans table, which fail2ban purges. fail2ban's rowids are not
// stable (VACUUM, purge), so a ban is identified by what it is.
export const banEvents = sqliteTable(
  'ban_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    hostId: integer('host_id')
      .notNull()
      .references(() => hosts.id, { onDelete: 'cascade' }),
    jail: text('jail').notNull(),
    ip: text('ip').notNull(),
    // Unix seconds, kept as a number for the SQL time buckets
    bannedAt: integer('banned_at').notNull(),
    bantime: integer('bantime').notNull(),
    failures: integer('failures').notNull(),
  },
  (t) => [
    uniqueIndex('ban_events_identity').on(t.hostId, t.jail, t.ip, t.bannedAt),
    index('ban_events_host_time').on(t.hostId, t.bannedAt),
  ],
);

// Every change made through the UI, the API or MCP
export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: createdAt(),
  actorType: text('actor_type', { enum: ['user', 'token', 'system'] }).notNull(),
  actorId: integer('actor_id'),
  actorName: text('actor_name').notNull(),
  hostId: integer('host_id').references(() => hosts.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  target: text('target'),
  ok: integer('ok', { mode: 'boolean' }).notNull(),
  detail: text('detail'),
  ip: text('ip').notNull(),
});

// Outgoing notifications, all created by an admin: nothing is sent while this table is empty.
// target holds a secret (webhook URL or bot token), never returned by the API.
export const webhooks = sqliteTable('webhooks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['generic', 'discord', 'telegram', 'mqtt'] }).notNull(),
  target: text('target').notNull(),
  chatId: text('chat_id'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  onBans: integer('on_bans', { mode: 'boolean' }).notNull().default(true),
  onActions: integer('on_actions', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
  lastSentAt: integer('last_sent_at', { mode: 'timestamp' }),
  // NULL: never sent, '': last send worked, otherwise the error
  lastError: text('last_error'),
});

// IP blocklists downloaded from a URL into an ipset dropped on input, per instance.
// Created disabled: nothing is downloaded until an admin enables one.
export const blocklists = sqliteTable('blocklists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostId: integer('host_id')
    .notNull()
    .references(() => hosts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
  loadedAt: integer('loaded_at', { mode: 'timestamp' }),
  // Entries in the firewall, and those left out (private ranges, signed-in users, too wide)
  entries: integer('entries').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  // NULL: never loaded, '': last load worked, otherwise the error
  lastError: text('last_error'),
});

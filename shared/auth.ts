import { z } from 'zod';

// Scopes are ordered: admin includes write, write includes read
export const scope = z.enum(['read', 'write', 'admin']);
export type Scope = z.infer<typeof scope>;

// operator bans, unbans and drives jails, admin also manages the app
export const role = z.enum(['admin', 'operator', 'viewer']);
export type Role = z.infer<typeof role>;

export const username = z
  .string()
  .regex(/^[a-zA-Z0-9._-]{3,32}$/, '3 to 32 characters: letters, digits, dot, dash, underscore');
// Upper bound keeps argon2 hashing cost bounded
export const password = z.string().min(10).max(256);

export const credentials = z.object({ username, password });

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
// 'browser' follows the browser time zone, anything else is an IANA name (Europe/Paris, UTC...)
export const timezone = z.union([z.literal('browser'), z.string().max(64).refine(isTimeZone, 'Unknown time zone')]);

export const userInfo = z.object({ id: z.number(), username: z.string(), role, timezone: z.string() });
export type UserInfo = z.infer<typeof userInfo>;

export const authStatus = z.object({
  ok: z.literal(true),
  setupRequired: z.boolean(),
  user: userInfo.nullable(),
});
export type AuthStatus = z.infer<typeof authStatus>;

export const userRow = userInfo.extend({
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
});
export type UserRow = z.infer<typeof userRow>;

export const tokenRow = z.object({
  id: z.number(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(scope),
  hostIds: z.array(z.number()).nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type TokenRow = z.infer<typeof tokenRow>;

export const createTokenBody = z
  .object({
    name: z.string().trim().min(1).max(64),
    scopes: z.array(scope).min(1),
    hostIds: z.array(z.number().int().positive()).min(1).nullable().default(null),
    expiresInDays: z.number().int().min(1).max(3650).nullable().default(null),
  })
  // admin manages users and tokens for every instance, so it cannot be limited to some of them
  .refine((t) => t.hostIds === null || !t.scopes.includes('admin'), {
    message: 'A token limited to some instances cannot have the admin scope',
    path: ['scopes'],
  });

export const auditRow = z.object({
  id: z.number(),
  at: z.string(),
  actorType: z.enum(['user', 'token', 'system']),
  actorName: z.string(),
  hostId: z.number().nullable(),
  action: z.string(),
  target: z.string().nullable(),
  ok: z.boolean(),
  detail: z.string().nullable(),
  ip: z.string(),
});
export type AuditRow = z.infer<typeof auditRow>;

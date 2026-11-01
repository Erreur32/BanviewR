import { and, eq, isNull, sql } from 'drizzle-orm';
import { AppError } from '../errors.ts';
import type { Db } from './index.ts';
import { apiTokens, hosts, users } from './schema.ts';

export function getHost(db: Db, id: number) {
  const host = db.select().from(hosts).where(eq(hosts.id, id)).get();
  if (!host) throw new AppError('NOT_FOUND', 'Instance not found');
  return host;
}

// Usernames are unique without regard to case (index users_username_nocase)
export const usernameIs = (name: string) => sql`lower(${users.username}) = lower(${name})`;

// Tokens die with the admin rights of whoever created them
export function revokeTokensCreatedBy(db: Db, userId: number) {
  return db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.createdBy, userId), isNull(apiTokens.revokedAt)))
    .run().changes;
}

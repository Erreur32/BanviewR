import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from './index.ts';
import { apiTokens, users } from './schema.ts';

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

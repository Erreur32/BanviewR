import { and, eq, lt, ne } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { sessions, users } from '../db/schema.ts';
import { newSecret, sha256 } from './crypto.ts';

export const SESSION_COOKIE = 'bvr_session';
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
// Sliding expiry: extended at most once a day, not on every request
const REFRESH_AFTER_MS = 24 * 3600 * 1000;

export function createSession(db: Db, userId: number, ip: string, userAgent: string) {
  const token = newSecret();
  db.insert(sessions)
    .values({
      id: sha256(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ip,
      userAgent: userAgent.slice(0, 256),
    })
    .run();
  return token;
}

export function resolveSession(db: Db, token: string) {
  const id = sha256(token);
  const row = db
    .select({ expiresAt: sessions.expiresAt, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .get();
  if (!row) return null;

  const now = Date.now();
  const remaining = row.expiresAt.getTime() - now;
  if (remaining <= 0) {
    deleteSession(db, id);
    return null;
  }
  const refreshed = remaining < SESSION_TTL_MS - REFRESH_AFTER_MS;
  if (refreshed) {
    db.update(sessions)
      .set({ expiresAt: new Date(now + SESSION_TTL_MS) })
      .where(eq(sessions.id, id))
      .run();
  }
  return { sessionId: id, user: row.user, refreshed };
}

export function deleteSession(db: Db, sessionId: string) {
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

export function deleteUserSessions(db: Db, userId: number, exceptSessionId?: string) {
  const byUser = eq(sessions.userId, userId);
  db.delete(sessions)
    .where(exceptSessionId ? and(byUser, ne(sessions.id, exceptSessionId)) : byUser)
    .run();
}

export function purgeExpiredSessions(db: Db) {
  db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();
}

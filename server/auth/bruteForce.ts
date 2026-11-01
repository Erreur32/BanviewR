import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { loginAttempts } from '../db/schema.ts';

// Same defaults as LogviewR, the IP limit is higher because of shared NAT addresses
const WINDOW_MS = 30 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
export const MAX_FAILURES = { user: 5, ip: 20 } as const;

export type AttemptKey = `user:${string}` | `ip:${string}`;

export function lockedUntil(db: Db, key: AttemptKey): Date | null {
  const row = db.select().from(loginAttempts).where(eq(loginAttempts.key, key)).get();
  return row?.lockedUntil && row.lockedUntil.getTime() > Date.now() ? row.lockedUntil : null;
}

export function recordFailure(db: Db, key: AttemptKey, max: number) {
  const now = new Date();
  const row = db.select().from(loginAttempts).where(eq(loginAttempts.key, key)).get();
  // A new window starts when the previous one is over or its lockout has expired
  const fresh = !row || now.getTime() - row.firstAt.getTime() > WINDOW_MS || row.lockedUntil !== null;
  const count = fresh ? 1 : row.count + 1;
  const values = {
    count,
    firstAt: fresh ? now : row.firstAt,
    lockedUntil: count >= max ? new Date(now.getTime() + LOCKOUT_MS) : null,
  };
  db.insert(loginAttempts)
    .values({ key, ...values })
    .onConflictDoUpdate({ target: loginAttempts.key, set: values })
    .run();
}

export function clearFailures(db: Db, key: AttemptKey) {
  db.delete(loginAttempts).where(eq(loginAttempts.key, key)).run();
}

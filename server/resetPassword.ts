import { eq } from 'drizzle-orm';
import { recordAudit } from './audit.ts';
import { clearFailures } from './auth/bruteForce.ts';
import { newSecret } from './auth/crypto.ts';
import { hashPassword } from './auth/password.ts';
import { deleteUserSessions } from './auth/sessions.ts';
import type { Db } from './db/index.ts';
import { usernameIs } from './db/queries.ts';
import { users } from './db/schema.ts';

// Forgotten password, with no mail to send a link: whoever has a shell on the server sets a
// one-time password, to be replaced at the next sign-in. Returns null for an unknown account.
export async function resetPassword(db: Db, username: string) {
  const user = db.select().from(users).where(usernameIs(username)).get();
  if (!user) return null;
  const password = newSecret().slice(0, 20);
  const passwordHash = await hashPassword(password);
  db.update(users).set({ passwordHash, mustChangePassword: true }).where(eq(users.id, user.id)).run();
  deleteUserSessions(db, user.id);
  clearFailures(db, `user:${user.username.toLowerCase()}`);
  recordAudit(
    db,
    { principal: null, ip: 'cli' },
    { action: 'user.update', ok: true, target: user.username, detail: 'password reset from the command line' },
  );
  return { username: user.username, password, disabled: user.disabledAt !== null };
}

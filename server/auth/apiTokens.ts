import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { apiTokens } from '../db/schema.ts';
import { newSecret, sha256 } from './crypto.ts';

const TOKEN_PREFIX = 'bvr_';
// lastUsedAt is informative, no need to write it on every request
const LAST_USED_RESOLUTION_MS = 60 * 1000;

export function generateApiToken() {
  const secret = TOKEN_PREFIX + newSecret();
  return { secret, tokenHash: sha256(secret), prefix: secret.slice(0, TOKEN_PREFIX.length + 6) };
}

export function resolveApiToken(db: Db, secret: string) {
  if (!secret.startsWith(TOKEN_PREFIX)) return null;
  const row = db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, sha256(secret)))
    .get();
  const now = Date.now();
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= now)) return null;

  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    db.update(apiTokens)
      .set({ lastUsedAt: new Date(now) })
      .where(eq(apiTokens.id, row.id))
      .run();
  }
  return row;
}

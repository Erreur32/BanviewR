import { desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { okResponse } from '../../shared/api.ts';
import { createTokenBody, tokenRow } from '../../shared/auth.ts';
import { audit } from '../audit.ts';
import { generateApiToken } from '../auth/apiTokens.ts';
import { toIso } from '../dates.ts';
import type { Db } from '../db/index.ts';
import { apiTokens, hosts } from '../db/schema.ts';
import { AppError } from '../errors.ts';
import { idParams, ok } from '../http.ts';

const toTokenRow = (t: typeof apiTokens.$inferSelect) => ({
  id: t.id,
  name: t.name,
  prefix: t.prefix,
  scopes: t.scopes,
  hostIds: t.hostIds,
  createdAt: t.createdAt.toISOString(),
  expiresAt: toIso(t.expiresAt),
  lastUsedAt: toIso(t.lastUsedAt),
  revokedAt: toIso(t.revokedAt),
});

function getToken(db: Db, id: number) {
  const token = db.select().from(apiTokens).where(eq(apiTokens.id, id)).get();
  if (!token) throw new AppError('NOT_FOUND', 'Token not found');
  return token;
}

// Token management needs a signed-in admin: a leaked admin token cannot mint new tokens
const ADMIN_SESSION = { access: 'admin', sessionOnly: true } as const;

export const tokenRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  app.get(
    '/tokens',
    {
      config: ADMIN_SESSION,
      schema: { response: { 200: okResponse({ tokens: z.array(tokenRow) }) } },
    },
    async () => ok({ tokens: db.select().from(apiTokens).orderBy(desc(apiTokens.id)).all().map(toTokenRow) }),
  );

  // The secret is returned once, only its hash is stored
  app.post(
    '/tokens',
    {
      config: ADMIN_SESSION,
      schema: {
        body: createTokenBody,
        response: { 200: okResponse({ token: tokenRow, secret: z.string() }) },
      },
    },
    async (req) => {
      const { name, scopes, hostIds, expiresInDays } = req.body;
      if (hostIds) {
        const known = db.select({ id: hosts.id }).from(hosts).where(inArray(hosts.id, hostIds)).all();
        if (known.length !== new Set(hostIds).size) throw new AppError('VALIDATION', 'Unknown instance id');
      }
      const { secret, tokenHash, prefix } = generateApiToken();
      const token = db
        .insert(apiTokens)
        .values({
          name,
          tokenHash,
          prefix,
          scopes: [...new Set(scopes)],
          hostIds,
          createdBy: req.principal?.id ?? null,
          expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86400 * 1000) : null,
        })
        .returning()
        .get();
      audit(req, { action: 'token.create', ok: true, target: name, detail: scopes.join(',') });
      return ok({ token: toTokenRow(token), secret });
    },
  );

  app.post(
    '/tokens/:id/revoke',
    { config: ADMIN_SESSION, schema: { params: idParams, response: { 200: okResponse() } } },
    async (req) => {
      const token = getToken(db, req.params.id);
      if (!token.revokedAt) {
        db.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.id, token.id)).run();
        audit(req, { action: 'token.revoke', ok: true, target: token.name });
      }
      return ok();
    },
  );

  // Only revoked tokens can be deleted, so an active token is never removed by mistake
  app.delete(
    '/tokens/:id',
    { config: ADMIN_SESSION, schema: { params: idParams, response: { 200: okResponse() } } },
    async (req) => {
      const token = getToken(db, req.params.id);
      if (!token.revokedAt) throw new AppError('CONFLICT', 'Revoke the token before deleting it');
      db.delete(apiTokens).where(eq(apiTokens.id, token.id)).run();
      audit(req, { action: 'token.delete', ok: true, target: token.name });
      return ok();
    },
  );
};

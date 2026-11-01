import { and, count, eq, ne, or } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { okResponse } from '../../shared/api.ts';
import { hostBody, hostPatch, hostRow } from '../../shared/hosts.ts';
import { audit } from '../audit.ts';
import { canAccessHost } from '../auth/access.ts';
import type { Db } from '../db/index.ts';
import { getHost } from '../db/queries.ts';
import { hosts } from '../db/schema.ts';
import { AppError } from '../errors.ts';
import { ADMIN_SESSION, CLIENT_RATE_LIMIT, hostParams, ok } from '../http.ts';

// Two rows on one socket would be the same fail2ban counted twice
function assertFree(db: Db, { name, socketPath }: { name: string; socketPath: string }, ignoreId = 0) {
  const taken = db
    .select({ id: hosts.id })
    .from(hosts)
    .where(and(or(eq(hosts.name, name), eq(hosts.socketPath, socketPath)), ne(hosts.id, ignoreId)))
    .get();
  if (taken) throw new AppError('CONFLICT', 'Name or socket already used by another instance');
}

export const hostRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  const toHostRow = async (host: typeof hosts.$inferSelect) => ({
    id: host.id,
    name: host.name,
    mode: host.mode,
    socketPath: host.socketPath,
    dbPath: host.dbPath,
    confPath: host.confPath,
    createdAt: host.createdAt.toISOString(),
    status: await app.connect(host).status(),
  });

  // Not under :hostId, so per-instance tokens are filtered here
  app.get(
    '/hosts',
    {
      config: { access: 'read', rateLimit: CLIENT_RATE_LIMIT },
      schema: { response: { 200: okResponse({ hosts: z.array(hostRow) }) } },
    },
    async (req) => {
      const visible = db
        .select()
        .from(hosts)
        .orderBy(hosts.id)
        .all()
        .filter((h) => req.principal && canAccessHost(req.principal, h.id));
      return ok({ hosts: await Promise.all(visible.map(toHostRow)) });
    },
  );

  app.get(
    '/hosts/:hostId',
    {
      config: { access: 'read', rateLimit: CLIENT_RATE_LIMIT },
      schema: { params: hostParams, response: { 200: okResponse({ host: hostRow }) } },
    },
    async (req) => ok({ host: await toHostRow(getHost(db, req.params.hostId)) }),
  );

  // Writes need a signed-in admin: these paths decide which socket and files the server
  // opens, a leaked token must not be able to repoint them
  app.post(
    '/hosts',
    {
      config: ADMIN_SESSION,
      schema: { body: hostBody, response: { 200: okResponse({ host: hostRow }) } },
    },
    async (req) => {
      assertFree(db, req.body);
      const host = db.insert(hosts).values(req.body).returning().get();
      audit(req, { action: 'host.create', ok: true, hostId: host.id, target: host.name });
      return ok({ host: await toHostRow(host) });
    },
  );

  app.patch(
    '/hosts/:hostId',
    {
      config: ADMIN_SESSION,
      schema: { params: hostParams, body: hostPatch, response: { 200: okResponse({ host: hostRow }) } },
    },
    async (req) => {
      const current = getHost(db, req.params.hostId);
      assertFree(db, { ...current, ...req.body }, current.id);
      const host = db.update(hosts).set(req.body).where(eq(hosts.id, current.id)).returning().get();
      audit(req, {
        action: 'host.update',
        ok: true,
        hostId: host.id,
        target: host.name,
        detail: Object.keys(req.body).join(','),
      });
      return ok({ host: await toHostRow(host) });
    },
  );

  // Only forgets the instance: fail2ban itself and its bans are not touched
  app.delete(
    '/hosts/:hostId',
    { config: ADMIN_SESSION, schema: { params: hostParams, response: { 200: okResponse() } } },
    async (req) => {
      const host = getHost(db, req.params.hostId);
      const total = db.select({ n: count() }).from(hosts).get()?.n ?? 0;
      if (total <= 1) throw new AppError('CONFLICT', 'The last instance cannot be removed');
      db.delete(hosts).where(eq(hosts.id, host.id)).run();
      // No hostId: the row is gone and the audit foreign key would refuse it
      audit(req, { action: 'host.delete', ok: true, target: host.name });
      return ok();
    },
  );
};

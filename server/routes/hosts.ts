import { and, count, eq, ne, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { okResponse } from '../../shared/api.ts';
import { type AgentInfo, type HostRow, hostBody, hostPatch, hostRow } from '../../shared/hosts.ts';
import { audit } from '../audit.ts';
import { canAccessHost } from '../auth/access.ts';
import { setName } from '../blocklists.ts';
import type { Db } from '../db/index.ts';
import { getHost } from '../db/queries.ts';
import { agents, blocklists, hosts } from '../db/schema.ts';
import { AppError } from '../errors.ts';
import { ADMIN_SESSION, CLIENT_RATE_LIMIT, hostParams, ok } from '../http.ts';

// Two rows on one socket would be the same fail2ban counted twice. Agent rows have no socket.
export function assertFree(db: Db, { name, socketPath }: { name: string; socketPath: string }, ignoreId = 0) {
  const sameSocket = socketPath ? eq(hosts.socketPath, socketPath) : undefined;
  const taken = db
    .select({ id: hosts.id })
    .from(hosts)
    .where(and(or(eq(hosts.name, name), sameSocket), ne(hosts.id, ignoreId)))
    .get();
  if (taken) throw new AppError('CONFLICT', 'Name or socket already used by another instance');
}

function agentInfo(app: FastifyInstance, hostId: number): AgentInfo | null {
  const row = app.db.select().from(agents).where(eq(agents.hostId, hostId)).get();
  if (!row) return null;
  const presence = app.agents.online(hostId);
  const codeExpires = row.enrollHash ? row.enrollExpiresAt : null;
  return {
    enrolled: row.secretHash !== null,
    online: presence !== null,
    version: presence?.version ?? row.version,
    write: presence?.write ?? row.writeEnabled,
    lastSeenAt: presence ? new Date().toISOString() : (row.lastSeenAt?.toISOString() ?? null),
    codeExpiresAt: codeExpires && codeExpires.getTime() > Date.now() ? codeExpires.toISOString() : null,
  };
}

export const toHostRow = async (app: FastifyInstance, host: typeof hosts.$inferSelect): Promise<HostRow> => ({
  id: host.id,
  name: host.name,
  mode: host.mode,
  socketPath: host.socketPath,
  dbPath: host.dbPath,
  confPath: host.confPath,
  createdAt: host.createdAt.toISOString(),
  status: await app.connect(host).status(),
  agent: host.mode === 'agent' ? agentInfo(app, host.id) : null,
});

export const hostRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;
  const toRow = (host: typeof hosts.$inferSelect) => toHostRow(app, host);

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
      return ok({ hosts: await Promise.all(visible.map(toRow)) });
    },
  );

  app.get(
    '/hosts/:hostId',
    {
      config: { access: 'read', rateLimit: CLIENT_RATE_LIMIT },
      schema: { params: hostParams, response: { 200: okResponse({ host: hostRow }) } },
    },
    async (req) => ok({ host: await toRow(getHost(db, req.params.hostId)) }),
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
      return ok({ host: await toRow(host) });
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
      // An agent knows its own paths
      if (current.mode === 'agent' && Object.keys(req.body).some((key) => key !== 'name')) {
        throw new AppError('BAD_REQUEST', 'Only the name of an agent instance can change');
      }
      assertFree(db, { ...current, ...req.body }, current.id);
      const host = db.update(hosts).set(req.body).where(eq(hosts.id, current.id)).returning().get();
      audit(req, {
        action: 'host.update',
        ok: true,
        hostId: host.id,
        target: host.name,
        detail: Object.keys(req.body).join(','),
      });
      return ok({ host: await toRow(host) });
    },
  );

  // Only forgets the instance: fail2ban itself and its bans are not touched. Its blocklists
  // are BanviewR's own, they leave the firewall with it.
  app.delete(
    '/hosts/:hostId',
    { config: ADMIN_SESSION, schema: { params: hostParams, response: { 200: okResponse() } } },
    async (req) => {
      const host = getHost(db, req.params.hostId);
      const total = db.select({ n: count() }).from(hosts).get()?.n ?? 0;
      if (total <= 1) throw new AppError('CONFLICT', 'The last instance cannot be removed');
      // shortcut: read-only agents hold no blocklist, drop them through the agent once it can write
      const lists =
        host.mode === 'agent' ? [] : db.select().from(blocklists).where(eq(blocklists.hostId, host.id)).all();
      for (const list of lists) await app.connect(host).dropBlocklist(setName(list.id));
      // Its agent row and secret go with it
      db.delete(hosts).where(eq(hosts.id, host.id)).run();
      app.agents.disconnect(host.id);
      // No hostId: the row is gone and the audit foreign key would refuse it
      audit(req, { action: 'host.delete', ok: true, target: host.name });
      return ok();
    },
  );
};

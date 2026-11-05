import { and, eq, gt } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { agentBody, enrollResult } from '../../shared/agents.ts';
import { okResponse } from '../../shared/api.ts';
import { hostRow } from '../../shared/hosts.ts';
import { audit } from '../audit.ts';
import { newSecret, sha256 } from '../auth/crypto.ts';
import { getHost } from '../db/queries.ts';
import { agents, hosts } from '../db/schema.ts';
import { AppError } from '../errors.ts';
import { ADMIN_SESSION, hostParams, ok } from '../http.ts';
import { assertFree, toHostRow } from './hosts.ts';

const ENROLL_TTL_MS = 15 * 60_000;
// Enrolment codes and agent secrets look different from API tokens, so a mixed-up paste fails at once
const CODE_PREFIX = 'bvre_';
const SECRET_PREFIX = 'bvra_';

// Adding an agent lets a machine feed this server: a signed-in admin who just typed their password
const SENSITIVE = { ...ADMIN_SESSION, recentAuth: true, rateLimit: { max: 10, timeWindow: '1 minute' } } as const;
// Public routes an attacker can hit: codes and secrets are 256-bit random, the limit keeps logs quiet
const ENROLL_LIMIT = { max: 5, timeWindow: '1 minute' };
const CONNECT_LIMIT = { max: 20, timeWindow: '1 minute' };

const codeResponse = { code: z.string(), expiresAt: z.string() };
const AGENT_ACTOR = { type: 'system', id: null, name: 'agent' } as const;

const bearer = (req: FastifyRequest, prefix: string) => {
  const header = req.headers.authorization ?? '';
  const value = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return value.startsWith(prefix) ? value : null;
};

export const agentRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  // A new code replaces the pending one, the enrolled secret stays valid until the code is used
  function newCode(hostId: number) {
    const code = CODE_PREFIX + newSecret();
    const expiresAt = new Date(Date.now() + ENROLL_TTL_MS);
    db.update(agents)
      .set({ enrollHash: sha256(code), enrollExpiresAt: expiresAt })
      .where(eq(agents.hostId, hostId))
      .run();
    return { code, expiresAt: expiresAt.toISOString() };
  }

  app.post(
    '/agents',
    {
      config: SENSITIVE,
      schema: { body: agentBody, response: { 200: okResponse({ host: hostRow, ...codeResponse }) } },
    },
    async (req) => {
      assertFree(db, { name: req.body.name, socketPath: '' });
      const host = db.transaction((tx) => {
        const row = tx
          .insert(hosts)
          .values({ name: req.body.name, mode: 'agent', socketPath: '', dbPath: '', confPath: '' })
          .returning()
          .get();
        tx.insert(agents).values({ hostId: row.id }).run();
        return row;
      });
      const code = newCode(host.id);
      audit(req, { action: 'agent.create', ok: true, hostId: host.id, target: host.name });
      return ok({ host: await toHostRow(app, host), ...code });
    },
  );

  app.post(
    '/agents/:hostId/code',
    {
      config: SENSITIVE,
      schema: { params: hostParams, response: { 200: okResponse(codeResponse) } },
    },
    async (req) => {
      const host = getHost(db, req.params.hostId);
      if (host.mode !== 'agent') throw new AppError('BAD_REQUEST', 'This instance has no agent');
      const code = newCode(host.id);
      audit(req, { action: 'agent.code', ok: true, hostId: host.id, target: host.name });
      return ok(code);
    },
  );

  // The agent trades its one-time code for its own secret. The code comes as a Bearer header:
  // no cookie, no body, nothing a browser would send on its own.
  app.post(
    '/agents/enroll',
    {
      config: { access: 'public', rateLimit: ENROLL_LIMIT },
      schema: { response: { 200: okResponse(enrollResult.shape) } },
    },
    async (req) => {
      const code = bearer(req, CODE_PREFIX);
      const row =
        code &&
        db
          .select()
          .from(agents)
          .where(and(eq(agents.enrollHash, sha256(code)), gt(agents.enrollExpiresAt, new Date())))
          .get();
      if (!row) {
        audit(req, { action: 'agent.enroll', ok: false, actor: AGENT_ACTOR, detail: 'Unknown or expired code' });
        throw new AppError('UNAUTHORIZED', 'Unknown or expired enrolment code');
      }
      const secret = SECRET_PREFIX + newSecret();
      db.update(agents)
        .set({ secretHash: sha256(secret), enrollHash: null, enrollExpiresAt: null, enrolledAt: new Date() })
        .where(eq(agents.hostId, row.hostId))
        .run();
      // An agent enrolled before with the old secret is cut off
      app.agents.disconnect(row.hostId);
      const host = getHost(db, row.hostId);
      audit(req, { action: 'agent.enroll', ok: true, actor: AGENT_ACTOR, hostId: host.id, target: host.name });
      return ok({ hostId: host.id, secret });
    },
  );

  // The agent's connection. The secret is checked before the upgrade: a wrong one gets a plain 401.
  const connecting = new WeakMap<FastifyRequest, number>();
  app.get(
    '/agents/connect',
    {
      websocket: true,
      config: { access: 'public', rateLimit: CONNECT_LIMIT },
      preValidation: async (req, reply) => {
        const secret = bearer(req, SECRET_PREFIX);
        const row =
          secret &&
          db
            .select()
            .from(agents)
            .where(eq(agents.secretHash, sha256(secret)))
            .get();
        if (!row) return reply.code(401).send();
        connecting.set(req, row.hostId);
      },
    },
    (socket, req) => {
      const hostId = connecting.get(req);
      if (hostId === undefined) return socket.close(4001, 'Unknown agent');
      app.agents.accept(hostId, socket);
    },
  );
};

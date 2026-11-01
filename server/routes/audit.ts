import { desc, lt } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { okResponse } from '../../shared/api.ts';
import { auditRow } from '../../shared/auth.ts';
import { auditLog } from '../db/schema.ts';
import { ok } from '../http.ts';

export const auditRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/audit',
    {
      config: { access: 'admin' },
      schema: {
        // Keyset pagination: pass the smallest id of the previous page as `before`
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(500).default(100),
          before: z.coerce.number().int().positive().optional(),
        }),
        response: { 200: okResponse({ entries: z.array(auditRow) }) },
      },
    },
    async (req) => {
      const { limit, before } = req.query;
      const rows = app.db
        .select()
        .from(auditLog)
        .where(before ? lt(auditLog.id, before) : undefined)
        .orderBy(desc(auditLog.id))
        .limit(limit)
        .all();
      return ok({ entries: rows.map(({ actorId: _, at, ...r }) => ({ ...r, at: at.toISOString() })) });
    },
  );
};

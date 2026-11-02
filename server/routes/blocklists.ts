import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { okResponse } from '../../shared/api.ts';
import { blocklistBody, blocklistRow } from '../../shared/blocklists.ts';
import { audit, audited } from '../audit.ts';
import { isLoading, loadBlocklist, setName, toBlocklistRow } from '../blocklists.ts';
import { getHost } from '../db/queries.ts';
import { blocklists } from '../db/schema.ts';
import { AppError } from '../errors.ts';
import { ADMIN_SESSION, hostParams, ok } from '../http.ts';
import { signedInIps } from '../jailOps.ts';

const listParams = hostParams.extend({ id: z.coerce.number().int().positive() });
// Changes write to the host firewall and download from the list's site
const CHANGE = { ...ADMIN_SESSION, rateLimit: { max: 20, timeWindow: '1 minute' } };
const rowResponse = okResponse({ blocklist: blocklistRow });

export const blocklistRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;
  const find = (hostId: number, id: number) => {
    const list = db
      .select()
      .from(blocklists)
      .where(and(eq(blocklists.id, id), eq(blocklists.hostId, hostId)))
      .get();
    if (!list) throw new AppError('NOT_FOUND', 'Blocklist not found');
    return list;
  };
  const idle = (id: number) => {
    if (isLoading(id)) throw new AppError('CONFLICT', 'This list is loading, try again in a moment');
  };
  const connector = (hostId: number) => app.connect(getHost(db, hostId));

  app.get(
    '/hosts/:hostId/blocklists',
    {
      config: { access: 'read' },
      schema: { params: hostParams, response: { 200: okResponse({ blocklists: z.array(blocklistRow) }) } },
    },
    async (req) => {
      getHost(db, req.params.hostId);
      const rows = db.select().from(blocklists).where(eq(blocklists.hostId, req.params.hostId)).all();
      return ok({ blocklists: rows.map(toBlocklistRow) });
    },
  );

  // Added off: nothing is downloaded until it is turned on
  app.post(
    '/hosts/:hostId/blocklists',
    { config: CHANGE, schema: { params: hostParams, body: blocklistBody, response: { 200: rowResponse } } },
    async (req) => {
      const { hostId } = req.params;
      getHost(db, hostId);
      const list = db
        .insert(blocklists)
        .values({ ...req.body, hostId })
        .returning()
        .get();
      audit(req, { action: 'blocklist.create', ok: true, hostId, target: list.name, detail: list.url });
      return ok({ blocklist: toBlocklistRow(list) });
    },
  );

  // On: downloads the list and loads it into the firewall now, then every 6 hours. Off: removes it.
  app.patch(
    '/hosts/:hostId/blocklists/:id',
    {
      config: CHANGE,
      schema: { params: listParams, body: z.object({ enabled: z.boolean() }), response: { 200: rowResponse } },
    },
    async (req) => {
      const { hostId, id } = req.params;
      const list = find(hostId, id);
      idle(id);
      const { enabled } = req.body;
      const entry = { action: enabled ? 'blocklist.enable' : 'blocklist.disable', hostId, target: list.name };
      await audited(db, req, entry, async () => {
        if (enabled) await loadBlocklist(db, connector(hostId), list, [...signedInIps(db), req.ip]);
        else await connector(hostId).dropBlocklist(setName(id));
      });
      const updated = db.update(blocklists).set({ enabled }).where(eq(blocklists.id, id)).returning().get();
      return ok({ blocklist: toBlocklistRow(updated as typeof list) });
    },
  );

  app.post(
    '/hosts/:hostId/blocklists/:id/refresh',
    { config: CHANGE, schema: { params: listParams, response: { 200: rowResponse } } },
    async (req) => {
      const { hostId, id } = req.params;
      const list = find(hostId, id);
      // Loading a list that is off would turn it on behind the switch
      if (!list.enabled) throw new AppError('CONFLICT', 'Turn the list on first');
      const loaded = await audited(db, req, { action: 'blocklist.refresh', hostId, target: list.name }, () =>
        loadBlocklist(db, connector(hostId), list, [...signedInIps(db), req.ip]),
      );
      return ok({ blocklist: toBlocklistRow(loaded) });
    },
  );

  app.delete(
    '/hosts/:hostId/blocklists/:id',
    { config: CHANGE, schema: { params: listParams, response: { 200: okResponse() } } },
    async (req) => {
      const { hostId, id } = req.params;
      const list = find(hostId, id);
      idle(id);
      await audited(db, req, { action: 'blocklist.delete', hostId, target: list.name }, async () => {
        await connector(hostId).dropBlocklist(setName(id));
        db.delete(blocklists).where(eq(blocklists.id, id)).run();
      });
      return ok();
    },
  );
};

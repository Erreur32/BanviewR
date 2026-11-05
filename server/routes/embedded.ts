import { eq, or } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { okResponse } from '../../shared/api.ts';
import { embeddedStatus } from '../../shared/hosts.ts';
import { audited } from '../audit.ts';
import { hosts } from '../db/schema.ts';
import { ADMIN_SESSION, CLIENT_RATE_LIMIT, ok } from '../http.ts';

// Starting fail2ban changes the firewall: a signed-in admin only, never a token
const CHANGE = { ...ADMIN_SESSION, rateLimit: { max: 10, timeWindow: '1 minute' } };
const response = { 200: okResponse({ embedded: embeddedStatus }) };

// One embedded fail2ban per BanviewR, so these routes have no :hostId. Its instance row is created
// on the first start and then reached like any other through /api/hosts/:hostId.
export const embeddedRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, embedded } = app;
  const { socketPath, dbPath, confDir } = embedded.paths;

  // A row added by hand on the same socket is the same fail2ban: it is reused
  const embeddedHost = () =>
    db
      .select()
      .from(hosts)
      .where(or(eq(hosts.mode, 'embedded'), eq(hosts.socketPath, socketPath)))
      .get();

  function ensureHost() {
    const values = { mode: 'embedded' as const, socketPath, dbPath, confPath: confDir };
    const row = embeddedHost();
    if (row) db.update(hosts).set(values).where(eq(hosts.id, row.id)).run();
    else
      db.insert(hosts)
        .values({ name: 'embedded', ...values })
        .run();
  }

  const status = () => ({ ...embedded.status(), hostId: embeddedHost()?.id ?? null });

  app.get('/embedded', { config: { ...ADMIN_SESSION, rateLimit: CLIENT_RATE_LIMIT }, schema: { response } }, async () =>
    ok({ embedded: status() }),
  );

  app.post('/embedded/start', { config: CHANGE, schema: { response } }, async (req) => {
    await audited(db, req, { action: 'embedded.start', hostId: embeddedHost()?.id, target: 'embedded' }, async () => {
      await embedded.start();
      try {
        ensureHost();
      } catch (err) {
        // Not left running without an instance to drive it
        await embedded.stop();
        throw err;
      }
    });
    return ok({ embedded: status() });
  });

  app.post('/embedded/stop', { config: CHANGE, schema: { response } }, async (req) => {
    await audited(db, req, { action: 'embedded.stop', hostId: embeddedHost()?.id, target: 'embedded' }, () =>
      embedded.stop(),
    );
    return ok({ embedded: status() });
  });
};

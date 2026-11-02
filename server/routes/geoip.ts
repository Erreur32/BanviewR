import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { okResponse } from '../../shared/api.ts';
import { geoDbStatus } from '../../shared/geoip.ts';
import { audited } from '../audit.ts';
import { ADMIN_SESSION, CLIENT_RATE_LIMIT, ok } from '../http.ts';

const statusResponse = okResponse({ databases: z.array(geoDbStatus) });

export const geoipRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/geoip',
    { config: { access: 'read', rateLimit: CLIENT_RATE_LIMIT }, schema: { response: { 200: statusResponse } } },
    async () => ok({ databases: app.geo.status() }),
  );

  // Reaches download.db-ip.com, so only a signed-in admin starts it
  app.post(
    '/geoip/download',
    {
      config: { ...ADMIN_SESSION, rateLimit: { max: 3, timeWindow: '10 minutes' } },
      schema: { response: { 200: statusResponse } },
    },
    async (req) => {
      await audited(app.db, req, { action: 'geoip.download', target: 'download.db-ip.com' }, () => app.geo.download());
      return ok({ databases: app.geo.status() });
    },
  );
};

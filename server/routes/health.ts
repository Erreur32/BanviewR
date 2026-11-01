import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import pkg from '../../package.json' with { type: 'json' };
import { apiResponse, healthResult } from '../../shared/api.ts';
import { ok } from '../http.ts';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      // Polled by the UI, kept out of the request log
      logLevel: 'warn',
      config: { access: 'public' },
      schema: { response: { 200: apiResponse(healthResult) } },
    },
    async () => ok({ version: pkg.version, uptime: Math.round(process.uptime()), fail2ban: app.detection }),
  );
};

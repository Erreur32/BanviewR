import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import pkg from '../../package.json' with { type: 'json' };
import { apiResponse, healthResult } from '../../shared/api.ts';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/health', { schema: { response: { 200: apiResponse(healthResult) } } }, async () => ({
    success: true as const,
    result: { ok: true, version: pkg.version, uptime: Math.round(process.uptime()) },
  }));
};

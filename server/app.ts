import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { LocalDetection } from '../shared/hosts.ts';
import { registerAccessControl } from './auth/access.ts';
import type { ConnectorFactory } from './connectors/connector.ts';
import type { Db } from './db/index.ts';
import { registerErrorHandling } from './errors.ts';
import type { GeoIp } from './geoip.ts';
import { registerOpenApi } from './openapi.ts';
import { auditRoutes } from './routes/audit.ts';
import { authRoutes } from './routes/auth.ts';
import { geoipRoutes } from './routes/geoip.ts';
import { healthRoutes } from './routes/health.ts';
import { hostRoutes } from './routes/hosts.ts';
import { jailRoutes } from './routes/jails.ts';
import { mcpRoutes } from './routes/mcp.ts';
import { tokenRoutes } from './routes/tokens.ts';
import { userRoutes } from './routes/users.ts';
import { webhookRoutes } from './routes/webhooks.ts';

export type AppDeps = { connect: ConnectorFactory; detection: LocalDetection; mcpWrite: boolean; geo: GeoIp };

declare module 'fastify' {
  interface FastifyInstance extends AppDeps {
    db: Db;
  }
}

export async function buildApp(db: Db, deps: AppDeps, opts: FastifyServerOptions = {}) {
  const app = Fastify(opts);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('db', db);
  app.decorate('connect', deps.connect);
  app.decorate('detection', deps.detection);
  app.decorate('mcpWrite', deps.mcpWrite);
  app.decorate('geo', deps.geo);
  app.addHook('onClose', async () => db.$client.close());
  registerErrorHandling(app);

  await app.register(helmet);
  // Per IP, auth routes set a stricter limit
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await registerAccessControl(app);
  await registerOpenApi(app);

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes);
      await api.register(userRoutes);
      await api.register(tokenRoutes);
      await api.register(auditRoutes);
      await api.register(hostRoutes);
      await api.register(jailRoutes);
      await api.register(mcpRoutes);
      await api.register(geoipRoutes);
      await api.register(webhookRoutes);
    },
    { prefix: '/api' },
  );
  return app;
}

import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { registerAccessControl } from './auth/access.ts';
import type { Db } from './db/index.ts';
import { registerErrorHandling } from './errors.ts';
import { registerOpenApi } from './openapi.ts';
import { auditRoutes } from './routes/audit.ts';
import { authRoutes } from './routes/auth.ts';
import { healthRoutes } from './routes/health.ts';
import { tokenRoutes } from './routes/tokens.ts';
import { userRoutes } from './routes/users.ts';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

export async function buildApp(db: Db, opts: FastifyServerOptions = {}) {
  const app = Fastify(opts);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('db', db);
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
    },
    { prefix: '/api' },
  );
  return app;
}

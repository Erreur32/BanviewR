import Fastify, { type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Db } from './db/index.ts';
import { registerErrorHandling } from './errors.ts';
import { healthRoutes } from './routes/health.ts';

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

  await app.register(healthRoutes, { prefix: '/api' });
  return app;
}

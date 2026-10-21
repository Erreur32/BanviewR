import Fastify, { type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { healthRoutes } from './routes/health.ts';

export async function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify(opts);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(healthRoutes, { prefix: '/api' });
  return app;
}

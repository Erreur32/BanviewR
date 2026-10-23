import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import pkg from '../package.json' with { type: 'json' };
import { SESSION_COOKIE } from './auth/sessions.ts';

export const DOCS_PREFIX = '/api/docs';

// Built from the zod schemas each route declares, plus its access level
export async function registerOpenApi(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'BanviewR API',
        version: pkg.version,
        description:
          'Every response is `{ success: true, result }`. Errors use HTTP 200 too, with `result: { ok: false, code, error }`.',
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', description: 'API token, scopes read, write or admin' },
          sessionCookie: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE },
        },
      },
    },
    transform: (input) => {
      const { schema, url } = jsonSchemaTransform(input);
      const { access = 'admin', sessionOnly } = input.route.config ?? {};
      const security: Record<string, string[]>[] =
        access === 'public' ? [] : sessionOnly ? [{ sessionCookie: [] }] : [{ bearerAuth: [] }, { sessionCookie: [] }];
      const tag = url.split('/')[2];
      return { schema: { ...schema, tags: tag ? [tag] : undefined, security, 'x-access': access }, url };
    },
  });

  // Same access as any read route: a signed-in user or a token with the read scope.
  // The UI plugin declares no route config, so it is set from an onRoute hook in this context.
  await app.register(async (docs) => {
    docs.addHook('onRoute', (route) => {
      route.config = { ...route.config, access: 'read' };
    });
    await docs.register(swaggerUi, {
      routePrefix: DOCS_PREFIX,
      staticCSP: true,
      // The app is often reached over plain HTTP on a LAN, where upgrading would block the UI assets
      transformStaticCSP: (header) => header.replace(/\s*upgrade-insecure-requests;?/, ''),
    });
  });
}

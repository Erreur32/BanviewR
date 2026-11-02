import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

// Serves the built web app (production, Docker). In development Vite does it.
export async function serveWebApp(app: FastifyInstance, root: string) {
  await app.register(async (web) => {
    // The page and its assets are public, the API behind them is not
    web.addHook('onRoute', (route) => {
      route.config = { ...route.config, access: 'public' };
    });
    // One route per built file: unknown paths reach the not-found handler, which serves index.html
    await web.register(fastifyStatic, { root, wildcard: false });
  });
}

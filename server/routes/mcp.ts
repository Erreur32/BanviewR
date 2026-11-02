import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { CLIENT_RATE_LIMIT } from '../http.ts';
import { buildMcpServer } from '../mcp/server.ts';

const MCP = { access: 'read', rateLimit: CLIENT_RATE_LIMIT } as const;

// Stateless: a server per request and no session, so every call is authenticated on its own.
// The body is a JSON-RPC message, validated by the MCP SDK.
export const mcpRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/mcp', { config: MCP, schema: { body: z.unknown() } }, async (req, reply) => {
    const { principal } = req;
    if (principal?.kind !== 'token') throw new AppError('FORBIDDEN', 'MCP needs an API token');
    const server = buildMcpServer({
      db: app.db,
      connect: app.connect,
      writeEnabled: app.mcpWrite,
      locate: app.geo.locate,
      caller: () => ({ principal, ip: req.ip }),
      logError: (err) => req.log.error(err),
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.raw.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    reply.hijack();
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  // No server-to-client stream and no session to delete. MCP clients expect a real 405 here.
  for (const method of ['GET', 'DELETE'] as const) {
    app.route({
      method,
      url: '/mcp',
      config: MCP,
      schema: { response: { 405: z.object({ error: z.string() }) } },
      handler: async (_, reply) => {
        reply.code(405);
        return { error: 'Stateless MCP endpoint, use POST' };
      },
    });
  }
};

import type { FastifyInstance, FastifyReply } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import type { ApiErrorCode, ApiErrorResult, ApiResponse } from '../shared/api.ts';

function sendError(reply: FastifyReply, code: ApiErrorCode, error: string) {
  const body: ApiResponse<ApiErrorResult> = { success: true, result: { ok: false, code, error } };
  // Bypass the route's response schema, which only describes the success shape
  return reply.code(200).serializer(JSON.stringify).send(body);
}

export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return sendError(reply, 'VALIDATION', err.message);
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status < 500) {
      return sendError(reply, 'BAD_REQUEST', (err as Error).message);
    }
    // Details stay in the server log, never in the response
    req.log.error(err);
    return sendError(reply, 'INTERNAL', 'Internal server error');
  });

  app.setNotFoundHandler((req, reply) => sendError(reply, 'NOT_FOUND', `Route ${req.method} ${req.url} not found`));
}

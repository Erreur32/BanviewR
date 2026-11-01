import type { FastifyInstance, FastifyReply } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import type { ApiErrorCode, ApiErrorResult, ApiResponse } from '../shared/api.ts';

// Expected failures thrown by routes and hooks, answered as { ok: false, code, error }
export class AppError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function sendError(reply: FastifyReply, code: ApiErrorCode, error: string) {
  const body: ApiResponse<ApiErrorResult> = { success: true, result: { ok: false, code, error } };
  // Bypass the route's response schema, which only describes the success shape
  return reply.code(200).serializer(JSON.stringify).send(body);
}

export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return sendError(reply, err.code, err.message);
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return sendError(reply, 'VALIDATION', err.message);
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 429) {
      return sendError(reply, 'RATE_LIMITED', 'Too many requests, retry later');
    }
    if (status < 500) {
      return sendError(reply, 'BAD_REQUEST', (err as Error).message);
    }
    // Details stay in the server log, never in the response
    req.log.error(err);
    return sendError(reply, 'INTERNAL', 'Internal server error');
  });

  app.setNotFoundHandler((req, reply) => sendError(reply, 'NOT_FOUND', `Route ${req.method} ${req.url} not found`));
}

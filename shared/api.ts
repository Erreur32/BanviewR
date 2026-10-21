import { z } from 'zod';

// Every API response is wrapped as { success: true, result }.
// Errors are reported inside result (ok: false), still with HTTP 200.
export const apiResponse = <T extends z.ZodType>(result: T) => z.object({ success: z.literal(true), result });

export type ApiResponse<T> = { success: true; result: T };

// Stable codes the web app can map to translated messages
export const apiErrorCode = z.enum(['VALIDATION', 'BAD_REQUEST', 'NOT_FOUND', 'INTERNAL']);
export type ApiErrorCode = z.infer<typeof apiErrorCode>;

export const apiErrorResult = z.object({
  ok: z.literal(false),
  code: apiErrorCode,
  error: z.string(),
});
export type ApiErrorResult = z.infer<typeof apiErrorResult>;

export const healthResult = z.object({
  ok: z.boolean(),
  version: z.string(),
  uptime: z.number(),
});
export type HealthResult = z.infer<typeof healthResult>;

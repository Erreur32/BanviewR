import { z } from 'zod';

// Every API response is wrapped as { success: true, result }.
// Errors are reported inside result (ok: false), still with HTTP 200.
export const apiResponse = <T extends z.ZodType>(result: T) => z.object({ success: z.literal(true), result });

export type ApiResponse<T> = { success: true; result: T };

export const healthResult = z.object({
  ok: z.boolean(),
  version: z.string(),
  uptime: z.number(),
});
export type HealthResult = z.infer<typeof healthResult>;

import { z } from 'zod';

// Builds a successful response body, the shape every route answers with
export const ok = <T extends object>(fields: T = {} as T) => ({
  success: true as const,
  result: { ok: true as const, ...fields },
});

export const idParams = z.object({ id: z.coerce.number().int().positive() });

// Routes a leaked admin token must not reach
export const ADMIN_SESSION = { access: 'admin', sessionOnly: true } as const;

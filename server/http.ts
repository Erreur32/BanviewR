import { z } from 'zod';

// Builds a successful response body, the shape every route answers with
export const ok = <T extends object>(fields: T = {} as T) => ({
  success: true as const,
  result: { ok: true as const, ...fields },
});

export const idParams = z.object({ id: z.coerce.number().int().positive() });

export const hostParams = z.object({ hostId: z.coerce.number().int().positive() });

// Every call starts fail2ban client processes on the server
export const CLIENT_RATE_LIMIT = { max: 60, timeWindow: '1 minute' };

// Routes a leaked admin token must not reach
export const ADMIN_SESSION = { access: 'admin', sessionOnly: true } as const;

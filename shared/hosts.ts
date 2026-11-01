import { z } from 'zod';

// Paths end up as process arguments and file accesses on the server
const absolutePath = z
  .string()
  .trim()
  .min(2)
  .max(512)
  .refine((p) => p.startsWith('/') && !p.includes('\0'), 'Absolute path expected');

export const hostBody = z.object({
  name: z.string().trim().min(1).max(64),
  socketPath: absolutePath,
  dbPath: absolutePath,
});

export const hostPatch = hostBody.partial().refine((p) => Object.keys(p).length > 0, 'Nothing to change');

export const hostStatus = z.object({
  reachable: z.boolean(),
  version: z.string().nullable(),
  error: z.enum(['CLIENT_MISSING', 'UNREACHABLE']).nullable(),
});
export type HostStatus = z.infer<typeof hostStatus>;

export const hostRow = z.object({
  id: z.number(),
  name: z.string(),
  mode: z.enum(['external', 'embedded']),
  socketPath: z.string(),
  dbPath: z.string(),
  createdAt: z.string(),
  status: hostStatus,
});
export type HostRow = z.infer<typeof hostRow>;

// What the startup check found on this machine. 'none' is where the embedded mode will be offered.
export const localDetection = z.object({
  mode: z.enum(['external', 'none']),
  reason: z.enum(['socket', 'process', 'service', 'none']),
});
export type LocalDetection = z.infer<typeof localDetection>;

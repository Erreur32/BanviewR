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
  confPath: absolutePath,
});

export const hostPatch = hostBody.partial().refine((p) => Object.keys(p).length > 0, 'Nothing to change');

export const hostStatus = z.object({
  reachable: z.boolean(),
  version: z.string().nullable(),
  // NO_SOCKET: nothing at the socket path, only the history and current bans of the database are read
  error: z.enum(['NO_SOCKET', 'CLIENT_MISSING', 'UNREACHABLE']).nullable(),
});
export type HostStatus = z.infer<typeof hostStatus>;

export const hostRow = z.object({
  id: z.number(),
  name: z.string(),
  mode: z.enum(['external', 'embedded']),
  socketPath: z.string(),
  dbPath: z.string(),
  confPath: z.string(),
  createdAt: z.string(),
  status: hostStatus,
});
export type HostRow = z.infer<typeof hostRow>;

// What the startup check found on this machine. 'none' is where the embedded mode will be offered.
export const localDetection = z.object({
  mode: z.enum(['external', 'none']),
  // mount: the host's fail2ban socket folder was replaced since the container started (see detect.ts)
  reason: z.enum(['socket', 'mount', 'process', 'service', 'none']),
});
export type LocalDetection = z.infer<typeof localDetection>;

// Why the embedded fail2ban cannot start here: outside a container, EMBEDDED_ALLOWED unset,
// or a host fail2ban found (never both at once)
export const embeddedBlock = z.enum(['NOT_CONTAINER', 'NOT_ALLOWED', 'HOST_FAIL2BAN']);
export type EmbeddedBlock = z.infer<typeof embeddedBlock>;

// The host firewall the embedded fail2ban writes to, found on each start: the same iptables backend as
// Docker's rules, or nftables. dockerUser: bans also go to Docker's DOCKER-USER chain (published ports).
export const embeddedFirewall = z.object({
  backend: z.enum(['iptables-nft', 'iptables-legacy', 'nftables']),
  dockerUser: z.boolean(),
  // DOCKER-USER also exists for IPv6 (Docker manages ip6tables)
  dockerUser6: z.boolean(),
});
export type EmbeddedFirewall = z.infer<typeof embeddedFirewall>;

// Where the embedded fail2ban would change the firewall: a VM (its own firewall, the hypervisor console
// as a way back), bare metal, or unknown (arm64 without a known VM name)
export const embeddedMachine = z.object({
  kind: z.enum(['vm', 'physical', 'unknown']),
  name: z.string().nullable(),
});
export type EmbeddedMachine = z.infer<typeof embeddedMachine>;

export const embeddedStatus = z.object({
  blockedBy: embeddedBlock.nullable(),
  // Started from the UI and not stopped since: it comes back with the container
  enabled: z.boolean(),
  running: z.boolean(),
  pid: z.number().nullable(),
  startedAt: z.string().nullable(),
  // Why it last stopped without being asked: it exited, or a host fail2ban appeared
  // or a trial start was not confirmed in time
  stopReason: z.enum(['EXITED', 'HOST_FAIL2BAN', 'TRIAL_EXPIRED']).nullable(),
  lastError: z.string().nullable(),
  confDir: z.string(),
  // null until the first start
  firewall: embeddedFirewall.nullable(),
  // The instance row driving it, created on the first start
  hostId: z.number().nullable(),
  // When an unconfirmed trial start stops on its own
  trialUntil: z.string().nullable(),
  // Public address of the admin who started it, never banned
  trustedIp: z.string().nullable(),
  machine: embeddedMachine,
  // false: the container has its own network, bans would not protect the machine
  hostNetwork: z.boolean(),
});
export type EmbeddedStatus = z.infer<typeof embeddedStatus>;

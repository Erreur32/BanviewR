import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3025),
  // Loopback by default: this UI drives the host firewall
  HOST: z.string().min(1).default('127.0.0.1'),
  // Proxies whose X-Forwarded-* headers are trusted (client IP, protocol).
  // 'loopback' covers the Vite dev proxy and a reverse proxy on the same machine.
  TRUST_PROXY: z.string().min(1).default('loopback'),
  DATA_DIR: z.string().min(1).default('./data'),
  // Seed values for the local host, editable later from the UI
  F2B_SOCKET: z.string().min(1).default('/var/run/fail2ban/fail2ban.sock'),
  F2B_DB: z.string().min(1).default('/var/lib/fail2ban/fail2ban.sqlite3'),
});

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
    process.exit(1);
  }
  const env = parsed.data;
  return {
    port: env.PORT,
    host: env.HOST,
    isDev: env.NODE_ENV !== 'production',
    trustProxy: env.TRUST_PROXY,
    dataDir: env.DATA_DIR,
    f2bSocket: env.F2B_SOCKET,
    f2bDb: env.F2B_DB,
  };
}

export const config = loadConfig();

// BanviewR agent: runs next to a fail2ban on another machine and serves it to a central BanviewR.
// It opens the connection itself (outbound only, nothing listens here) and only answers reads.
//   CENTRAL_URL   https://banviewr.example.org (the central's address, as in a browser)
//   ENROLL_CODE   one-time code from the central's Instances page, needed for the first start
// The secret it gets for that code is kept in DATA_DIR/agent-secret. A self-signed central:
// NODE_EXTRA_CA_CERTS=/data/central-ca.pem. Plain http only with AGENT_ALLOW_INSECURE=true (tests).
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pino } from 'pino';
import WebSocket from 'ws';
import { z } from 'zod';
import pkg from '../package.json' with { type: 'json' };
import { enrollResult } from '../shared/agents.ts';
import { answerCall } from './agentRpc.ts';
import { config } from './config.ts';
import { localConnector } from './connectors/local.ts';

const env = z
  .object({
    CENTRAL_URL: z.url({ protocol: /^https?$/ }),
    ENROLL_CODE: z.string().trim().min(1).optional(),
    AGENT_ALLOW_INSECURE: z.stringbool().default(false),
  })
  .parse(process.env);

const log = pino({ base: undefined });
const central = new URL(env.CENTRAL_URL);
if (central.protocol === 'http:' && !env.AGENT_ALLOW_INSECURE) {
  log.fatal('CENTRAL_URL must be https: the agent secret and the bans would cross the network in clear');
  process.exit(1);
}
const endpoint = (path: string) => new URL(path, central).toString();
const secretFile = join(config.dataDir, 'agent-secret');
const connector = localConnector(
  { socketPath: config.f2bSocket, dbPath: config.f2bDb, confPath: config.f2bConf },
  config.f2bClient,
);

const MAX_BACKOFF_MS = 60_000;
// The central pings every 30 s: past that without one, the link is dead
const SILENCE_MS = 75_000;

async function enroll(code: string) {
  const res = await fetch(endpoint('/api/agents/enroll'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${code}` },
    // Never follow the code to another address
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as { result?: { ok?: boolean; error?: string } };
  if (!body.result?.ok) throw new Error(body.result?.error ?? `Enrolment refused (HTTP ${res.status})`);
  const { secret, hostId } = enrollResult.parse(body.result);
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(secretFile, secret, { mode: 0o600 });
  // mode only applies to a new file: a re-enrolment overwrites the old one
  chmodSync(secretFile, 0o600);
  log.info({ hostId }, 'Enrolled with the central');
  return secret;
}

const savedSecret = () => (existsSync(secretFile) ? readFileSync(secretFile, 'utf8').trim() : null);

let backoff = 1000;
// A code set in the environment is tried once more if the saved secret is refused (re-enrolment)
let codeLeft = env.ENROLL_CODE;

function connect(secret: string) {
  const ws = new WebSocket(endpoint('/api/agents/connect').replace(/^http/, 'ws'), {
    headers: { Authorization: `Bearer ${secret}` },
    handshakeTimeout: 10_000,
    maxPayload: 1024 * 1024,
  });
  let refused = false;
  let silence: NodeJS.Timeout | undefined;
  const alive = () => {
    clearTimeout(silence);
    silence = setTimeout(() => ws.terminate(), SILENCE_MS);
  };

  ws.on('open', () => {
    backoff = 1000;
    alive();
    ws.send(JSON.stringify({ type: 'hello', version: pkg.version, write: false }));
    log.info({ central: central.origin }, 'Connected to the central');
  });
  ws.on('ping', alive);
  ws.on('message', async (data, isBinary) => {
    if (isBinary) return;
    const reply = await answerCall(connector, data);
    if (reply && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply));
  });
  ws.on('error', (err) => {
    refused = err.message.includes('401');
    log.warn({ err: err.message }, refused ? 'The central refused this agent secret' : 'Connection error');
  });
  ws.on('close', (code, reason) => {
    clearTimeout(silence);
    if (code === 4001) refused = true;
    if (reason.length > 0) log.info({ code, reason: reason.toString() }, 'Connection closed');
    void reconnect(secret, refused);
  });
}

async function reconnect(secret: string, refused: boolean) {
  let next = secret;
  if (refused && codeLeft) {
    const code = codeLeft;
    codeLeft = undefined;
    next = await enroll(code).catch((err: Error) => {
      log.warn({ err: err.message }, 'Enrolment with ENROLL_CODE failed');
      return secret;
    });
  }
  const wait = backoff;
  backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  setTimeout(() => connect(next), refused && next === secret ? MAX_BACKOFF_MS : wait);
}

async function main() {
  let secret = savedSecret();
  if (!secret) {
    if (!codeLeft) {
      log.fatal('Not enrolled: set ENROLL_CODE to the code shown on the central (Instances, Add an agent)');
      process.exit(1);
    }
    const code = codeLeft;
    codeLeft = undefined;
    secret = await enroll(code);
  }
  log.info({ version: pkg.version, socket: config.f2bSocket }, 'BanviewR agent starting (read-only)');
  connect(secret);
}

process.once('SIGTERM', () => process.exit(0));
process.once('SIGINT', () => process.exit(0));
main().catch((err: Error) => {
  log.fatal({ err: err.message }, 'Agent stopped');
  process.exit(1);
});

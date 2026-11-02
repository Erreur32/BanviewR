import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type Principal, tokenPrincipal } from '../auth/access.ts';
import { resolveApiToken } from '../auth/apiTokens.ts';
import { config } from '../config.ts';
import { localConnector } from '../connectors/local.ts';
import { openDb } from '../db/index.ts';
import { AppError } from '../errors.ts';
import { openGeoIp } from '../geoip.ts';
import { buildMcpServer } from './server.ts';

// Local MCP: same tools, tokens and audit log as HTTP. stdout carries the protocol, logs go to stderr.
const secret = process.env.BANVIEWR_TOKEN;
if (!secret) {
  console.error('BANVIEWR_TOKEN is required: an API token created in BanviewR');
  process.exit(1);
}

const db = openDb(join(config.dataDir, 'banviewr.db'), {
  socketPath: config.f2bSocket,
  dbPath: config.f2bDb,
  confPath: config.f2bConf,
});

function caller(): { principal: Principal; ip: string } {
  const token = resolveApiToken(db, secret as string);
  if (!token) throw new AppError('UNAUTHORIZED', 'API token invalid, revoked or expired');
  return { principal: tokenPrincipal(token), ip: '127.0.0.1' };
}

try {
  const server = buildMcpServer({
    db,
    connect: localConnector,
    writeEnabled: config.mcpWrite,
    locate: openGeoIp(join(config.dataDir, 'geoip')).locate,
    caller,
    logError: (err) => console.error(err),
  });
  await server.connect(new StdioServerTransport());
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

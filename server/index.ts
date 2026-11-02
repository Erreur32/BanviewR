import { join } from 'node:path';
import { buildApp } from './app.ts';
import { startBanSync } from './banEvents.ts';
import { config } from './config.ts';
import { detectLocalFail2ban } from './connectors/detect.ts';
import { localConnector } from './connectors/local.ts';
import { openDb } from './db/index.ts';
import { openGeoIp } from './geoip.ts';

const db = openDb(join(config.dataDir, 'banviewr.db'), {
  socketPath: config.f2bSocket,
  dbPath: config.f2bDb,
  confPath: config.f2bConf,
});

const detection = await detectLocalFail2ban(config.f2bSocket);

const app = await buildApp(
  db,
  { connect: localConnector, detection, mcpWrite: config.mcpWrite, geo: openGeoIp(join(config.dataDir, 'geoip')) },
  {
    trustProxy: config.trustProxy,
    logger: config.isDev
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } } }
      : true,
  },
);
app.log.info(detection, 'Local fail2ban detection');
startBanSync(app);

async function shutdown(signal: string) {
  app.log.info(`${signal} received, shutting down`);
  try {
    // Closes the HTTP server, then the database through the onClose hook
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

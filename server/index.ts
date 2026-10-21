import { join } from 'node:path';
import { buildApp } from './app.ts';
import { config } from './config.ts';
import { openDb } from './db/index.ts';

const db = openDb(join(config.dataDir, 'banviewr.db'), { socketPath: config.f2bSocket, dbPath: config.f2bDb });

const app = await buildApp(db, {
  logger: config.isDev
    ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } } }
    : true,
});

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

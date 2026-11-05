import { join } from 'node:path';
import { config } from './config.ts';
import { openDb } from './db/index.ts';
import { resetPassword } from './resetPassword.ts';

// docker exec -it banviewr node --import tsx server/cli.ts reset-password <username>
const [command, username] = process.argv.slice(2);
if (command !== 'reset-password' || !username) {
  process.stderr.write('Usage: server/cli.ts reset-password <username>\n');
  process.exit(2);
}

const db = openDb(join(config.dataDir, 'banviewr.db'), {
  socketPath: config.f2bSocket,
  dbPath: config.f2bDb,
  confPath: config.f2bConf,
});
const done = await resetPassword(db, username);
if (!done) {
  process.stderr.write(`No account named ${username}\n`);
  process.exit(1);
}
process.stdout.write(`One-time password for ${done.username}: ${done.password}\n`);
process.stdout.write('It must be changed at the next sign-in. Other sessions of this account are signed out.\n');
if (done.disabled) process.stdout.write('This account is disabled: an admin must enable it first.\n');

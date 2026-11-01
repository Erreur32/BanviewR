import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Fail2banConnector } from './connector.ts';

const run = promisify(execFile);
const TIMEOUT_MS = 5000;

// Talks to a fail2ban on this machine through its own client and the instance socket
export function localConnector(host: { socketPath: string }, client = 'fail2ban-client'): Fail2banConnector {
  return {
    async status() {
      try {
        // shortcut: no limit on concurrent clients, add one when the jail routes are ported (step 9)
        const { stdout } = await run(client, ['-s', host.socketPath, 'version'], { timeout: TIMEOUT_MS });
        return { reachable: true, version: stdout.trim(), error: null };
      } catch (err) {
        const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
        return { reachable: false, version: null, error: missing ? 'CLIENT_MISSING' : 'UNREACHABLE' };
      }
    },
  };
}

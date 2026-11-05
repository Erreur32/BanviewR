import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { LocalDetection } from '../../shared/hosts.ts';

const run = promisify(execFile);

// A socket we may not open still proves fail2ban is there. A stale file refuses
// the connection and does not count.
export function socketListens(path: string) {
  return new Promise<boolean>((resolve) => {
    const socket = connect(path);
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', (err: NodeJS.ErrnoException) => resolve(err.code === 'EACCES' || err.code === 'EPERM'));
  });
}

async function processRuns(procDir: string, ignorePids: number[]) {
  const entries = await readdir(procDir).catch(() => []);
  const commands = await Promise.all(
    entries
      // ignorePids: the embedded fail2ban-server is BanviewR's own, not a host one
      .filter((e) => /^\d+$/.test(e) && !ignorePids.includes(Number(e)))
      // Processes can exit between the listing and the read
      .map((pid) => readFile(join(procDir, pid, 'cmdline'), 'latin1').catch(() => '')),
  );
  // argv[0] when run directly, argv[1] through python. Later arguments are ignored,
  // otherwise `grep fail2ban-server` would count as a running server.
  return commands.some((cmd) =>
    cmd
      .split('\0')
      .slice(0, 2)
      .some((arg) => basename(arg) === 'fail2ban-server'),
  );
}

// LoadState, not is-active: a stopped service is still an installed fail2ban,
// and is-active answers 'inactive' for a unit that does not exist
async function serviceInstalled(systemctl: string) {
  try {
    const { stdout } = await run(systemctl, ['show', 'fail2ban', '--property=LoadState', '--value'], { timeout: 3000 });
    return stdout.trim() === 'loaded';
  } catch {
    return false;
  }
}

export async function detectLocalFail2ban(
  socketPath: string,
  { procDir = '/proc', systemctl = 'systemctl', ignorePids = [] as number[] } = {},
): Promise<LocalDetection> {
  if (await socketListens(socketPath)) return { mode: 'external', reason: 'socket' };
  if (await processRuns(procDir, ignorePids)) return { mode: 'external', reason: 'process' };
  if (await serviceInstalled(systemctl)) return { mode: 'external', reason: 'service' };
  return { mode: 'none', reason: 'none' };
}

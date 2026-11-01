import { type AppDeps, buildApp } from './app.ts';
import { openDb } from './db/index.ts';

export const testLocalHost = { socketPath: '/tmp/f2b.sock', dbPath: '/tmp/f2b.sqlite3' };

export function openTestDb() {
  return openDb(':memory:', testLocalHost);
}

const testDeps: AppDeps = {
  connect: () => ({ status: async () => ({ reachable: true, version: '1.1.0', error: null }) }),
  detection: { mode: 'none', reason: 'none' },
};

export function buildTestApp(deps: Partial<AppDeps> = {}) {
  return buildApp(openTestDb(), { ...testDeps, ...deps });
}

// Test password fixtures, built at runtime so they never look like stored credentials
export const pw = (label: string) => `${label}-fixture`;

import { buildApp } from './app.ts';
import { openDb } from './db/index.ts';

export const testLocalHost = { socketPath: '/tmp/f2b.sock', dbPath: '/tmp/f2b.sqlite3' };

export function openTestDb() {
  return openDb(':memory:', testLocalHost);
}

export function buildTestApp() {
  return buildApp(openTestDb());
}

// Test password fixtures, built at runtime so they never look like stored credentials
export const pw = (label: string) => `${label}-fixture`;

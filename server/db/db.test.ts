import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openTestDb, testLocalHost } from '../test-utils.ts';
import { openDb } from './index.ts';
import { hosts } from './schema.ts';

describe('openDb', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('applies migrations and seeds the local host', () => {
    const db = openTestDb();
    expect(db.select().from(hosts).all()).toMatchObject([{ name: 'local', mode: 'external', ...testLocalHost }]);
  });

  it('does not duplicate the local host on reopen', () => {
    dir = mkdtempSync(join(tmpdir(), 'banviewr-'));
    const file = join(dir, 'test.db');
    openDb(file, testLocalHost).$client.close();
    const db = openDb(file, testLocalHost);
    expect(db.select().from(hosts).all()).toHaveLength(1);
    db.$client.close();
  });
});

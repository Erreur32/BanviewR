import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './test-utils.ts';

const root = mkdtempSync(join(tmpdir(), 'web-'));
mkdirSync(join(root, 'assets'));
writeFileSync(join(root, 'index.html'), '<!doctype html><title>app</title>');
writeFileSync(join(root, 'assets', 'app.js'), 'console.info(1)');
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('built web app', () => {
  it('serves the page and assets without sign-in, app routes included, the API untouched', async () => {
    const app = await buildTestApp({ webRoot: root });
    const get = (url: string) => app.inject({ method: 'GET', url });
    expect((await get('/')).body).toContain('<title>app</title>');
    expect((await get('/assets/app.js')).statusCode).toBe(200);
    expect((await get('/hosts/1/ips/203.0.113.1')).body).toContain('<title>app</title>');
    expect((await get('/api/nothing')).json().result.code).toBe('NOT_FOUND');
    expect((await get('/api/hosts')).json().result.code).toBe('UNAUTHORIZED');
    expect((await get('/')).headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    await app.close();
  });
});

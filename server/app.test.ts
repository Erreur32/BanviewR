import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { buildTestApp } from './test-utils.ts';

describe('GET /api/health', () => {
  it('returns the wrapped health result', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, result: { ok: true, version: pkg.version } });
    await app.close();
  });
});

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiResponse } from '../shared/api.ts';
import { buildTestApp } from './test-utils.ts';

const SAME_ORIGIN = { host: 'bvr.test', origin: 'http://bvr.test' };

async function appWithTestRoutes() {
  const app = await buildTestApp();
  app.post(
    '/api/test/echo',
    {
      config: { access: 'public' },
      schema: {
        body: z.object({ name: z.string().min(2) }),
        response: { 200: apiResponse(z.object({ name: z.string() })) },
      },
    },
    async (req) => ({ success: true as const, result: req.body as { name: string } }),
  );
  app.get('/api/test/boom', { config: { access: 'public' } }, async () => {
    throw new Error('secret detail');
  });
  return app;
}

describe('error handling', () => {
  it('wraps schema validation errors', async () => {
    const app = await appWithTestRoutes();
    const res = await app.inject({
      method: 'POST',
      url: '/api/test/echo',
      headers: SAME_ORIGIN,
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, result: { ok: false, code: 'VALIDATION' } });
    await app.close();
  });

  it('wraps malformed JSON as a bad request', async () => {
    const app = await appWithTestRoutes();
    const res = await app.inject({
      method: 'POST',
      url: '/api/test/echo',
      headers: { ...SAME_ORIGIN, 'content-type': 'application/json' },
      payload: '{nope',
    });
    expect(res.json()).toMatchObject({ success: true, result: { ok: false, code: 'BAD_REQUEST' } });
    await app.close();
  });

  it('hides internal error details', async () => {
    const app = await appWithTestRoutes();
    const res = await app.inject({ method: 'GET', url: '/api/test/boom' });
    expect(res.json()).toEqual({
      success: true,
      result: { ok: false, code: 'INTERNAL', error: 'Internal server error' },
    });
    await app.close();
  });

  it('wraps unknown routes', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.json()).toMatchObject({ success: true, result: { ok: false, code: 'NOT_FOUND' } });
    await app.close();
  });
});

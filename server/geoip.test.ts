import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditLog } from './db/schema.ts';
import { openGeoIp } from './geoip.ts';
import { buildTestApp, pw } from './test-utils.ts';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('geoip', () => {
  it('answers nothing without databases', () => {
    dir = mkdtempSync(join(tmpdir(), 'geoip-'));
    const geo = openGeoIp(dir);
    expect(geo.locate('203.0.113.1')).toBeNull();
    expect(geo.status().map((s) => [s.kind, s.loaded, s.error])).toEqual([
      ['country', false, null],
      ['asn', false, null],
    ]);
  });

  it('reports a file it cannot read instead of failing', () => {
    dir = mkdtempSync(join(tmpdir(), 'geoip-'));
    writeFileSync(join(dir, 'country.mmdb'), 'not a database');
    const geo = openGeoIp(dir);
    const [country] = geo.status();
    expect(country?.loaded).toBe(false);
    expect(country?.error).toBeTruthy();
    expect(geo.locate('203.0.113.1')).toBeNull();
  });
});

describe('geoip routes', () => {
  const ORIGIN = { host: 'bvr.test', origin: 'http://bvr.test' };

  it('downloads only for a signed-in admin, with an audit entry', async () => {
    const geo = { ...openGeoIp(null), download: vi.fn(async () => {}) };
    const app = await buildTestApp({ geo });
    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: ORIGIN,
      payload: { username: 'admin', password: pw('geoip-admin') },
    });
    const cookie = `bvr_session=${setup.cookies.find((c) => c.name === 'bvr_session')?.value}`;
    const asAdmin = (method: 'GET' | 'POST', url: string, payload?: object) =>
      app.inject({ method, url, headers: { ...ORIGIN, cookie }, payload }).then((r) => r.json().result);

    expect((await asAdmin('GET', '/api/geoip')).databases).toHaveLength(2);

    const { secret } = await asAdmin('POST', '/api/tokens', { name: 't', scopes: ['admin'] });
    const byToken = await app.inject({
      method: 'POST',
      url: '/api/geoip/download',
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(byToken.json().result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(geo.download).not.toHaveBeenCalled();

    expect((await asAdmin('POST', '/api/geoip/download')).ok).toBe(true);
    expect(geo.download).toHaveBeenCalledOnce();
    const actions = app.db
      .select()
      .from(auditLog)
      .all()
      .map((e) => e.action);
    expect(actions).toContain('geoip.download');
    await app.close();
  });
});

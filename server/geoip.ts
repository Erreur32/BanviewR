import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { type AsnResponse, type CountryResponse, Reader } from 'mmdb-lib';
import type { CountryCount, GeoDbStatus, IpGeo } from '../shared/geoip.ts';
import { AppError } from './errors.ts';

const KINDS = ['country', 'asn'] as const;
type Kind = (typeof KINDS)[number];
type Slot = { reader: Reader<CountryResponse & AsnResponse> | null; mtimeMs: number; error: string | null };

// A file dropped or downloaded is picked up without a restart, by the stdio MCP process too
const RECHECK_MS = 60_000;
const DBIP_URL = 'https://download.db-ip.com/free';
const DOWNLOAD_TIMEOUT_MS = 120_000;
// The Lite files weigh about 5 MB packed and 10 MB unpacked
const MAX_PACKED = 50 * 1024 * 1024;
const MAX_UNPACKED = 200 * 1024 * 1024;

export type Locate = (ip: string) => IpGeo;
export const noGeo: Locate = () => null;
export const located = <T extends { ip: string }>(locate: Locate, rows: T[]) =>
  rows.map((row) => ({ ...row, geo: locate(row.ip) }));

// DB-IP publishes early in the month: the current file may not be out yet
async function fetchDbIp(kind: Kind, now: Date) {
  for (const back of [0, 1]) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7);
    const res = await fetch(`${DBIP_URL}/dbip-${kind}-lite-${month}.mmdb.gz`, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new AppError('UNAVAILABLE', `DB-IP answered HTTP ${res.status}`);
    const packed = Buffer.from(await res.arrayBuffer());
    if (packed.length > MAX_PACKED) throw new AppError('UNAVAILABLE', 'DB-IP file larger than expected');
    return gunzipSync(packed, { maxOutputLength: MAX_UNPACKED });
  }
  throw new AppError('UNAVAILABLE', `No DB-IP ${kind} file for this month or the previous one`);
}

// Reads <dir>/country.mmdb and <dir>/asn.mmdb, DB-IP Lite or MaxMind GeoLite2. null dir: no lookup at all.
export function openGeoIp(dir: string | null) {
  const slots = new Map<Kind, Slot>();
  let checkedAt = 0;
  const file = (kind: Kind) => join(dir ?? '', `${kind}.mmdb`);

  function refresh(force = false) {
    if (!dir || (!force && Date.now() - checkedAt < RECHECK_MS)) return;
    checkedAt = Date.now();
    for (const kind of KINDS) {
      let mtimeMs: number;
      try {
        mtimeMs = statSync(file(kind)).mtimeMs;
      } catch {
        slots.delete(kind);
        continue;
      }
      if (slots.get(kind)?.mtimeMs === mtimeMs) continue;
      try {
        slots.set(kind, { reader: new Reader(readFileSync(file(kind))), mtimeMs, error: null });
      } catch (err) {
        // Shown to read tokens too: an fs error message would carry the server path
        const code = (err as NodeJS.ErrnoException).code;
        slots.set(kind, { reader: null, mtimeMs, error: code ?? 'Not a valid MMDB file' });
      }
    }
  }

  const get = (kind: Kind, ip: string) => {
    try {
      return slots.get(kind)?.reader?.get(ip) ?? null;
    } catch {
      // An IPv6 address against an IPv4-only file
      return null;
    }
  };

  const locate: Locate = (ip) => {
    refresh();
    // A network has no single place
    if (isIP(ip) === 0) return null;
    const country = get('country', ip)?.country?.iso_code ?? null;
    const as = get('asn', ip);
    if (!country && !as) return null;
    return { country, asn: as?.autonomous_system_number ?? null, org: as?.autonomous_system_organization ?? null };
  };

  function status(): GeoDbStatus[] {
    refresh(true);
    return KINDS.map((kind) => {
      const slot = slots.get(kind);
      const meta = slot?.reader?.metadata;
      return {
        kind,
        loaded: Boolean(meta),
        type: meta?.databaseType ?? null,
        builtAt: meta ? meta.buildEpoch.toISOString() : null,
        error: slot?.error ?? null,
      };
    });
  }

  let downloading: Promise<void> | null = null;
  async function fetchAll() {
    const target = dir as string;
    mkdirSync(target, { recursive: true });
    for (const kind of KINDS) {
      const data = await fetchDbIp(kind, new Date());
      // Must open before it replaces a working file
      new Reader(data);
      writeFileSync(`${file(kind)}.tmp`, data);
      renameSync(`${file(kind)}.tmp`, file(kind));
    }
  }

  // Only on an admin's request: the one outgoing call, to download.db-ip.com, carries no ban data
  async function download() {
    if (!dir) throw new AppError('UNAVAILABLE', 'GeoIP is not set up on this server');
    downloading ??= fetchAll()
      .catch((err) => {
        if (err instanceof AppError) throw err;
        throw new AppError('UNAVAILABLE', `GeoIP download failed: ${err instanceof Error ? err.message : err}`);
      })
      .finally(() => {
        downloading = null;
      });
    await downloading;
    refresh(true);
  }

  return { locate, status, download };
}

export type GeoIp = ReturnType<typeof openGeoIp>;

// Bans per country, addresses with no known country left out
export function countByCountry(locate: Locate, ipCounts: { ip: string; count: number }[]): CountryCount[] {
  const countries = new Map<string, CountryCount>();
  for (const { ip, count } of ipCounts) {
    const country = locate(ip)?.country;
    if (!country) continue;
    const row = countries.get(country) ?? { country, bans: 0, ips: 0 };
    row.bans += count;
    row.ips += 1;
    countries.set(country, row);
  }
  return [...countries.values()].sort((a, b) => b.bans - a.bans);
}

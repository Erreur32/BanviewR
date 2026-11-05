import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import type { LocatedBan, ThreatRow } from '../../shared/fail2ban.ts';
import { api } from '../api.ts';
import { useFormatDateTime } from '../auth.ts';
import { HostSwitch } from '../components/HostSwitch.tsx';
import { IpOrigin, useCountryName } from '../components/IpOrigin.tsx';
import { Card, ErrorText, Segmented, Table, TextField } from '../components/ui.tsx';
import { LEVEL_STYLE, SEVERITY_LEVELS, severityOf } from '../dashboard.ts';
import { errorText } from '../errors.ts';
import { bansKey, IpLink } from './JailsPage.tsx';

const WINDOWS = { day: 24, week: 168, month: 720 } as const;
type Period = keyof typeof WINDOWS;
type Level = 'all' | (typeof SEVERITY_LEVELS)[number];
// Same cap as the API: the most frequent addresses come first
const MAX_ROWS = 100;
const REFRESH_MS = 60_000;
const isIp = (value: string) => z.union([z.ipv4(), z.ipv6()]).safeParse(value).success;

function HostAddresses({ hostId }: { hostId: number }) {
  const { t } = useTranslation();
  const formatDate = useFormatDateTime();
  const countryName = useCountryName();
  const [period, setPeriod] = useState<Period>('week');
  const [level, setLevel] = useState<Level>('all');
  const [search, setSearch] = useState('');
  const threats = useQuery({
    queryKey: ['hosts', hostId, 'threats', WINDOWS[period]],
    queryFn: () => api.get<{ threats: ThreatRow[] }>(`/hosts/${hostId}/threats?hours=${WINDOWS[period]}`),
    refetchInterval: REFRESH_MS,
  });
  const active = useQuery({
    queryKey: bansKey(hostId),
    queryFn: () => api.get<{ bans: LocatedBan[] }>(`/hosts/${hostId}/bans`),
    refetchInterval: REFRESH_MS,
  });
  const bannedNow = new Set(active.data?.bans.map((b) => b.ip));
  const rows = threats.data?.threats ?? [];
  const counts = Object.fromEntries(SEVERITY_LEVELS.map((l) => [l, rows.filter((r) => severityOf(r) === l).length]));
  const needle = search.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (level === 'all' || severityOf(r) === level) &&
      (!needle ||
        r.ip.includes(needle) ||
        r.jails.some((j) => j.toLowerCase().includes(needle)) ||
        (r.geo?.country && countryName(r.geo.country).toLowerCase().includes(needle)) ||
        r.geo?.org?.toLowerCase().includes(needle)),
  );
  const typed = search.trim();

  return (
    <>
      <div className="flex flex-wrap items-end gap-4">
        <Segmented
          label={t('addresses.window')}
          options={(Object.keys(WINDOWS) as Period[]).map((value) => ({
            value,
            label: t(`addresses.windows.${value}`),
          }))}
          value={period}
          onChange={setPeriod}
        />
        <div className="w-full max-w-sm [&>div]:mb-0">
          <TextField
            label={t('addresses.search')}
            placeholder={t('addresses.searchHint')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      {isIp(typed) && (
        <p className="text-sm">
          <Link
            to="/hosts/$hostId/ips/$ip"
            params={{ hostId: String(hostId), ip: typed }}
            className="text-accent hover:underline"
          >
            {t('addresses.open', { ip: typed })}
          </Link>
        </p>
      )}
      <ErrorText>{threats.error && errorText(t, threats.error)}</ErrorText>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <button
          type="button"
          aria-pressed={level === 'all'}
          onClick={() => setLevel('all')}
          className={`rounded-md border px-3 py-2 text-left ${level === 'all' ? 'border-text' : 'border-border'} bg-bg1`}
        >
          <span className="block text-xs text-muted">{t('addresses.all')}</span>
          <span className="text-xl font-bold tabular-nums">{rows.length}</span>
        </button>
        {SEVERITY_LEVELS.filter((l) => l !== 'info').map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={level === l}
            onClick={() => setLevel(level === l ? 'all' : l)}
            className={`rounded-md px-3 py-2 text-left outline-offset-2 ${LEVEL_STYLE[l]} ${level === l ? 'outline outline-2 outline-text' : ''}`}
          >
            <span className="block text-xs font-bold uppercase tracking-wider">{t(`dashboard.levels.${l}`)}</span>
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-xl font-bold tabular-nums">{counts[l]}</span>
              <span className="text-[11px] opacity-85">{t(`dashboard.levelRules.${l}`)}</span>
            </span>
          </button>
        ))}
      </div>

      {threats.isPending && <p className="text-muted">{t('common.loading')}</p>}
      {threats.data &&
        (shown.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">{rows.length ? t('addresses.noMatch') : t('addresses.empty')}</p>
          </Card>
        ) : (
          <Table
            columns={[
              t('addresses.level'),
              t('jails.ip'),
              t('geoip.origin'),
              t('jails.banned'),
              t('addresses.jails'),
              t('addresses.first'),
              t('addresses.last'),
              t('addresses.now'),
            ]}
          >
            {shown.map((row) => {
              const l = severityOf(row);
              return (
                <tr key={row.ip}>
                  <td>
                    <span className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase ${LEVEL_STYLE[l]}`}>
                      {t(`dashboard.levels.${l}`)}
                    </span>
                  </td>
                  <td className="font-mono text-xs">
                    <IpLink hostId={hostId} ip={row.ip} />
                  </td>
                  <td>
                    <IpOrigin geo={row.geo} />
                  </td>
                  <td className="font-mono">{row.bans}</td>
                  <td className="text-xs text-muted">{row.jails.join(', ')}</td>
                  <td className="whitespace-nowrap text-xs text-muted">{formatDate(row.firstBanAt)}</td>
                  <td className="whitespace-nowrap text-xs text-muted">{formatDate(row.lastBanAt)}</td>
                  <td className="text-xs">
                    {bannedNow.has(row.ip) ? (
                      <span className="text-danger">{t('addresses.bannedNow')}</span>
                    ) : (
                      <span className="text-muted">{t('addresses.free')}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        ))}
      {rows.length >= MAX_ROWS && <p className="text-xs text-muted">{t('addresses.capped', { count: MAX_ROWS })}</p>}
    </>
  );
}

export function AddressesPage() {
  const { t } = useTranslation();
  return (
    <div className="max-w-7xl space-y-4">
      <h1 className="text-xl font-semibold">{t('addresses.title')}</h1>
      <p className="text-sm text-muted">{t('addresses.intro')}</p>
      <HostSwitch>{(hostId) => <HostAddresses key={hostId} hostId={hostId} />}</HostSwitch>
    </div>
  );
}

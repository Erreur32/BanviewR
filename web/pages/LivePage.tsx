import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocatedBan } from '../../shared/fail2ban.ts';
import { api } from '../api.ts';
import { useCurrentUser, useFormatDateTime } from '../auth.ts';
import { BarAxis, jailColors, Legend, StackedBars, Swatch } from '../components/charts.tsx';
import { HostSwitch } from '../components/HostSwitch.tsx';
import { IpOrigin } from '../components/IpOrigin.tsx';
import { Button, Card, ErrorText, Table } from '../components/ui.tsx';
import { errorText } from '../errors.ts';
import { banKey, mergeFeed, minuteColumns } from '../live.ts';
import { bansKey, formatDuration, IpLink } from './JailsPage.tsx';

// Running bans come from fail2ban itself, the history from the local copy synced once a minute
const ACTIVE_MS = 5000;
const HISTORY_MS = 15_000;
const FEED = 100;
const MINUTES = 60;

function HostLive({ hostId }: { hostId: number }) {
  const { t, i18n } = useTranslation();
  const { timezone } = useCurrentUser();
  const formatDate = useFormatDateTime();
  const [paused, setPaused] = useState(false);
  // Bans already there when the page opened are not flagged as new
  const [openedAt] = useState(() => new Date().toISOString());
  const active = useQuery({
    queryKey: bansKey(hostId),
    queryFn: () => api.get<{ bans: LocatedBan[] }>(`/hosts/${hostId}/bans`),
    refetchInterval: paused ? false : ACTIVE_MS,
  });
  const history = useQuery({
    queryKey: ['hosts', hostId, 'history', 'live'],
    queryFn: () => api.get<{ bans: LocatedBan[] }>(`/hosts/${hostId}/history?limit=${FEED}`),
    refetchInterval: paused ? false : HISTORY_MS,
  });
  const feed = mergeFeed(active.data?.bans ?? [], history.data?.bans ?? []).slice(0, FEED);
  const colorOf = jailColors(feed.map((b) => b.jail));
  const minute = new Intl.DateTimeFormat(i18n.language, {
    timeZone: timezone === 'browser' ? undefined : timezone,
    hour: '2-digit',
    minute: '2-digit',
  });
  const columns = minuteColumns(feed, {
    now: Date.now() / 1000,
    minutes: MINUTES,
    colorOf,
    label: (at) => minute.format(at * 1000),
  });
  const lastHour = columns.reduce((total, c) => total + c.parts.reduce((s, p) => s + p.value, 0), 0);
  const jails = [...new Set(feed.map((b) => b.jail))];
  const error = active.error ?? history.error;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 text-sm">
          <span aria-hidden="true" className={`size-2.5 rounded-full ${paused ? 'bg-muted' : 'animate-pulse bg-ok'}`} />
          {paused ? t('live.paused') : t('live.running')}
        </span>
        <Button size="sm" variant="secondary" onClick={() => setPaused(!paused)}>
          {paused ? t('live.resume') : t('live.pause')}
        </Button>
      </div>
      <ErrorText>{error && errorText(t, error)}</ErrorText>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-2xl font-semibold">{active.data?.bans.length ?? '-'}</p>
          <p className="text-sm text-muted">{t('live.bannedNow')}</p>
        </Card>
        <Card>
          <p className="text-2xl font-semibold">{lastHour}</p>
          <p className="text-sm text-muted">{t('live.lastHour')}</p>
        </Card>
        <Card>
          <p className="text-base font-semibold">{feed[0] ? formatDate(feed[0].bannedAt) : '-'}</p>
          <p className="text-sm text-muted">{t('live.lastBan')}</p>
        </Card>
      </div>

      <Card title={t('live.perMinute')}>
        <div className="space-y-3">
          <Legend items={jails.map((name) => ({ name, color: colorOf(name) }))} />
          <StackedBars
            columns={columns}
            height={110}
            label={t('live.perMinute')}
            axis={<BarAxis labels={[columns[0]?.label ?? '', columns.at(-1)?.label ?? '']} />}
          />
        </div>
      </Card>

      <div className="space-y-2">
        <h2 className="text-base font-semibold">{t('live.feed')}</h2>
        <p className="text-xs text-muted">{t('live.feedHint')}</p>
        {feed.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">{t('live.empty')}</p>
          </Card>
        ) : (
          <Table
            columns={[
              t('live.when'),
              t('jails.jail'),
              t('jails.ip'),
              t('geoip.origin'),
              t('jails.bantime'),
              t('live.state'),
            ]}
          >
            {feed.map((ban) => (
              <tr key={banKey(ban)} className={ban.bannedAt > openedAt ? 'bg-accent/10' : ''}>
                <td className="whitespace-nowrap text-xs">
                  {formatDate(ban.bannedAt)}
                  {ban.bannedAt > openedAt && (
                    <span className="ml-2 rounded bg-accent/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                      {t('live.new')}
                    </span>
                  )}
                </td>
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    <Swatch color={colorOf(ban.jail)} />
                    {ban.jail}
                  </span>
                </td>
                <td className="font-mono text-xs">
                  <IpLink hostId={hostId} ip={ban.ip} />
                </td>
                <td>
                  <IpOrigin geo={ban.geo} />
                </td>
                <td className="whitespace-nowrap text-xs text-muted">{formatDuration(t, ban.bantime)}</td>
                <td className="text-xs">
                  {ban.active ? (
                    <span className="text-danger">{t('live.active')}</span>
                  ) : (
                    <span className="text-muted">{t('live.ended')}</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </>
  );
}

export function LivePage() {
  const { t } = useTranslation();
  return (
    <div className="max-w-7xl space-y-4">
      <h1 className="text-xl font-semibold">{t('live.title')}</h1>
      <p className="text-sm text-muted">{t('live.intro')}</p>
      <HostSwitch>{(hostId) => <HostLive key={hostId} hostId={hostId} />}</HostSwitch>
    </div>
  );
}

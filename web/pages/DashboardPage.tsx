import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { HealthResult } from '../../shared/api.ts';
import type { BanStats, JailRow, LocatedBan, ThreatRow } from '../../shared/fail2ban.ts';
import type { HostRow } from '../../shared/hosts.ts';
import { api } from '../api.ts';
import { useCurrentUser, useFormatDateTime } from '../auth.ts';
import {
  BarAxis,
  BarList,
  Donut,
  jailColors,
  Legend,
  Ring,
  Spark,
  StackedBars,
  Swatch,
  sum,
} from '../components/charts.tsx';
import { HostSwitch } from '../components/HostSwitch.tsx';
import { CountryLabel, IpOrigin } from '../components/IpOrigin.tsx';
import { Trend } from '../components/Trend.tsx';
import { Badge, ErrorText, Segmented } from '../components/ui.tsx';
import {
  dayColumns,
  hourColumns,
  LEVEL_STYLE,
  previousWindow,
  SEVERITY_LEVELS,
  type Severity,
  severity,
  severityOf,
  trend,
  verdict,
} from '../dashboard.ts';
import { errorText } from '../errors.ts';
import { hostsQuery } from '../hosts.ts';
import { usePersisted } from '../persisted.ts';
import { bansKey, formatDuration, IpLink } from './JailsPage.tsx';

const REFRESH_MS = 60_000;
const HOURS = 24;
const MODE_KEY = 'bvr.dashboardMode';

type Mode = 'simple' | 'full';

const MODES = ['simple', 'full'] as const;
const useMode = () => usePersisted<Mode>(MODE_KEY, MODES, 'simple');

function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min ${seconds % 60} s`;
}

function HostBadge({ host }: { host: HostRow }) {
  const { t } = useTranslation();
  const { status } = host;
  if (status.reachable) return <Badge tone="ok">{t('dashboard.connected', { version: status.version ?? '?' })}</Badge>;
  return (
    <Badge tone="danger">{t(status.error === 'CLIENT_MISSING' ? 'dashboard.clientMissing' : 'dashboard.down')}</Badge>
  );
}

// Everything both modes show, for one instance. The figures come from BanviewR's history, so they
// work while fail2ban is down; jails and current bans need fail2ban itself.
function useHostData(hostId: number, full: boolean) {
  const base = `/hosts/${hostId}`;
  const options = <T,>(key: unknown[], path: string, enabled = true) => ({
    queryKey: ['hosts', hostId, ...key],
    queryFn: () => api.get<T>(`${base}${path}`),
    refetchInterval: REFRESH_MS,
    enabled,
  });
  const day = useQuery(options<{ stats: BanStats }>(['stats', 1], '/stats?days=1'));
  const fortnight = useQuery(options<{ stats: BanStats }>(['stats', 14], '/stats?days=14'));
  const threats = useQuery(options<{ threats: ThreatRow[] }>(['threats', HOURS], `/threats?hours=${HOURS}`));
  const active = useQuery({
    queryKey: bansKey(hostId),
    queryFn: () => api.get<{ bans: LocatedBan[] }>(`${base}/bans`),
    refetchInterval: REFRESH_MS,
  });
  const jails = useQuery(options<{ jails: JailRow[] }>(['jails'], '/jails'));
  const history = useQuery(options<{ bans: LocatedBan[] }>(['history', 8], '/history?limit=8', full));

  const stats = day.data?.stats;
  const jailNames = [...(stats?.topJails.map((j) => j.jail) ?? []), ...(jails.data?.jails.map((j) => j.name) ?? [])];
  const now = Math.floor(Date.now() / 1000);
  const current = stats?.totalBans ?? 0;
  const previous = previousWindow(fortnight.data?.stats.slots ?? [], now, HOURS);
  const threatList = threats.data?.threats ?? [];
  return {
    error: day.error ?? fortnight.error ?? threats.error,
    stats,
    slots14: fortnight.data?.stats.slots ?? [],
    threats: threatList,
    active: active.data?.bans,
    jails: jails.data?.jails,
    history: history.data?.bans,
    colorOf: jailColors(jailNames),
    now,
    current,
    previous,
    change: trend(current, previous),
    levels: severity(threatList, stats?.uniqueIps ?? 0),
  };
}
type HostData = ReturnType<typeof useHostData>;

function Panel({
  title,
  hint,
  className = '',
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`min-w-0 rounded-lg border border-border bg-bg1 p-4 ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function SeverityBand({ levels }: { levels: Severity }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {SEVERITY_LEVELS.map((level) => (
        <div
          key={level}
          className={`flex items-center justify-between gap-2 rounded-md px-3 py-2.5 ${LEVEL_STYLE[level]}`}
        >
          <span className="flex flex-col">
            <span className="text-xs font-bold uppercase tracking-wider">{t(`dashboard.levels.${level}`)}</span>
            <span className="text-xs opacity-85">{t(`dashboard.levelRules.${level}`)}</span>
          </span>
          <span className="text-2xl font-bold tabular-nums">{levels[level]}</span>
        </div>
      ))}
    </div>
  );
}

function useCharts(data: HostData) {
  const { i18n } = useTranslation();
  const { timezone } = useCurrentUser();
  const hours = hourColumns(data.stats?.slots ?? [], {
    now: data.now,
    hours: HOURS,
    timezone,
    lang: i18n.language,
    colorOf: data.colorOf,
  });
  const days = (count: number, color: string) =>
    dayColumns(data.slots14, { now: data.now, days: count, timezone, lang: i18n.language, color });
  const jailParts = (data.stats?.topJails ?? []).map((j) => ({
    name: j.jail,
    value: j.bans,
    color: data.colorOf(j.jail),
  }));
  return { hours, days, jailParts };
}

const axisOf = (columns: { label: string }[]) =>
  [columns[0], columns[Math.floor(columns.length / 2)], columns.at(-1)].map((c) => c?.label ?? '');

function FullDashboard({ host, data }: { host: HostRow; data: HostData }) {
  const { t, i18n } = useTranslation();
  const formatDate = useFormatDateTime();
  const hosts = useQuery(hostsQuery);
  const { hours, days, jailParts } = useCharts(data);
  const stats = data.stats;
  const n = (value: number | undefined) => (value === undefined ? '-' : value.toLocaleString(i18n.language));
  const kpis = [
    { label: t('dashboard.kpi.bans'), value: n(stats?.totalBans), extra: <Trend change={data.change} /> },
    { label: t('dashboard.kpi.ips'), value: n(stats?.uniqueIps) },
    { label: t('dashboard.kpi.active'), value: n(data.active?.length) },
    { label: t('dashboard.kpi.recidivists'), value: n(stats && data.threats.length) },
    { label: t('dashboard.kpi.failures'), value: n(stats && sum(stats.topJails.map((j) => j.failures))) },
    { label: t('dashboard.kpi.countries'), value: n(stats?.countries.length) },
  ];
  const daily = days(14, '#388bfd');

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:col-span-12 lg:grid-cols-6">
        {kpis.map((kpi, i) => (
          <div key={kpi.label} className="flex flex-col gap-1.5 bg-bg1 px-4 py-3">
            <span className="text-xs uppercase tracking-wider text-muted">{kpi.label}</span>
            <span className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">{kpi.value}</span>
              {kpi.extra}
            </span>
            {i === 0 && <Spark values={hours.map((c) => ({ key: c.key, value: sum(c.parts.map((p) => p.value)) }))} />}
          </div>
        ))}
      </div>

      <div className="lg:col-span-12">
        <SeverityBand levels={data.levels} />
      </div>

      <Panel title={t('dashboard.perHour')} className="lg:col-span-8">
        <div className="mb-3">
          <Legend items={jailParts.map((p) => ({ name: p.name, color: p.color }))} />
        </div>
        <StackedBars columns={hours} label={t('dashboard.perHour')} axis={<BarAxis labels={axisOf(hours)} />} />
      </Panel>

      <Panel title={t('dashboard.byJail')} className="lg:col-span-4">
        <div className="flex flex-wrap items-center gap-5">
          <Donut parts={jailParts}>
            <span className="text-3xl font-bold">{n(stats?.totalBans)}</span>
            <span className="text-xs uppercase tracking-wider text-muted">{t('dashboard.bansUnit')}</span>
          </Donut>
          <ul className="min-w-0 space-y-2 text-xs">
            {jailParts.map((p) => (
              <li key={p.name}>
                <span className="inline-flex items-center gap-1.5 font-mono">
                  <Swatch color={p.color} />
                  {p.name}
                </span>
                <span className="block pl-4 text-muted">
                  {p.value} · {stats?.totalBans ? Math.round((p.value / stats.totalBans) * 100) : 0} %
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      <Panel title={t('dashboard.perDay', { count: 14 })} className="lg:col-span-8">
        <StackedBars
          columns={daily}
          height={140}
          label={t('dashboard.perDay', { count: 14 })}
          axis={<BarAxis labels={axisOf(daily)} />}
        />
      </Panel>

      <Panel title={t('dashboard.instances')} className="lg:col-span-4">
        <ul className="space-y-2 text-sm">
          {(hosts.data?.hosts ?? [host]).map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2">
              <span className="font-mono">{h.name}</span>
              <HostBadge host={h} />
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={t('dashboard.topIps')} className="lg:col-span-4">
        <BarList
          fill="bg-danger/30"
          empty={t('dashboard.empty')}
          rows={(stats?.topIps ?? []).slice(0, 8).map((r) => ({
            key: r.ip,
            value: r.count,
            label: (
              <span className="font-mono">
                <IpLink hostId={host.id} ip={r.ip} /> <span className="text-muted">{r.geo?.country ?? ''}</span>
              </span>
            ),
          }))}
        />
      </Panel>
      <Panel title={t('dashboard.countries')} className="lg:col-span-4">
        <BarList
          empty={t('dashboard.empty')}
          rows={(stats?.countries ?? [])
            .slice(0, 8)
            .map((c) => ({ key: c.country, value: c.bans, label: <CountryLabel code={c.country} /> }))}
        />
      </Panel>
      <Panel title={t('dashboard.orgs')} className="lg:col-span-4">
        <BarList
          empty={t('dashboard.empty')}
          rows={(stats?.orgs ?? []).slice(0, 8).map((o) => ({ key: o.org, value: o.bans, label: o.org }))}
        />
      </Panel>

      <Panel title={t('dashboard.feed')} hint={t('dashboard.feedHint')} className="lg:col-span-12">
        {data.history?.length === 0 && <p className="text-sm text-muted">{t('dashboard.empty')}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {data.history?.map((ban) => (
                <tr key={`${ban.ip}-${ban.bannedAt}`} className="border-border border-t first:border-t-0">
                  <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-xs text-muted">
                    {formatDate(ban.bannedAt)}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-xs">
                    <IpLink hostId={host.id} ip={ban.ip} />
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                      <Swatch color={data.colorOf(ban.jail)} />
                      {ban.jail}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3">
                    <IpOrigin geo={ban.geo} />
                  </td>
                  <td className="whitespace-nowrap py-1.5 text-right text-xs text-muted">
                    {formatDuration(t, ban.bantime)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function Pill({ value, label, strong = false }: { value: string; label: string; strong?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`inline-flex h-12 min-w-12 items-center justify-center rounded-xl px-2.5 text-xl font-bold ${strong ? 'bg-text text-bg0' : 'border border-border bg-bg2'}`}
      >
        {value}
      </span>
      <span className="max-w-24 text-sm leading-tight text-muted">{label}</span>
    </div>
  );
}

function SimpleDashboard({ host, data }: { host: HostRow; data: HostData }) {
  const { t, i18n } = useTranslation();
  const formatDate = useFormatDateTime();
  const { hours, days } = useCharts(data);
  const stats = data.stats;
  const jails = data.jails ?? [];
  const running = jails.filter((j) => j.running);
  const serious = data.levels.high + data.levels.critical;
  const located = stats?.uniqueIps ? Math.round((sum(stats.countries.map((c) => c.ips)) / stats.uniqueIps) * 100) : 0;
  const peak = hours.reduce(
    (best, c) => (sum(c.parts.map((p) => p.value)) > sum(best.parts.map((p) => p.value)) ? c : best),
    hours[0],
  );
  const week = days(7, 'var(--color-text)');
  const maxBanned = Math.max(1, ...running.map((j) => j.currentlyBanned));
  const word = verdict(data.levels, data.current, data.previous);
  const n = (value: number | undefined) => (value === undefined ? '-' : value.toLocaleString(i18n.language));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-6">
        <Pill strong value={n(stats && serious)} label={t('dashboard.simple.serious')} />
        <Pill value={n(stats?.totalBans)} label={t('dashboard.simple.bans')} />
        <Pill value={n(data.active?.length)} label={t('dashboard.simple.bannedNow')} />
        <Pill value={n(stats && data.threats.length)} label={t('dashboard.simple.recidivists')} />
        <Pill value={data.jails ? `${running.length}/${jails.length}` : '-'} label={t('dashboard.simple.jails')} />
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Panel title={t('dashboard.simple.alerts')}>
          {data.threats.length === 0 && <p className="text-sm text-muted">{t('dashboard.simple.noAlerts')}</p>}
          <ul className="space-y-4">
            {data.threats.slice(0, 3).map((threat) => {
              const level = severityOf(threat);
              return (
                <li key={threat.ip} className="space-y-1.5">
                  <p className="flex items-center gap-2 text-xs">
                    <span
                      className={`rounded px-2 py-0.5 font-bold uppercase tracking-wide ${level === 'critical' || level === 'high' ? 'bg-text text-bg0' : 'border border-border bg-bg2'}`}
                    >
                      {t(`dashboard.levels.${level}`)}
                    </span>
                    <span className="text-muted">{formatDate(threat.lastBanAt)}</span>
                  </p>
                  <p className="text-sm">
                    <span className="font-mono">
                      <IpLink hostId={host.id} ip={threat.ip} />
                    </span>{' '}
                    <span className="text-muted">
                      {t('dashboard.simple.alertWhat', { count: threat.bans, jails: threat.jails.join(', ') })}
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title={t('dashboard.perDay', { count: 7 })}>
          <StackedBars
            columns={week}
            height={150}
            label={t('dashboard.perDay', { count: 7 })}
            axis={<BarAxis labels={axisOf(week)} />}
          />
        </Panel>

        <Panel title={t('dashboard.simple.health')}>
          <div className="flex justify-around gap-4">
            <Ring percent={jails.length ? (running.length / jails.length) * 100 : 0}>
              <span className="text-2xl font-bold">
                {jails.length ? Math.round((running.length / jails.length) * 100) : 0} %
              </span>
              <span className="text-xs text-muted">{t('dashboard.simple.jailsRunning')}</span>
            </Ring>
            <Ring percent={located}>
              <span className="text-2xl font-bold">{located} %</span>
              <span className="text-xs text-muted">{t('dashboard.simple.located')}</span>
            </Ring>
          </div>
        </Panel>

        <Panel title={t('dashboard.simple.worst')} hint={t('dashboard.simple.last24h')}>
          {(stats?.topIps.length ?? 0) === 0 && <p className="text-sm text-muted">{t('dashboard.empty')}</p>}
          <ul className="space-y-3">
            {stats?.topIps.slice(0, 4).map((row) => (
              <li key={row.ip} className="space-y-1">
                <p className="flex justify-between text-sm">
                  <span className="font-mono">
                    <IpLink hostId={host.id} ip={row.ip} /> <span className="text-muted">{row.geo?.country ?? ''}</span>
                  </span>
                  <span className="font-semibold">{row.count}</span>
                </p>
                <div className="h-2 rounded bg-bg2">
                  <div
                    className="h-full rounded bg-text"
                    style={{ width: `${(row.count / (stats.topIps[0]?.count || 1)) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={t('dashboard.simple.jailsTitle')} hint={t('dashboard.simple.jailsHint')}>
          {!data.jails && <p className="text-sm text-muted">{t('dashboard.simple.noJails')}</p>}
          <ul className="grid grid-cols-3 gap-4">
            {running.map((jail) => (
              <li key={jail.name} className="flex flex-col items-center gap-1.5">
                <Ring size={56} thickness={0.07} percent={(jail.currentlyBanned / maxBanned) * 100}>
                  <span className="text-lg font-semibold">{jail.currentlyBanned}</span>
                </Ring>
                <span className="max-w-full truncate font-mono text-xs text-muted">{jail.name}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={t('dashboard.simple.inOneWord')}>
          <p className="text-4xl font-bold">{t(`dashboard.verdict.${word}`)}</p>
          <p className="mt-1 text-sm text-muted">
            {serious > 0
              ? t('dashboard.simple.seriousLine', { count: serious })
              : data.change === null
                ? t('dashboard.noTrend')
                : t('dashboard.simple.trendLine', { value: data.change > 0 ? `+${data.change}` : data.change })}
          </p>
          <ul className="mt-4 space-y-1.5 border-border border-t pt-3 text-sm text-muted">
            {peak && sum(peak.parts.map((p) => p.value)) > 0 && (
              <li>{t('dashboard.simple.peak', { hour: peak.label })}</li>
            )}
            {stats?.countries[0] && (
              <li>
                {t('dashboard.simple.topCountry')} <CountryLabel code={stats.countries[0].country} />
              </li>
            )}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function HostDashboard({ hostId, mode }: { hostId: number; mode: Mode }) {
  const { t } = useTranslation();
  const hosts = useQuery(hostsQuery);
  const data = useHostData(hostId, mode === 'full');
  const host = hosts.data?.hosts.find((h) => h.id === hostId);
  if (!host) return null;
  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono">{host.name}</span> <HostBadge host={host} />
      </p>
      <ErrorText>{data.error && errorText(t, data.error)}</ErrorText>
      {mode === 'full' ? <FullDashboard host={host} data={data} /> : <SimpleDashboard host={host} data={data} />}
      <Link to="/stats" className="inline-block text-sm text-accent hover:underline">
        {t('dashboard.statsLink')}
      </Link>
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const [mode, setMode] = useMode();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthResult>('/health'),
    refetchInterval: 5000,
  });

  return (
    <div className="max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('dashboard.title')}</h1>
        <Segmented
          label={t('dashboard.modeLabel')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'simple', label: t('dashboard.modes.simple') },
            { value: 'full', label: t('dashboard.modes.full') },
          ]}
        />
      </div>
      <p className="text-sm">
        {health.isPending && <span className="text-muted">{t('dashboard.connecting')}</span>}
        {health.isError && <span className="text-danger">{t('dashboard.serverDown')}</span>}
        {health.data && (
          <>
            <span className="text-ok">{t('dashboard.serverOk')}</span>
            <span className="text-muted">
              {' '}
              {t('dashboard.versionUptime', { version: health.data.version, uptime: formatUptime(health.data.uptime) })}
            </span>
          </>
        )}
      </p>
      <HostSwitch>{(hostId) => <HostDashboard key={hostId} hostId={hostId} mode={mode} />}</HostSwitch>
    </div>
  );
}

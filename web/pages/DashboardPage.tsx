import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { HealthResult } from '../../shared/api.ts';
import type { BanStats, LocatedBan, ThreatRow } from '../../shared/fail2ban.ts';
import type { HostRow } from '../../shared/hosts.ts';
import { api } from '../api.ts';
import { useFormatDateTime } from '../auth.ts';
import { CountryLabel, IpOrigin } from '../components/IpOrigin.tsx';
import { Badge, Card, ErrorText, Table } from '../components/ui.tsx';
import { errorText } from '../errors.ts';
import { hostsQuery } from '../hosts.ts';
import { IpLink } from './JailsPage.tsx';

const REFRESH_MS = 60_000;
const WINDOW_HOURS = 24;
const TOP = 5;

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

function Figure({ label, value }: { label: string; value: number | undefined }) {
  const { i18n } = useTranslation();
  return (
    <div className="rounded-md border border-border bg-bg0 px-4 py-3">
      <p className="text-2xl font-semibold">{value === undefined ? '-' : value.toLocaleString(i18n.language)}</p>
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

// One instance over the last day: from BanviewR's history, so it works while fail2ban is down
function HostSummary({ host }: { host: HostRow }) {
  const { t } = useTranslation();
  const formatDate = useFormatDateTime();
  const base = `/hosts/${host.id}`;
  const stats = useQuery({
    queryKey: ['hosts', host.id, 'stats', 1],
    queryFn: () => api.get<{ stats: BanStats }>(`${base}/stats?days=1`),
    refetchInterval: REFRESH_MS,
  });
  const threats = useQuery({
    queryKey: ['hosts', host.id, 'threats', WINDOW_HOURS],
    queryFn: () => api.get<{ threats: ThreatRow[] }>(`${base}/threats?hours=${WINDOW_HOURS}`),
    refetchInterval: REFRESH_MS,
  });
  // Needs fail2ban's own database: may fail when the rest works
  const active = useQuery({
    queryKey: ['hosts', host.id, 'bans'],
    queryFn: () => api.get<{ bans: LocatedBan[] }>(`${base}/bans`),
    refetchInterval: REFRESH_MS,
  });
  const day = stats.data?.stats;
  const recurring = threats.data?.threats ?? [];

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {host.name} <HostBadge host={host} />
        </span>
      }
    >
      <ErrorText>{stats.error && errorText(t, stats.error)}</ErrorText>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label={t('dashboard.bans24h')} value={day?.totalBans} />
        <Figure label={t('dashboard.ips24h')} value={day?.uniqueIps} />
        <Figure label={t('dashboard.activeBans')} value={active.data?.bans.length} />
        <Figure label={t('dashboard.recurring')} value={threats.data?.threats.length} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-2 lg:col-span-2">
          <h3 className="text-sm font-semibold">{t('dashboard.recurringTitle')}</h3>
          {recurring.length === 0 ? (
            <p className="text-sm text-muted">{t('dashboard.noRecurring')}</p>
          ) : (
            <Table columns={[t('jails.ip'), t('geoip.origin'), t('jails.banned'), t('dashboard.lastBan')]}>
              {recurring.slice(0, TOP).map((row) => (
                <tr key={row.ip}>
                  <td className="font-mono text-xs">
                    <IpLink hostId={host.id} ip={row.ip} />
                  </td>
                  <td>
                    <IpOrigin geo={row.geo} />
                  </td>
                  <td className="text-muted">{row.bans}</td>
                  <td className="whitespace-nowrap text-muted">{formatDate(row.lastBanAt)}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
        <div className="min-w-0 space-y-2">
          <h3 className="text-sm font-semibold">{t('dashboard.countries24h')}</h3>
          {day && day.countries.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {day.countries.slice(0, TOP).map((c) => (
                <li key={c.country} className="flex justify-between gap-2">
                  <CountryLabel code={c.country} />
                  <span className="text-muted">{c.bans}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{t('dashboard.noCountries')}</p>
          )}
        </div>
      </div>
      <Link to="/stats" className="mt-4 inline-block text-sm text-accent hover:underline">
        {t('dashboard.statsLink')}
      </Link>
    </Card>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthResult>('/health'),
    refetchInterval: 5000,
  });
  const hosts = useQuery(hostsQuery);

  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-xl font-semibold">{t('dashboard.title')}</h1>
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
      <ErrorText>{hosts.error && errorText(t, hosts.error)}</ErrorText>
      {hosts.data?.hosts.map((host) => (
        <HostSummary key={host.id} host={host} />
      ))}
      <Link to="/instances" className="text-sm text-accent hover:underline">
        {t('dashboard.instancesLink')}
      </Link>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BanStats } from '../../shared/fail2ban.ts';
import { api } from '../api.ts';
import { useCurrentUser } from '../auth.ts';
import { HostSwitch } from '../components/HostSwitch.tsx';
import { CountryLabel, IpOrigin } from '../components/IpOrigin.tsx';
import { Card, ErrorText, SelectField, Table } from '../components/ui.tsx';
import { errorText } from '../errors.ts';
import { foldSlots } from '../stats.ts';
import { IpLink } from './JailsPage.tsx';

const PERIODS = [7, 30, 90, 365, 0];
// The server syncs fail2ban once a minute
const REFRESH_MS = 60_000;
const WIDTH = 720;
const HEIGHT = 120;
const TOP_COUNTRIES = 10;
// Its outlines weigh about 40 KB compressed, only fetched when there are countries to show
const WorldMap = lazy(() => import('../components/WorldMap.tsx'));

type Bar = { key: string; label: string; bans: number };

// One series: the title names it, the line above the plot reads the hovered bar
function BarChart({ title, bars, axis }: { title: string; bars: Bar[]; axis: [string, string] }) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<Bar | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.bans));
  const step = WIDTH / Math.max(1, bars.length);
  const gap = Math.min(2, step / 4);
  const peak = bars.find((b) => b.bans === max);

  return (
    <Card title={title}>
      <p className="h-5 text-xs text-muted">
        {hovered
          ? t('stats.barValue', { label: hovered.label, count: hovered.bans })
          : peak && t('stats.peak', { label: peak.label, count: peak.bans })}
      </p>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-2 w-full"
        role="img"
        aria-label={peak ? `${title}. ${t('stats.peak', { label: peak.label, count: peak.bans })}` : title}
        onMouseLeave={() => setHovered(null)}
      >
        <line x1={0} x2={WIDTH} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} className="stroke-border" />
        {bars.map((bar, i) => {
          const height = (bar.bans / max) * (HEIGHT - 1);
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: hover detail only, the peak and tables carry the data
            <g key={bar.key} onMouseEnter={() => setHovered(bar)}>
              <rect x={i * step} y={0} width={step} height={HEIGHT} fill="transparent" />
              {bar.bans > 0 && (
                <rect
                  x={i * step + gap / 2}
                  y={HEIGHT - 1 - height}
                  width={step - gap}
                  height={height}
                  rx={Math.min(2, (step - gap) / 2)}
                  className={hovered?.key === bar.key ? 'fill-text' : 'fill-accent'}
                />
              )}
            </g>
          );
        })}
      </svg>
      <p className="mt-1 flex justify-between text-xs text-muted">
        <span>{axis[0]}</span>
        <span>{axis[1]}</span>
      </p>
    </Card>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  const { i18n } = useTranslation();
  return (
    <Card>
      <p className="text-2xl font-semibold">{value.toLocaleString(i18n.language)}</p>
      <p className="text-sm text-muted">{label}</p>
    </Card>
  );
}

function Charts({ stats }: { stats: BanStats }) {
  const { t, i18n } = useTranslation();
  const { timezone } = useCurrentUser();
  const { days, hours } = foldSlots(stats.slots, timezone);
  // Noon UTC with a UTC format: the date stays the one already folded
  const dayFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' });
  const formatDay = (date: string) => dayFormat.format(new Date(`${date}T12:00Z`));
  const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

  return (
    <>
      <BarChart
        title={t('stats.perDay')}
        bars={days.map((d) => ({ key: d.date, label: formatDay(d.date), bans: d.bans }))}
        axis={[formatDay(days[0]?.date ?? ''), formatDay(days.at(-1)?.date ?? '')]}
      />
      <BarChart
        title={t('stats.perHour')}
        bars={hours.map((h) => ({ key: String(h.hour), label: hourLabel(h.hour), bans: h.bans }))}
        axis={[hourLabel(0), hourLabel(23)]}
      />
    </>
  );
}

function MapCard({ stats }: { stats: BanStats }) {
  const { t } = useTranslation();
  const located = stats.countries.reduce((sum, c) => sum + c.bans, 0);
  return (
    <Card title={t('stats.map')}>
      {stats.countries.length === 0 ? (
        <p className="text-sm text-muted">{t('stats.noGeo')}</p>
      ) : (
        <>
          <Suspense fallback={<p className="text-sm text-muted">{t('common.loading')}</p>}>
            <WorldMap countries={stats.countries} />
          </Suspense>
          {located < stats.totalBans && (
            <p className="mt-2 text-xs text-muted">{t('stats.unlocated', { count: stats.totalBans - located })}</p>
          )}
        </>
      )}
    </Card>
  );
}

function HostStats({ hostId }: { hostId: number }) {
  const { t } = useTranslation();
  const [days, setDays] = useState(30);
  const stats = useQuery({
    queryKey: ['hosts', hostId, 'stats', days],
    queryFn: () => api.get<{ stats: BanStats }>(`/hosts/${hostId}/stats?days=${days}`),
    refetchInterval: REFRESH_MS,
  });
  const data = stats.data?.stats;

  return (
    <>
      <div className="max-w-xs">
        <SelectField label={t('stats.period')} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {p === 0 ? t('stats.allTime') : t('stats.lastDays', { count: p })}
            </option>
          ))}
        </SelectField>
      </div>
      <ErrorText>{stats.error && errorText(t, stats.error)}</ErrorText>
      {stats.isPending && <p className="text-muted">{t('common.loading')}</p>}
      {data &&
        (data.totalBans === 0 ? (
          <p className="text-sm text-muted">{t('stats.empty')}</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Tile label={t('stats.totalBans')} value={data.totalBans} />
              <Tile label={t('stats.uniqueIps')} value={data.uniqueIps} />
            </div>
            <Charts stats={data} />
            <MapCard stats={data} />
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="min-w-0 space-y-2">
                <h2 className="text-base font-semibold">{t('stats.topIps')}</h2>
                <Table columns={[t('jails.ip'), t('geoip.origin'), t('jails.banned')]}>
                  {data.topIps.map((row) => (
                    <tr key={row.ip}>
                      <td className="font-mono text-xs">
                        <IpLink hostId={hostId} ip={row.ip} />
                      </td>
                      <td>
                        <IpOrigin geo={row.geo} />
                      </td>
                      <td className="text-muted">{row.count}</td>
                    </tr>
                  ))}
                </Table>
              </div>
              <div className="min-w-0 space-y-2">
                <h2 className="text-base font-semibold">{t('stats.topJails')}</h2>
                <Table columns={[t('jails.jail'), t('jails.banned'), t('jails.failures')]}>
                  {data.topJails.map((row) => (
                    <tr key={row.jail}>
                      <td>{row.jail}</td>
                      <td className="text-muted">{row.bans}</td>
                      <td className="text-muted">{row.failures}</td>
                    </tr>
                  ))}
                </Table>
              </div>
              {data.countries.length > 0 && (
                <div className="min-w-0 space-y-2">
                  <h2 className="text-base font-semibold">{t('stats.topCountries')}</h2>
                  <Table columns={[t('geoip.country'), t('jails.banned'), t('stats.uniqueIps')]}>
                    {data.countries.slice(0, TOP_COUNTRIES).map((row) => (
                      <tr key={row.country}>
                        <td>
                          <CountryLabel code={row.country} />
                        </td>
                        <td className="text-muted">{row.bans}</td>
                        <td className="text-muted">{row.ips}</td>
                      </tr>
                    ))}
                  </Table>
                </div>
              )}
            </div>
          </>
        ))}
    </>
  );
}

export function StatsPage() {
  const { t } = useTranslation();
  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-xl font-semibold">{t('stats.title')}</h1>
      <p className="text-sm text-muted">{t('stats.intro')}</p>
      <HostSwitch>{(hostId) => <HostStats key={hostId} hostId={hostId} />}</HostSwitch>
    </div>
  );
}

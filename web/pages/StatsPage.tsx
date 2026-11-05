import { useQuery } from '@tanstack/react-query';
import { lazy, type ReactNode, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BanStats, JailRow } from '../../shared/fail2ban.ts';
import { api } from '../api.ts';
import { useCurrentUser } from '../auth.ts';
import {
  BarAxis,
  type BarColumn,
  BarList,
  type Cell,
  CellGrid,
  Clock,
  Donut,
  Legend,
  LineChart,
  OTHER_COLOR,
  ShareBar,
  StackedBars,
  Swatch,
  sum,
} from '../components/charts.tsx';
import { HostSwitch } from '../components/HostSwitch.tsx';
import { CountryLabel, IpOrigin } from '../components/IpOrigin.tsx';
import { Trend } from '../components/Trend.tsx';
import { Card, ErrorText, Segmented, SelectField, Table } from '../components/ui.tsx';
import { previousWindow, trend } from '../dashboard.ts';
import { errorText } from '../errors.ts';
import { useJailColors } from '../jailColors.ts';
import { usePersisted } from '../persisted.ts';
import { addDays, calendarWeeks, filterShares, foldSlots, localClock, weekdayOf } from '../stats.ts';
import { IpLink } from './JailsPage.tsx';

const PERIODS = [7, 30, 90, 365, 0];
// Past this many days, one column per week: daily columns would be thinner than a pixel
const WEEKLY_AFTER = 120;
// The server syncs fail2ban once a minute
const REFRESH_MS = 60_000;
const YEAR = 365;
// Its outlines weigh about 40 KB compressed, only fetched when the map format is shown
const WorldMap = lazy(() => import('../components/WorldMap.tsx'));

const TIME_FORMATS = ['bars', 'lines', 'table'] as const;
const SHARE_FORMATS = ['bars', 'segment', 'donut', 'table'] as const;
const WHEN_FORMATS = ['heat', 'clock', 'table'] as const;
const WHERE_FORMATS = ['map', 'bars', 'table'] as const;

const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
const scroll = 'max-h-96 overflow-y-auto';

// A chart with its format switch in the header, the choice remembered per chart
function ChartCard<T extends string>({
  chart,
  title,
  hint,
  formats,
  children,
}: {
  chart: string;
  title: string;
  hint?: string;
  formats: readonly T[];
  children: (format: T) => ReactNode;
}) {
  const { t } = useTranslation();
  const [format, setFormat] = usePersisted<T>(`bvr.stats.${chart}`, formats, formats[0] as T);
  return (
    <section className="min-w-0 rounded-md border border-border bg-bg1 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        <Segmented
          label={t('stats.formatLabel', { chart: title })}
          options={formats.map((value) => ({ value, label: t(`stats.formats.${value}`) }))}
          value={format}
          onChange={setFormat}
        />
      </div>
      {children(format)}
    </section>
  );
}

function useLabels() {
  const { i18n } = useTranslation();
  // Noon UTC with a UTC format: the date stays the one already folded
  const dayFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' });
  const weekdayFormat = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' });
  return {
    day: (date: string) => dayFormat.format(new Date(`${date}T12:00Z`)),
    // 2024-01-01 is a Monday
    weekday: (index: number) => weekdayFormat.format(new Date(Date.UTC(2024, 0, 1 + index, 12))),
  };
}

// Jails past the palette share one gray series, named "other jails"
function useSeries(stats: BanStats) {
  const { t } = useTranslation();
  const colorOf = useJailColors(stats.slots.map((s) => s.jail));
  const nameOf = (jail: string) => (colorOf(jail) === OTHER_COLOR ? t('stats.otherJails') : jail);
  const totals = new Map<string, { color: string; value: number }>();
  for (const row of stats.topJails) {
    const name = nameOf(row.jail);
    const entry = totals.get(name) ?? { color: colorOf(row.jail), value: 0 };
    entry.value += row.bans;
    totals.set(name, entry);
  }
  const parts = [...totals].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.value - a.value);
  return { nameOf, colorOf, parts };
}

function OverTime({ stats, fold }: { stats: BanStats; fold: ReturnType<typeof foldSlots> }) {
  const { t } = useTranslation();
  const labels = useLabels();
  const { nameOf, colorOf, parts } = useSeries(stats);
  const weekly = fold.days.length > WEEKLY_AFTER;
  const buckets = new Map<string, Map<string, number>>();
  for (const { date } of fold.days) {
    const key = weekly ? addDays(date, -weekdayOf(date)) : date;
    const bucket = buckets.get(key) ?? new Map<string, number>();
    for (const [jail, bans] of fold.jailDays.get(date) ?? []) {
      bucket.set(nameOf(jail), (bucket.get(nameOf(jail)) ?? 0) + bans);
    }
    buckets.set(key, bucket);
  }
  const colorByName = new Map(parts.map((p) => [p.name, p.color]));
  for (const s of stats.slots) if (!colorByName.has(nameOf(s.jail))) colorByName.set(nameOf(s.jail), colorOf(s.jail));
  const names = [...colorByName.keys()];
  const columns: BarColumn[] = [...buckets].map(([key, values]) => ({
    key,
    label: weekly ? t('stats.weekOf', { date: labels.day(key) }) : labels.day(key),
    parts: names.map((name) => ({ name, value: values.get(name) ?? 0, color: colorByName.get(name) ?? OTHER_COLOR })),
  }));
  const axis = (
    <BarAxis
      labels={[columns[0], columns[Math.floor(columns.length / 2)], columns.at(-1)].map((c) =>
        c ? labels.day(c.key) : '',
      )}
    />
  );
  const legend = <Legend items={names.map((name) => ({ name, color: colorByName.get(name) ?? OTHER_COLOR }))} />;
  const title = t('stats.overTime');

  return (
    <ChartCard
      chart="time"
      title={title}
      hint={t(weekly ? 'stats.perWeekByJail' : 'stats.perDayByJail')}
      formats={TIME_FORMATS}
    >
      {(format) =>
        format === 'table' ? (
          <div className={scroll}>
            <Table columns={[t(weekly ? 'stats.week' : 'stats.day'), ...names, t('stats.total')]}>
              {[...columns].reverse().map((c) => (
                <tr key={c.key}>
                  <td className="whitespace-nowrap">{c.label}</td>
                  {c.parts.map((p) => (
                    <td key={p.name} className="font-mono text-muted">
                      {p.value}
                    </td>
                  ))}
                  <td className="font-mono">{sum(c.parts.map((p) => p.value))}</td>
                </tr>
              ))}
            </Table>
          </div>
        ) : (
          <div className="space-y-3">
            {legend}
            {format === 'lines' ? (
              <LineChart columns={columns} label={title} axis={axis} />
            ) : (
              <StackedBars columns={columns} label={title} axis={axis} />
            )}
          </div>
        )
      }
    </ChartCard>
  );
}

function Share({ stats }: { stats: BanStats }) {
  const { t, i18n } = useTranslation();
  const { parts, colorOf } = useSeries(stats);
  const total = sum(parts.map((p) => p.value));
  const pct = (value: number) => (total ? Math.round((value / total) * 100) : 0);
  return (
    <ChartCard chart="share" title={t('stats.share')} formats={SHARE_FORMATS}>
      {(format) => {
        if (format === 'segment') return <ShareBar parts={parts} />;
        if (format === 'donut')
          return (
            <div className="flex flex-wrap items-center gap-6">
              <Donut parts={parts}>
                <span className="text-2xl font-semibold">{total.toLocaleString(i18n.language)}</span>
                <span className="text-xs text-muted">{t('dashboard.bansUnit')}</span>
              </Donut>
              <Legend items={parts.map((p) => ({ name: `${p.name} (${pct(p.value)} %)`, color: p.color }))} />
            </div>
          );
        if (format === 'table')
          return (
            <Table columns={[t('jails.jail'), t('jails.banned'), t('jails.failures'), t('stats.part')]}>
              {stats.topJails.map((row) => (
                <tr key={row.jail}>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <Swatch color={colorOf(row.jail)} />
                      {row.jail}
                    </span>
                  </td>
                  <td className="font-mono text-muted">{row.bans}</td>
                  <td className="font-mono text-muted">{row.failures}</td>
                  <td className="font-mono text-muted">{pct(row.bans)} %</td>
                </tr>
              ))}
            </Table>
          );
        return (
          <BarList
            empty={t('stats.empty')}
            rows={parts.map((p) => ({
              key: p.name,
              value: p.value,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Swatch color={p.color} />
                  {p.name}
                </span>
              ),
            }))}
          />
        );
      }}
    </ChartCard>
  );
}

function When({ fold }: { fold: ReturnType<typeof foldSlots> }) {
  const { t } = useTranslation();
  const labels = useLabels();
  const peak = fold.hours.reduce((best, h) => (h.bans > best.bans ? h : best), { hour: 0, bans: 0 });
  const summary = t('stats.peak', { label: hourLabel(peak.hour), count: peak.bans });
  const rows: Cell[][] = fold.week.map((hours, day) =>
    hours.map((value, hour) => ({ key: `${day}-${hour}`, label: `${labels.weekday(day)} ${hourLabel(hour)}`, value })),
  );
  const hourTicks = (
    <div className="grid min-w-max gap-0.5" style={{ gridTemplateColumns: '2.5rem repeat(24, minmax(10px, 1fr))' }}>
      <span />
      {fold.hours.map(({ hour }) => (
        <span key={hour} className="font-mono text-[10px] text-muted">
          {hour % 6 === 0 ? String(hour).padStart(2, '0') : ''}
        </span>
      ))}
    </div>
  );
  return (
    <ChartCard chart="when" title={t('stats.when')} hint={t('stats.whenHint')} formats={WHEN_FORMATS}>
      {(format) => {
        if (format === 'clock')
          return (
            <Clock
              hours={fold.hours.map((h) => h.bans)}
              summary={summary}
              describe={(hour) => t('stats.barValue', { label: hourLabel(hour), count: fold.hours[hour]?.bans ?? 0 })}
            />
          );
        if (format === 'table')
          return (
            <div className={scroll}>
              <Table columns={[t('stats.hour'), ...fold.week.map((_, day) => labels.weekday(day)), t('stats.total')]}>
                {fold.hours.map(({ hour, bans }) => (
                  <tr key={hour}>
                    <td className="font-mono">{hourLabel(hour)}</td>
                    {fold.week.map((hours, day) => (
                      <td key={labels.weekday(day)} className="font-mono text-muted">
                        {hours[hour]}
                      </td>
                    ))}
                    <td className="font-mono">{bans}</td>
                  </tr>
                ))}
              </Table>
            </div>
          );
        return (
          <CellGrid
            rows={rows}
            rowLabels={fold.week.map((_, day) => labels.weekday(day))}
            colLabels={hourTicks}
            summary={summary}
            describe={(cell) => t('stats.barValue', { label: cell.label, count: cell.value })}
          />
        );
      }}
    </ChartCard>
  );
}

function Where({ stats }: { stats: BanStats }) {
  const { t } = useTranslation();
  const located = sum(stats.countries.map((c) => c.bans));
  return (
    <ChartCard chart="where" title={t('stats.where')} formats={WHERE_FORMATS}>
      {(format) => {
        if (stats.countries.length === 0) return <p className="text-sm text-muted">{t('stats.noGeo')}</p>;
        if (format === 'bars')
          return (
            <BarList
              empty={t('stats.noGeo')}
              rows={stats.countries
                .slice(0, 12)
                .map((c) => ({ key: c.country, value: c.bans, label: <CountryLabel code={c.country} /> }))}
            />
          );
        if (format === 'table')
          return (
            <div className={scroll}>
              <Table columns={[t('geoip.country'), t('jails.banned'), t('stats.uniqueIps')]}>
                {stats.countries.map((row) => (
                  <tr key={row.country}>
                    <td>
                      <CountryLabel code={row.country} />
                    </td>
                    <td className="font-mono text-muted">{row.bans}</td>
                    <td className="font-mono text-muted">{row.ips}</td>
                  </tr>
                ))}
              </Table>
            </div>
          );
        return (
          <>
            <Suspense fallback={<p className="text-sm text-muted">{t('common.loading')}</p>}>
              <WorldMap countries={stats.countries} />
            </Suspense>
            {located < stats.totalBans && (
              <p className="mt-2 text-xs text-muted">{t('stats.unlocated', { count: stats.totalBans - located })}</p>
            )}
          </>
        );
      }}
    </ChartCard>
  );
}

// Always the last twelve months, whatever the period above
function Year({ hostId, days, current }: { hostId: number; days: number; current?: BanStats }) {
  const { t } = useTranslation();
  const { timezone } = useCurrentUser();
  const labels = useLabels();
  // shortcut: a second stats request when the period is not a year; add a per-day route if it weighs
  const year = useQuery({
    queryKey: ['hosts', hostId, 'stats', YEAR],
    queryFn: () => api.get<{ stats: BanStats }>(`/hosts/${hostId}/stats?days=${YEAR}`),
    refetchInterval: REFRESH_MS,
    enabled: days !== YEAR,
  });
  const stats = days === YEAR ? current : year.data?.stats;
  if (!stats) return null;
  const fold = foldSlots(stats.slots, timezone);
  const weeks = calendarWeeks(
    new Map(fold.days.map((d) => [d.date, d.bans])),
    localClock(timezone)(Date.now() / 1000).date,
  );
  const rows: Cell[][] = Array.from({ length: 7 }, (_, day) =>
    weeks.map((week) => {
      const cell = week[day];
      return cell ? { key: cell.date, label: labels.day(cell.date), value: cell.bans } : null;
    }),
  );
  const peak = fold.days.reduce((best, d) => (d.bans > best.bans ? d : best), { date: '', bans: 0 });
  const summary = peak.bans
    ? `${t('stats.yearTotal', { count: stats.totalBans })} ${t('stats.peak', { label: labels.day(peak.date), count: peak.bans })}`
    : t('stats.yearTotal', { count: 0 });
  return (
    <Card title={t('stats.year')}>
      <CellGrid
        rows={rows}
        rowLabels={rows.map((_, day) => (day % 2 === 0 ? labels.weekday(day) : ''))}
        summary={summary}
        describe={(cell) => t('stats.barValue', { label: cell.label, count: cell.value })}
      />
    </Card>
  );
}

function Tile({ label, value, extra }: { label: string; value: number; extra?: ReactNode }) {
  const { i18n } = useTranslation();
  return (
    <Card>
      <p className="flex items-baseline gap-2 text-2xl font-semibold">
        {value.toLocaleString(i18n.language)} {extra}
      </p>
      <p className="text-sm text-muted">{label}</p>
    </Card>
  );
}

// Bans per filter of the jails: what kind of attack, when several jails watch the same service
function AttackTypes({ stats, hostId }: { stats: BanStats; hostId: number }) {
  const { t, i18n } = useTranslation();
  // Same query as the Jails page; without fail2ban the jail names stand in for the filters
  const jails = useQuery({
    queryKey: ['hosts', hostId, 'jails'],
    queryFn: () => api.get<{ jails: JailRow[] }>(`/hosts/${hostId}/jails`),
  });
  const shares = filterShares(stats.topJails, jails.data?.jails ?? []);
  if (shares.length === 0) return null;
  return (
    <Card title={t('stats.attackTypes')}>
      <p className="mb-3 text-xs text-muted">{t('stats.attackTypesHint')}</p>
      <ul className="flex flex-wrap gap-2">
        {shares.map(({ filter, bans }) => (
          <li key={filter} className="rounded-md border border-border bg-bg2 px-2 py-1 font-mono text-xs">
            {filter} <span className="text-muted">{bans.toLocaleString(i18n.language)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function HostStats({ hostId }: { hostId: number }) {
  const { t } = useTranslation();
  const { timezone } = useCurrentUser();
  const [days, setDays] = useState(30);
  const stats = useQuery({
    queryKey: ['hosts', hostId, 'stats', days],
    queryFn: () => api.get<{ stats: BanStats }>(`/hosts/${hostId}/stats?days=${days}`),
    refetchInterval: REFRESH_MS,
  });
  // The window just before, same length, for the trend. shortcut: not for 365 days and more
  // (two years of hourly slots), add a server count if people want it there
  const withTrend = days > 0 && days <= 90;
  const twice = useQuery({
    queryKey: ['hosts', hostId, 'stats', days * 2],
    queryFn: () => api.get<{ stats: BanStats }>(`/hosts/${hostId}/stats?days=${days * 2}`),
    refetchInterval: REFRESH_MS,
    enabled: withTrend,
  });
  const data = stats.data?.stats;
  const now = Math.floor(Date.now() / 1000);
  const previous = twice.data
    ? previousWindow(twice.data.stats.slots, now, days * 24, twice.data.stats.firstBanAt)
    : undefined;
  const fold = data && foldSlots(data.slots, timezone);

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
        fold &&
        (data.totalBans === 0 ? (
          <p className="text-sm text-muted">{t('stats.empty')}</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Tile
                label={previous ? t('stats.totalBansBefore', { count: previous }) : t('stats.totalBans')}
                value={data.totalBans}
                extra={previous === undefined ? undefined : <Trend change={trend(data.totalBans, previous)} />}
              />
              <Tile label={t('stats.uniqueIps')} value={data.uniqueIps} />
              <Tile label={t('stats.jailsSeen')} value={new Set(data.slots.map((s) => s.jail)).size} />
            </div>
            <OverTime stats={data} fold={fold} />
            <div className="grid gap-4 lg:grid-cols-2">
              <Share stats={data} />
              <When fold={fold} />
            </div>
            <AttackTypes stats={data} hostId={hostId} />
            <Where stats={data} />
            <Year hostId={hostId} days={days} current={data} />
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
              <Card title={t('stats.orgs')}>
                <BarList
                  empty={t('stats.noOrgs')}
                  rows={data.orgs.map((o) => ({ key: o.org, value: o.bans, label: o.org }))}
                />
              </Card>
            </div>
          </>
        ))}
    </>
  );
}

export function StatsPage() {
  const { t } = useTranslation();
  return (
    <div className="max-w-6xl space-y-4">
      <h1 className="text-xl font-semibold">{t('stats.title')}</h1>
      <p className="text-sm text-muted">{t('stats.intro')}</p>
      <HostSwitch>{(hostId) => <HostStats key={hostId} hostId={hostId} />}</HostSwitch>
    </div>
  );
}

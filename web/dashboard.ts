import type { BanStats, ThreatRow } from '../shared/fail2ban.ts';
import type { BarColumn } from './components/charts.tsx';

const HOUR = 3600;
const DAY = 86_400;

const zone = (timezone: string) => (timezone === 'browser' ? undefined : timezone);
const localDate = (timezone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: zone(timezone), year: 'numeric', month: '2-digit', day: '2-digit' });

// One column per hour up to the current one, each split by jail
export function hourColumns(
  slots: BanStats['slots'],
  {
    now,
    hours,
    timezone,
    lang,
    colorOf,
  }: { now: number; hours: number; timezone: string; lang: string; colorOf: (jail: string) => string },
): BarColumn[] {
  const label = new Intl.DateTimeFormat(lang, { timeZone: zone(timezone), hour: '2-digit', minute: '2-digit' });
  const last = Math.floor(now / HOUR) * HOUR;
  return Array.from({ length: hours }, (_, i) => {
    const at = last - (hours - 1 - i) * HOUR;
    const parts = slots
      .filter((s) => s.at === at)
      .map((s) => ({ name: s.jail, value: s.bans, color: colorOf(s.jail) }));
    return { key: String(at), label: label.format(at * 1000), parts };
  });
}

// One column per day of the reader, the last `days` days up to today
export function dayColumns(
  slots: BanStats['slots'],
  { now, days, timezone, lang, color }: { now: number; days: number; timezone: string; lang: string; color: string },
): BarColumn[] {
  const key = localDate(timezone);
  const label = new Intl.DateTimeFormat(lang, { timeZone: zone(timezone), weekday: 'short', day: 'numeric' });
  const perDay = new Map<string, number>();
  for (const s of slots) {
    const date = key.format(s.at * 1000);
    perDay.set(date, (perDay.get(date) ?? 0) + s.bans);
  }
  return Array.from({ length: days }, (_, i) => {
    const at = now - (days - 1 - i) * DAY;
    const date = key.format(at * 1000);
    return {
      key: date,
      label: label.format(at * 1000),
      parts: [{ name: 'bans', value: perDay.get(date) ?? 0, color }],
    };
  });
}

// Bans of the window that ends where the current one starts, for the trend
// Bans of the window just before the current one, null when the history starts inside it (a new
// instance, or fail2ban's own purge before BanviewR came): an hour of slack for the first slot
export function previousWindow(slots: BanStats['slots'], now: number, hours: number, firstBanAt: number | null) {
  const end = now - hours * HOUR;
  const start = end - hours * HOUR;
  if (firstBanAt === null || firstBanAt > start + HOUR) return null;
  return slots.filter((s) => s.at >= start && s.at < end).reduce((total, s) => total + s.bans, 0);
}

export type Severity = { info: number; low: number; medium: number; high: number; critical: number };
export const SEVERITY_LEVELS = ['info', 'low', 'medium', 'high', 'critical'] as const;

// Reds from light to dark, the darkest for the worst; text kept readable on each
export const LEVEL_STYLE: Record<(typeof SEVERITY_LEVELS)[number], string> = {
  info: 'bg-[#c9d1d9] text-bg0',
  low: 'bg-[#ffa198] text-bg0',
  medium: 'bg-[#ff7b72] text-bg0',
  high: 'bg-[#da3633] text-white',
  critical: 'bg-[#8e1519] text-white',
};

// Addresses by how often they came back: through recidive is critical, then 10+, 4 to 9, 2 or 3 bans.
// Addresses banned once are the rest of the period. shortcut: threats are capped at 100 by the API,
// past that the low levels are undercounted; add a server count if it matters
export function severityOf(threat: ThreatRow): (typeof SEVERITY_LEVELS)[number] {
  if (threat.jails.includes('recidive')) return 'critical';
  if (threat.bans >= 10) return 'high';
  if (threat.bans >= 4) return 'medium';
  return 'low';
}

export function severity(threats: ThreatRow[], uniqueIps: number): Severity {
  const levels: Severity = { info: Math.max(0, uniqueIps - threats.length), low: 0, medium: 0, high: 0, critical: 0 };
  for (const threat of threats) levels[severityOf(threat)]++;
  return levels;
}

// Percent change, null when there is nothing to compare with
export function trend(current: number, previous: number | null) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

// One word for the simple mode
export function verdict(levels: Severity, current: number, previous: number): 'busy' | 'rising' | 'calm' {
  if (levels.high + levels.critical > 0) return 'busy';
  if (current > 10 && current > previous * 1.5) return 'rising';
  return 'calm';
}

import type { LocatedBan } from '../shared/fail2ban.ts';
import type { BarColumn } from './components/charts.tsx';

const MINUTE = 60;

export const banKey = (ban: LocatedBan) => `${ban.jail}|${ban.ip}|${ban.bannedAt}`;

// Bans running now (read from fail2ban at once) and the synced history (once a minute), latest first, each ban once
export function mergeFeed(active: LocatedBan[], history: LocatedBan[]) {
  const rows = new Map<string, LocatedBan & { active: boolean }>();
  for (const ban of history) rows.set(banKey(ban), { ...ban, active: false });
  for (const ban of active) rows.set(banKey(ban), { ...ban, active: true });
  return [...rows.values()].sort((a, b) => b.bannedAt.localeCompare(a.bannedAt));
}

// One column per minute up to the current one, split by jail
export function minuteColumns(
  bans: LocatedBan[],
  {
    now,
    minutes,
    colorOf,
    label,
  }: { now: number; minutes: number; colorOf: (jail: string) => string; label: (at: number) => string },
): BarColumn[] {
  const last = Math.floor(now / MINUTE) * MINUTE;
  const first = last - (minutes - 1) * MINUTE;
  const perMinute = new Map<number, Map<string, number>>();
  for (const ban of bans) {
    const at = Math.floor(Date.parse(ban.bannedAt) / 1000 / MINUTE) * MINUTE;
    if (at < first || at > last) continue;
    const jails = perMinute.get(at) ?? new Map<string, number>();
    jails.set(ban.jail, (jails.get(ban.jail) ?? 0) + 1);
    perMinute.set(at, jails);
  }
  return Array.from({ length: minutes }, (_, i) => {
    const at = first + i * MINUTE;
    const parts = [...(perMinute.get(at) ?? [])].map(([name, value]) => ({ name, value, color: colorOf(name) }));
    return { key: String(at), label: label(at), parts };
  });
}

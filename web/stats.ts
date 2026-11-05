const DAY_MS = 86_400_000;

export const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * DAY_MS).toISOString().slice(0, 10);
// Monday 0 to Sunday 6, for a YYYY-MM-DD date
export const weekdayOf = (date: string) => (new Date(Date.parse(date)).getUTCDay() + 6) % 7;

// Date and hour of a unix time in the reader's zone
export function localClock(timezone: string) {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone === 'browser' ? undefined : timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  return (at: number) => {
    const part = Object.fromEntries(format.formatToParts(at * 1000).map((p) => [p.type, p.value]));
    return { date: `${part.year}-${part.month}-${part.day}`, hour: Number(part.hour) };
  };
}

// Folds hourly UTC slots into the reader's days and hours, days without bans included.
// Slots with a jail are also split per jail and per day, and laid on a week (weekday x hour).
// shortcut: zones with a half-hour offset are off by 30 minutes, add finer slots if it matters
export function foldSlots(slots: { at: number; bans: number; jail?: string }[], timezone: string) {
  const clock = localClock(timezone);
  const perDay = new Map<string, number>();
  const jailDays = new Map<string, Map<string, number>>();
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, bans: 0 }));
  const week = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const { at, bans, jail } of slots) {
    const { date, hour } = clock(at);
    perDay.set(date, (perDay.get(date) ?? 0) + bans);
    const slot = hours[hour];
    if (slot) slot.bans += bans;
    const row = week[weekdayOf(date)];
    if (row) row[hour] = (row[hour] ?? 0) + bans;
    if (jail !== undefined) {
      const byJail = jailDays.get(date) ?? new Map<string, number>();
      byJail.set(jail, (byJail.get(jail) ?? 0) + bans);
      jailDays.set(date, byJail);
    }
  }

  const dates = [...perDay.keys()].sort();
  const days = [];
  const [first, last] = [dates[0], dates.at(-1)];
  if (first && last) {
    for (let date = first; date <= last; date = addDays(date, 1)) days.push({ date, bans: perDay.get(date) ?? 0 });
  }
  return { days, hours, week, jailDays };
}

// The last 53 weeks up to today, Monday first, as GitHub draws a year. Days after today are null.
export function calendarWeeks(perDay: Map<string, number>, today: string) {
  const start = addDays(today, -364 - weekdayOf(addDays(today, -364)));
  const weeks: ({ date: string; bans: number } | null)[][] = [];
  for (let monday = start; monday <= today; monday = addDays(monday, 7)) {
    weeks.push(
      Array.from({ length: 7 }, (_, i) => {
        const date = addDays(monday, i);
        return date > today ? null : { date, bans: perDay.get(date) ?? 0 };
      }),
    );
  }
  return weeks;
}

const DAY_MS = 86_400_000;

// Folds hourly UTC slots into the reader's days and hours, days without bans included.
// shortcut: zones with a half-hour offset are off by 30 minutes, add finer slots if it matters
export function foldSlots(slots: { at: number; bans: number }[], timezone: string) {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone === 'browser' ? undefined : timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const perDay = new Map<string, number>();
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, bans: 0 }));
  for (const { at, bans } of slots) {
    const part = Object.fromEntries(format.formatToParts(at * 1000).map((p) => [p.type, p.value]));
    const date = `${part.year}-${part.month}-${part.day}`;
    perDay.set(date, (perDay.get(date) ?? 0) + bans);
    const slot = hours[Number(part.hour)];
    if (slot) slot.bans += bans;
  }

  const dates = [...perDay.keys()].sort();
  const days = [];
  const [first, last] = [dates[0], dates.at(-1)];
  if (first && last) {
    for (let time = Date.parse(first); time <= Date.parse(last); time += DAY_MS) {
      const date = new Date(time).toISOString().slice(0, 10);
      days.push({ date, bans: perDay.get(date) ?? 0 });
    }
  }
  return { days, hours };
}

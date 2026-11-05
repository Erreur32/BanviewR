import { describe, expect, it } from 'vitest';
import { calendarWeeks, foldSlots } from './stats.ts';

const at = (iso: string) => Date.parse(iso) / 1000;

describe('foldSlots', () => {
  it('folds in the time zone of the reader', () => {
    const slots = [{ at: at('2026-03-01T23:00:00Z'), bans: 2 }];
    const utc = foldSlots(slots, 'UTC');
    expect(utc.days).toEqual([{ date: '2026-03-01', bans: 2 }]);
    expect(utc.hours[23]?.bans).toBe(2);

    const paris = foldSlots(slots, 'Europe/Paris');
    expect(paris.days).toEqual([{ date: '2026-03-02', bans: 2 }]);
    expect(paris.hours[0]?.bans).toBe(2);
  });

  it('merges hours of one day and keeps empty days', () => {
    const { days } = foldSlots(
      [
        { at: at('2026-03-01T01:00:00Z'), bans: 1 },
        { at: at('2026-03-01T05:00:00Z'), bans: 2 },
        { at: at('2026-03-03T05:00:00Z'), bans: 4 },
      ],
      'UTC',
    );
    expect(days.map((d) => d.bans)).toEqual([3, 0, 4]);
  });

  it('crosses a daylight saving change', () => {
    const { days } = foldSlots(
      [
        { at: at('2026-03-28T12:00:00Z'), bans: 1 },
        { at: at('2026-03-30T12:00:00Z'), bans: 1 },
      ],
      'Europe/Paris',
    );
    expect(days.map((d) => d.date)).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
  });

  it('gives empty days and 24 empty hours without data', () => {
    const { days, hours } = foldSlots([], 'UTC');
    expect(days).toEqual([]);
    expect(hours).toHaveLength(24);
  });
});

describe('jails, week and year', () => {
  it('splits days per jail and lays bans on the week', () => {
    // 2026-03-02 is a Monday
    const { jailDays, week } = foldSlots(
      [
        { at: at('2026-03-02T03:00:00Z'), jail: 'sshd', bans: 2 },
        { at: at('2026-03-02T03:00:00Z'), jail: 'recidive', bans: 1 },
        { at: at('2026-03-08T22:00:00Z'), jail: 'sshd', bans: 5 },
      ],
      'UTC',
    );
    expect(Object.fromEntries(jailDays.get('2026-03-02') ?? [])).toEqual({ sshd: 2, recidive: 1 });
    expect(week[0]?.[3]).toBe(3);
    expect(week[6]?.[22]).toBe(5);
  });

  it('draws 53 weeks from a Monday, nothing after today', () => {
    const weeks = calendarWeeks(new Map([['2026-11-05', 4]]), '2026-11-05');
    expect(weeks).toHaveLength(53);
    expect(weeks[0]?.[0]?.date).toBe('2025-11-03');
    const last = weeks.at(-1) ?? [];
    expect(last[3]).toEqual({ date: '2026-11-05', bans: 4 });
    expect(last[4]).toBeNull();
  });
});

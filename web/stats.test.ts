import { describe, expect, it } from 'vitest';
import { foldSlots } from './stats.ts';

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

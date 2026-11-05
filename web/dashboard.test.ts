import { describe, expect, it } from 'vitest';
import type { ThreatRow } from '../shared/fail2ban.ts';
import { dayColumns, hourColumns, previousWindow, severity, trend, verdict } from './dashboard.ts';

const NOW = Date.UTC(2026, 10, 5, 14, 30) / 1000;
const H = 3600;
const hour = Math.floor(NOW / H) * H;
const threat = (bans: number, jails = ['sshd']): ThreatRow => ({
  ip: `203.0.113.${bans}`,
  bans,
  jails,
  firstBanAt: '2026-11-05T10:00:00Z',
  lastBanAt: '2026-11-05T14:00:00Z',
  geo: null,
});

describe('dashboard figures', () => {
  it('splits hours by jail, empty hours kept', () => {
    const cols = hourColumns(
      [
        { at: hour, jail: 'sshd', bans: 3 },
        { at: hour, jail: 'recidive', bans: 1 },
        { at: hour - 2 * H, jail: 'sshd', bans: 2 },
      ],
      { now: NOW, hours: 24, timezone: 'UTC', lang: 'fr', colorOf: () => '#000' },
    );
    expect(cols).toHaveLength(24);
    expect(cols[23]?.parts.map((p) => p.value)).toEqual([3, 1]);
    expect(cols[22]?.parts).toEqual([]);
    expect(cols[21]?.parts[0]?.value).toBe(2);
  });

  it('folds days in the reader zone, up to today', () => {
    const cols = dayColumns([{ at: hour, jail: 'sshd', bans: 4 }], {
      now: NOW,
      days: 7,
      timezone: 'UTC',
      lang: 'fr',
      color: '#000',
    });
    expect(cols).toHaveLength(7);
    expect(cols[6]?.key).toBe('2026-11-05');
    expect(cols[6]?.parts[0]?.value).toBe(4);
    expect(cols[0]?.parts[0]?.value).toBe(0);
  });

  it('compares with the window before', () => {
    const slots = [
      { at: hour - 30 * H, jail: 'sshd', bans: 5 },
      { at: hour - 2 * H, jail: 'sshd', bans: 9 },
    ];
    expect(previousWindow(slots, NOW, 24, hour - 48 * H)).toBe(5);
    expect(trend(9, 5)).toBe(80);
    expect(trend(3, 0)).toBeNull();
    // History starting inside the previous window: no comparison rather than a huge rise
    expect(previousWindow(slots, NOW, 24, hour - 30 * H)).toBeNull();
    expect(previousWindow(slots, NOW, 24, null)).toBeNull();
    expect(trend(9, null)).toBeNull();
  });

  it('ranks addresses by how often they came back', () => {
    const levels = severity([threat(2), threat(5), threat(12), threat(3, ['sshd', 'recidive'])], 10);
    expect(levels).toEqual({ info: 6, low: 1, medium: 1, high: 1, critical: 1 });
    expect(verdict(levels, 5, 5)).toBe('busy');
    expect(verdict({ info: 3, low: 0, medium: 0, high: 0, critical: 0 }, 30, 10)).toBe('rising');
    expect(verdict({ info: 3, low: 0, medium: 0, high: 0, critical: 0 }, 5, 10)).toBe('calm');
  });
});

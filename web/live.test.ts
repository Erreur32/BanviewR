import { describe, expect, it } from 'vitest';
import type { LocatedBan } from '../shared/fail2ban.ts';
import { mergeFeed, minuteColumns } from './live.ts';

const NOW = Date.UTC(2026, 10, 5, 18, 30, 20) / 1000;
const ban = (ip: string, secondsAgo: number, jail = 'sshd'): LocatedBan => ({
  ip,
  jail,
  bannedAt: new Date((NOW - secondsAgo) * 1000).toISOString(),
  bantime: 600,
  failures: 3,
  geo: null,
});

describe('live feed', () => {
  it('merges running bans into the history, latest first', () => {
    const old = ban('203.0.113.1', 600);
    const feed = mergeFeed([ban('203.0.113.2', 5), old], [old, ban('203.0.113.3', 3600)]);
    expect(feed.map((b) => [b.ip, b.active])).toEqual([
      ['203.0.113.2', true],
      ['203.0.113.1', true],
      ['203.0.113.3', false],
    ]);
  });

  it('counts bans per minute and jail, older ones left out', () => {
    const cols = minuteColumns([ban('a', 10), ban('b', 15, 'recidive'), ban('c', 130), ban('d', 3600)], {
      now: NOW,
      minutes: 60,
      colorOf: () => '#000',
      label: String,
    });
    expect(cols).toHaveLength(60);
    expect(cols[59]?.parts.map((p) => [p.name, p.value])).toEqual([
      ['sshd', 1],
      ['recidive', 1],
    ]);
    expect(cols[57]?.parts[0]?.value).toBe(1);
    expect(cols.flatMap((c) => c.parts).length).toBe(3);
  });
});

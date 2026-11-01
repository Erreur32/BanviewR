import { describe, expect, it } from 'vitest';
import { formatDateTime } from './dates.ts';

describe('formatDateTime', () => {
  const iso = '2026-10-21T12:00:00.000Z';

  it('converts to the chosen time zone', () => {
    expect(formatDateTime(iso, 'Europe/Paris', 'en')).toContain('2:00:00');
    expect(formatDateTime(iso, 'America/New_York', 'en')).toContain('8:00:00');
  });

  it('returns an empty string for missing dates', () => {
    expect(formatDateTime(null, 'UTC', 'fr')).toBe('');
  });
});

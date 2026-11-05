import { describe, expect, it } from 'vitest';
import { matchLabel, navItems } from './nav.ts';

describe('menu search', () => {
  it('ignores case and accents', () => {
    expect(matchLabel('prefe', 'Préférences')).toBe(true);
    expect(matchLabel(' JOURNAL ', "Journal d'audit")).toBe(true);
    expect(matchLabel('jail', 'Statistiques')).toBe(false);
  });

  it('offers admin pages to admins only', () => {
    expect(navItems(true).map((i) => i.to)).toContain('/admin/users');
    expect(navItems(false).map((i) => i.to)).not.toContain('/admin/users');
    expect(navItems(false).map((i) => i.to)).not.toContain('/admin/notifications');
  });
});

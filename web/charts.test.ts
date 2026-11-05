import { describe, expect, it } from 'vitest';
import { JAIL_PALETTE, jailColors, OTHER_COLOR } from './components/charts.tsx';

describe('jail colors', () => {
  it('gives the palette to the busiest jails first, whatever their names', () => {
    const colorOf = jailColors(['npm-4xx', 'npm-auth', 'recidive'], ['apache-auth', 'recidive']);
    expect(colorOf('npm-4xx')).toBe(JAIL_PALETTE[0]);
    expect(colorOf('recidive')).toBe(JAIL_PALETTE[2]);
    // Not ranked yet: after the ranked ones, by name
    expect(colorOf('apache-auth')).toBe(JAIL_PALETTE[3]);
    expect(colorOf('unknown')).toBe(OTHER_COLOR);
  });

  it('keeps a jail colour whatever names a page adds, and grays past the palette', () => {
    const ranked = ['a', 'b', 'c'];
    expect(jailColors(ranked, ['z'])('b')).toBe(jailColors(ranked, ['y', 'x', 'w'])('b'));
    const many = jailColors(['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7']);
    expect(many('j6')).toBe(JAIL_PALETTE[5]);
    expect(many('j7')).toBe(OTHER_COLOR);
  });
});

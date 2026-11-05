import { describe, expect, it } from 'vitest';
import { JAIL_PALETTE, jailColors, OTHER_COLOR } from './components/charts.tsx';

describe('jail colors', () => {
  it('keeps a color per jail, whatever the other jails', () => {
    const one = jailColors(['manual', 'sshd']);
    const two = jailColors(['recidive', 'manual', 'sshd', 'nginx']);
    expect(one('sshd')).toBe(JAIL_PALETTE[0]);
    expect(two('recidive')).toBe(JAIL_PALETTE[1]);
    expect(one('manual')).toBe(JAIL_PALETTE[2]);
    expect(jailColors(['a', 'b', 'c'])('c')).toBe(OTHER_COLOR);
  });
});

import { describe, expect, it } from 'vitest';
import { initials, tintOf } from './avatar.ts';

describe('avatar initials', () => {
  it('takes two letters from the name', () => {
    expect(initials('admin')).toBe('AD');
    expect(initials('jean.dupont')).toBe('JD');
    expect(initials('a')).toBe('A');
  });

  it('keeps the same colour for a name, whatever its case', () => {
    expect(tintOf('Admin')).toEqual(tintOf('admin'));
  });
});

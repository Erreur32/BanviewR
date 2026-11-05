import { describe, expect, it } from 'vitest';
import { describeAgent } from './agent.ts';

describe('describeAgent', () => {
  it('names the browser and the system', () => {
    const edge =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';
    const android =
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
    expect(describeAgent(edge)).toBe('Edge, Windows');
    expect(describeAgent(android)).toBe('Chrome, Android');
    expect(describeAgent('curl/8.5.0')).toBe('curl/8.5.0');
    expect(describeAgent('')).toBe('?');
  });
});

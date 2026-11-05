import { describe, expect, it } from 'vitest';
import { agentCompose } from './agentSetup.ts';

describe('agentCompose', () => {
  it('fills the central address and the code', () => {
    const yml = agentCompose('https://bvr.lan.example', 'bvre_abc');
    expect(yml).toContain('CENTRAL_URL: https://bvr.lan.example');
    expect(yml).toContain('ENROLL_CODE: bvre_abc');
    expect(yml).not.toContain('example.org');
  });
});

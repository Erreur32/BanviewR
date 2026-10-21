import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'web/**/*.test.{ts,tsx}'],
  },
});

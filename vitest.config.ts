import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // A test is timed out only so that one that never ends is caught. How fast a sound renders is the bench's to
    // hold, not this.
    testTimeout: 30_000,
  },
});

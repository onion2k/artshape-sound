/// <reference types="@vitest/browser/providers/playwright" />

import { defineConfig } from 'vitest/config';

/**
 * The audio tests: what needs a real Web Audio, run headless in Chromium rather than in node, which has none.
 * `npm run test:audio`. The tests meet node's by name: `*.audio.test.ts` here, `*.test.ts` there.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.audio.test.ts'],
    // until part 5 writes the first audio test, an empty suite is green rather than an error
    passWithNoTests: true,
    testTimeout: 30_000,
    // Playwright's own Chromium, fetched by `npx playwright install chromium`, so CI and this machine run the same one.
    browser: {
      enabled: true,
      headless: true,
      provider: 'playwright',
      screenshotFailures: false,
      instances: [
        {
          browser: 'chromium',
          // a test may start an AudioContext with no click before it
          launch: { args: ['--autoplay-policy=no-user-gesture-required'] },
        },
      ],
    },
  },
});

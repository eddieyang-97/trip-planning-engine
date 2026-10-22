import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  globalTimeout: 120_000,
  expect: {timeout: 10_000},
  reporter: 'list',
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: {width: 390, height: 844},
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});

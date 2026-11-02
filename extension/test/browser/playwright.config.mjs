import { defineConfig } from 'playwright';

export default defineConfig({
  testDir: './extension/test/browser',
  testMatch: /.*\.spec\.mjs/,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: 'line',
  use: { baseURL: 'http://127.0.0.1', browserName: 'chromium', headless: false },
});

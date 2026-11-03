import { defineConfig } from 'playwright';
export default defineConfig({
<<<<<<< HEAD
  testDir: './extension/test/browser',
  testMatch: /.*\.spec\.mjs/,
=======
  testDir: '.',
  testMatch: /browser-smoke\.mjs/,
>>>>>>> 2952a65
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: 'line',
<<<<<<< HEAD
  use: { baseURL: 'http://127.0.0.1', browserName: 'chromium', headless: false },
=======
  use: { baseURL: 'http://127.0.0.1', browserName: 'chromium', headless: true },
>>>>>>> 2952a65
});

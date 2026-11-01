import { defineConfig } from 'playwright';

export default defineConfig({
  testDir: './extension/test/browser',
  testMatch: /.*\.spec\.mjs/,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1' },
});

import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', timeout: 240_000, fullyParallel: false, workers: 1, retries: 0, reporter: [['list'], ['json', { outputFile: 'results/results.json' }]],
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://localhost:4100', actionTimeout: 15_000, navigationTimeout: 30_000, launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }, trace: 'off', screenshot: 'only-on-failure', acceptDownloads: true },
  webServer: {
    command: 'node prepare-db.mjs && node ../apps/api/dist/server.js', url: 'http://localhost:4100/api/health', reuseExistingServer: false, timeout: 60_000,
    env: { DATABASE_URL: 'postgres://rm:rm@localhost:5432/readymix_e2e', PORT: '4100', NODE_ENV: 'production', COOKIE_SECURE: 'false', WEB_ORIGIN: 'http://localhost:4100', WEB_DIST: '../apps/web/dist', SETUP_TOKEN: 'e2e-setup-token-0123456789', CHROMIUM_PATH: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', RATE_LIMIT_ENABLED: 'false' },
  },
});

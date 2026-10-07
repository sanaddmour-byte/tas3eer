import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'], globalSetup: ['test/globalSetup.ts'], testTimeout: 60000, hookTimeout: 60000, fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/readymix_test', RATE_LIMIT_ENABLED: 'false', NODE_ENV: 'test',
      SETUP_TOKEN: 'test-setup-token', CHROMIUM_PATH: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', ALLOW_TENANT_SIGNUP: 'false',
    },
  },
});

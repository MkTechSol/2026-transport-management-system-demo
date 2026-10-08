import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['tests/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      APP_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://gasman:gasman@localhost:5432/gasman_tms_test',
      JWT_ACCESS_SECRET: 'test-secret-test-secret-123456',
      SIM_ENABLED: 'false',
      RATE_LIMIT_LOGIN_PER_15MIN: '1000',
      RATE_LIMIT_API_PER_MIN: '100000',
    },
  },
});

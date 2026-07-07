import { defineConfig } from 'vitest/config';

// Server tests are pure Node — an in-memory Postgres (pg-mem) and supertest,
// no DOM. Real Postgres and Better Auth are exercised manually on the deploy.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});

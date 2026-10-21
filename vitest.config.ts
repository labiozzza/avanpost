import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/test/**/*.test.ts',
      'apps/server/test/**/*.test.ts',
      'apps/client/test/**/*.test.ts'
    ],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000
  }
});

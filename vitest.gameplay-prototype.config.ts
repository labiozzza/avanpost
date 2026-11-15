import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/gameplay-prototype/src/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false
  }
});

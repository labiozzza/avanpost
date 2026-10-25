import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@avanpost/peace-v2-shared': path.join(projectRoot, 'packages/peace-v2-shared/src/index.ts')
    }
  },
  test: {
    include: ['apps/server-v2/test/**/*.test.ts', 'packages/peace-v2-*/test/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 10_000,
    hookTimeout: 10_000
  }
});

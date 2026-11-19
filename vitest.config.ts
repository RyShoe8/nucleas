import path from 'path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/vitest.setup.ts'],
    // Integration tests share one machine with a database; under full-suite load the 5s default trips on slow starts.
    testTimeout: 20_000,
    // desktop/ has its own tests on node:test (npm run desktop:test).
    exclude: [...configDefaults.exclude, 'dist-worker/**', 'desktop/**'],
  },
  resolve: {
    alias: {
      '@nucleas/ai-contracts': path.resolve(__dirname, './packages/ai-contracts/src/index.ts'),
      '@nucleas/ai-core': path.resolve(__dirname, './packages/ai-core/src'),
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './src/test/mocks/server-only.ts'),
    },
  },
});

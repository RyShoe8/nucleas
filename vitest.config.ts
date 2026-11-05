import path from 'path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/lib/workspace/itemSeenState.vitest.setup.ts'],
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

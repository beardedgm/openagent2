import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { setupFiles: ['tests/setup.ts'], hookTimeout: 120000, fileParallelism: false },
});

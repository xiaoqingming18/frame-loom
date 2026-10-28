import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', setupFiles: ['./src/testing/setup.ts'], maxWorkers: 4 },
});

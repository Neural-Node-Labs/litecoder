// xcoder:version 3 | xcoder:task task-e47636 | xcoder:updated 2026-08-05T08:14:04.591Z | xcoder:subtask test-st-c3ac3e
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    testTimeout: 30_000,
    pool: 'vmThreads',
  },
});

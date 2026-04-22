import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Each test file runs in its own isolated module scope so
    // vi.mock() calls never bleed across test suites
    isolate: true,
    // Produce a readable summary even on CI
    reporter: 'verbose',
  },
});

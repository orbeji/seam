import { defineConfig } from 'vitest/config'

/**
 * Tests that drive the real Git executable in throwaway repositories, or that
 * exercise the process runner against a real child process. They need Git on
 * the PATH and are kept out of CI on purpose; run them locally with
 * `npm run test:integration`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
})

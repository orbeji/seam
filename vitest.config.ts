import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx}'],
    // Integration tests start real Git processes; the Windows runners are much
    // slower here than Linux, so the default five seconds is not enough.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    passWithNoTests: true
  }
})
